"""One process-wide GCM signer, with structured errors safe for RPC/logs."""
from __future__ import annotations

import importlib
import os
import threading

import decky

SECRET_CONFIG_PATHS = (
    os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "secret_config.py"),
    os.path.join(os.path.dirname(__file__), "secret_config.py"),
)
_lock = threading.RLock()
_client = None
_last_status = "unconfigured"
BUNDLED_AUTH_MODULE = "_gcm_core.auth"


class DataSourceUnavailable(RuntimeError):
    def __init__(self, message, code="unconfigured"):
        super().__init__(message)
        self.code = code


def reset():
    """Reload explicitly after configuration changes (also isolates tests)."""
    global _client, _last_status
    with _lock:
        _client, _last_status = None, "unconfigured"


def client():
    global _client, _last_status
    with _lock:
        if _client is not None:
            return _client
        path = next((p for p in SECRET_CONFIG_PATHS if os.path.isfile(p)), None)
        try:
            if path:
                from gcm_auth_adapter import load
                module = load(path)
            else:
                try:
                    module = importlib.import_module(BUNDLED_AUTH_MODULE)
                except ModuleNotFoundError as error:
                    if error.name in {"_gcm_core", BUNDLED_AUTH_MODULE}:
                        raise DataSourceUnavailable("No GCM data source configured", "unconfigured") from None
                    raise
            if not all(getattr(module, name, None) for name in ("CLIENT_API_KEY", "ENROLL_ENDPOINT", "SIGNED_URL_DOWNLOAD_ENDPOINT")) or not callable(getattr(module, "signed_get", None)):
                raise ValueError("Incomplete configuration")
        except DataSourceUnavailable:
            _last_status = "unconfigured"
            raise
        except Exception:
            _last_status = "invalid_config"
            raise DataSourceUnavailable("Could not load GCM authentication configuration", "invalid_config") from None
        _client, _last_status = module, "ready"
        return module


def status():
    try:
        client()
    except DataSourceUnavailable:
        pass
    return {"configured": _client is not None, "state": _last_status}


def is_configured():
    return status()["configured"]


def get_signed_download_url(path_on_s3: str) -> str:
    global _last_status
    client()
    import gcm_transport
    gcm_transport.clear_failure()
    from _gcm_core.download import DownloadBaseThread
    try:
        result = DownloadBaseThread.get_signed_download_url(path_on_s3, raise_errors=True)
        if not isinstance(result, str) or not result.startswith("https://"):
            raise DataSourceUnavailable("Server returned no valid download URL", "invalid_response")
        _last_status = "ready"
        return result
    except DataSourceUnavailable as error:
        _last_status = error.code
        raise
    except Exception as error:
        response = getattr(error, "response", None)
        status_code = getattr(response, "status_code", None)
        previous_failure = gcm_transport.last_failure()
        if previous_failure and previous_failure[0] == "http":
            status_code = status_code or previous_failure[1]
        if status_code == 429:
            code, message = "rate_limited", "GCM server rate limit reached"
        elif isinstance(error, (gcm_transport.ConnectionError, gcm_transport.Timeout)) or (previous_failure and previous_failure[0] == "connection"):
            code, message = "connection_failed", "Could not connect to GCM server"
        elif status_code and status_code >= 500:
            code, message = "server_error", "GCM server request failed"
        elif isinstance(error, RuntimeError) and _last_status in {"connection_failed", "server_error", "rate_limited"}:
            code = _last_status
            message = "GCM enrollment is waiting before retrying"
        elif status_code in (400, 401, 403) or isinstance(error, RuntimeError):
            code, message = "auth_failed", "GCM device authentication failed"
        else:
            code, message = "server_error", "GCM server request failed"
        _last_status = code
        raise DataSourceUnavailable(message, code) from None
