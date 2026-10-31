# Inert GCM signing fixture, parsed by the adapter; never imported directly.
ENROLL_ENDPOINT = 'https://example.invalid/enroll_endpoint'
SIGNED_URL_DOWNLOAD_ENDPOINT = 'https://example.invalid/signed_url_download_endpoint'
SIGNED_URL_UPLOAD_ENDPOINT = 'https://example.invalid/signed_url_upload_endpoint'
VERSION_CHECKER_ENDPOINT = 'https://example.invalid/version_checker_endpoint'
PATCH_PATTERNS_ENDPOINT = 'https://example.invalid/patch_patterns_endpoint'
CLIENT_API_KEY = 'TEST_ONLY_NOT_A_REAL_KEY'
_ENROLL_TIMEOUT = (5, 15)
_RETRY_INTERVAL = 3600
_UNKNOWN_CREDENTIAL = 401
_REQUEST_ATTEMPTS = 3

def _enroll():
    """Trade this install's details for a credential the server generates."""
    if not ENROLL_ENDPOINT or not CLIENT_API_KEY:
        return None
    from config import APP_VERSION, settings
    payload = {'app': 'GCM', 'appVersion': APP_VERSION, 'platform': 'win32', 'language': settings.get('language'), 'machineHash': _machine_hash()}
    try:
        response = requests.get(ENROLL_ENDPOINT, headers={'x-api-key': CLIENT_API_KEY}, params=payload, timeout=_ENROLL_TIMEOUT)
        response.raise_for_status()
        data = response.json()
    except Exception as e:
        print(f'Enrollment failed: {e}')
        return None
    if not data.get('client_id') or not data.get('client_secret'):
        print(f'Enrollment response missing credential fields: {data}')
        return None
    credential = {'client_id': data['client_id'], 'client_secret': data['client_secret']}
    try:
        _store_credential(credential)
    except Exception as e:
        print(f'Could not store credential: {e}')
    return credential

def _get_credential():
    """This install's credential, enrolling on first use. None when that is not possible."""
    global _credential, _last_attempt
    if _credential:
        return _credential
    with _lock:
        if _credential:
            return _credential
        _credential = _read_credential()
        if _credential:
            return _credential
        if time.time() - _last_attempt < _RETRY_INTERVAL:
            return None
        _last_attempt = time.time()
        _credential = _enroll()
        return _credential

def _refresh_credential(used_id):
    """Discard the rejected credential so the next attempt enrolls a replacement."""
    global _credential, _last_attempt
    with _lock:
        if _credential and _credential['client_id'] != used_id:
            return
        _credential, _last_attempt = (None, 0.0)
        try:
            os.remove(_CREDENTIAL_FILE)
        except OSError:
            pass

def _client_meta():
    """The facts about this install that change over its life, signed with each request."""
    from config import APP_VERSION, settings
    return f"v={APP_VERSION};lang={settings.get('language') or 'unknown'}"

def _canonical_string(method, url, params, meta, timestamp, nonce):
    """The exact bytes both sides sign."""
    pairs = '\n'.join((f'{key}={params[key]}' for key in sorted(params)))
    return '\n'.join((method.upper(), urlparse(url).path, pairs, meta, timestamp, nonce))

def _signed_headers(method, url, params):
    """Shared key plus proof this install holds its secret, which is never transmitted."""
    credential = _get_credential()
    if not credential:
        raise RuntimeError('Not enrolled: this request cannot be signed')
    meta = _client_meta()
    timestamp = str(int(time.time()))
    nonce = uuid.uuid4().hex
    message = _canonical_string(method, url, params or {}, meta, timestamp, nonce)
    return {'x-api-key': CLIENT_API_KEY, 'X-Client-Id': credential['client_id'], 'X-Client-Meta': meta, 'X-Ts': timestamp, 'X-Nonce': nonce, 'X-Sig': hmac.new(credential['client_secret'].encode(), message.encode(), hashlib.sha256).hexdigest()}

def signed_get(url, params, timeout):
    """GET signed as this install, enrolling again if the server no longer knows it."""
    from config import RETRY_STATUSES

    def send():
        for attempt in range(_REQUEST_ATTEMPTS):
            final_attempt = attempt == _REQUEST_ATTEMPTS - 1
            headers = _signed_headers('GET', url, params)
            try:
                response = requests.get(url, headers=headers, params=params, timeout=timeout)
                if response.status_code not in RETRY_STATUSES or final_attempt:
                    return (headers['X-Client-Id'], response)
                print(f'Signed request returned HTTP {response.status_code}, retrying')
            except (requests.ConnectionError, requests.Timeout) as e:
                if final_attempt:
                    raise
                print(f'Signed request failed, retrying: {e}')
            time.sleep(2 ** attempt + random.uniform(0, 0.5))
    used_id, response = send()
    if response.status_code == _UNKNOWN_CREDENTIAL:
        _refresh_credential(used_id)
        _, response = send()
    return response
