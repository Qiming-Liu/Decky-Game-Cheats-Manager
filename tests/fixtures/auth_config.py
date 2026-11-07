"""Inert stand-in for the private data-source configuration.

It has only the public shape the plugin requires (the endpoint constants upstream
GCM's config.py declares and a `signed_get`) and a fictional flow of its own.
"""
import requests
from config import APP_VERSION
from gcm_auth_platform import device_hasher, load_state, save_state

SIGNED_URL_DOWNLOAD_ENDPOINT = 'https://example.invalid/signed_url_download_endpoint'
SIGNED_URL_UPLOAD_ENDPOINT = 'https://example.invalid/signed_url_upload_endpoint'
VERSION_CHECKER_ENDPOINT = 'https://example.invalid/version_checker_endpoint'
PATCH_PATTERNS_ENDPOINT = 'https://example.invalid/patch_patterns_endpoint'
CLIENT_API_KEY = 'TEST_ONLY_NOT_A_REAL_KEY'


def _ticket():
    state = load_state()
    if state is None:
        response = requests.get(VERSION_CHECKER_ENDPOINT, params={'install': device_hasher('fixture:')(), 'version': APP_VERSION}, timeout=5)
        response.raise_for_status()
        state = response.json()
        save_state(state)
    return state


def signed_get(url, params, timeout):
    ticket = _ticket().get('ticket')
    if not ticket:
        print('Fixture data source is not ready')
        raise RuntimeError('Fixture data source is not ready')
    return requests.get(url, headers={'X-Fixture-Ticket': ticket}, params=params, timeout=timeout)
