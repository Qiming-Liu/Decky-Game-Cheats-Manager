"""requests boundary: retain upstream retries, redact URLs from failures."""
from __future__ import annotations

import certifi
import requests as _requests
import threading

ConnectionError = _requests.ConnectionError
Timeout = _requests.Timeout
_state = threading.local()


def clear_failure():
    _state.failure = None


def last_failure():
    return getattr(_state, "failure", None)


class Response:
    def __init__(self, response):
        self._response = response

    def __getattr__(self, name):
        return getattr(self._response, name)

    def raise_for_status(self):
        if 400 <= self.status_code:
            _state.failure = ("http", self.status_code)
            raise _requests.HTTPError(f"HTTP {self.status_code}", response=self) from None

    def json(self):
        try:
            return self._response.json()
        except ValueError:
            raise ValueError("Server returned invalid JSON") from None

    def iter_content(self, *args, **kwargs):
        try:
            yield from self._response.iter_content(*args, **kwargs)
        except _requests.RequestException:
            raise ConnectionError("Download stream interrupted") from None


class Session(_requests.Session):
    def request(self, *args, **kwargs):
        kwargs.setdefault("verify", certifi.where())
        try:
            return Response(super().request(*args, **kwargs))
        except _requests.Timeout:
            _state.failure = ("connection", None)
            raise Timeout("Server request timed out") from None
        except _requests.RequestException:
            _state.failure = ("connection", None)
            raise ConnectionError("Could not connect to server") from None


def get(url, **kwargs):
    # A non-streaming response has already been read before this session closes.
    with Session() as session:
        return session.get(url, **kwargs)
