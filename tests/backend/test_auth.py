"""Protocol, generation and real HTTP integration tests with no production key."""
from __future__ import annotations

import contextlib
import hashlib
import hmac
import importlib.util
import io
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
import data_source
import gcm_auth_adapter
import gcm_auth_platform
import gcm_transport

FIXTURE = ROOT / "tests" / "fixtures" / "auth_config.py"


def response(status=200, data=None):
    result = Mock(status_code=status)
    result.json.return_value = data or {}
    if status >= 400:
        import requests
        result.raise_for_status.side_effect = requests.HTTPError(f"HTTP {status}", response=result)
    return result


class AuthTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for target, value in (("decky.DECKY_PLUGIN_SETTINGS_DIR", str(self.root)),
                              ("data_source.SECRET_CONFIG_PATHS", (str(FIXTURE),)),
                              ("data_source.BUNDLED_AUTH_MODULE", "_gcm_core.no_test_auth")):
            patcher = patch(target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        data_source.reset()
        self.addCleanup(data_source.reset)
        self.auth = data_source.client()

    def test_platform_adapter_uses_linux_and_persists_enrollment(self):
        get = Mock(side_effect=[response(data={"client_id": "test-device", "client_secret": "test-secret"}), response()])
        with patch.object(gcm_transport, "get", get):
            self.auth.signed_get("https://example.invalid/download", {"filePath": "GCM/Data/translations.json"}, (1, 1))
        self.assertEqual(get.call_args_list[0].kwargs["params"]["platform"], "linux")
        self.assertEqual(get.call_args_list[0].kwargs["params"]["app"], "GCM")
        self.assertEqual(len(get.call_args_list[0].kwargs["params"]["machineHash"]), 32)
        self.assertEqual(gcm_auth_platform.machine_hash(), gcm_auth_platform.machine_hash())
        self.assertEqual(gcm_auth_platform.read_credential()["client_id"], "test-device")
        another = gcm_auth_adapter.load(str(FIXTURE))
        with patch.object(gcm_transport, "get", return_value=response()) as get_again:
            another.signed_get("https://example.invalid/download", {}, (1, 1))
        self.assertEqual(get_again.call_count, 1)  # Reuse disk credential after restart.
        if os.name != "nt":
            self.assertEqual(Path(gcm_auth_platform.credential_path()).stat().st_mode & 0o777, 0o600)

    def test_signature_matches_protocol(self):
        self.auth._credential = {"client_id": "test-device", "client_secret": "test-secret"}
        with patch.object(self.auth.time, "time", return_value=1000), patch.object(self.auth.uuid, "uuid4", return_value=SimpleNamespace(hex="test-nonce")):
            headers = self.auth._signed_headers("GET", "https://example.invalid/download", {"z": "last", "a": "first"})
        canonical = "\n".join(("GET", "/download", "a=first\nz=last", headers["X-Client-Meta"], "1000", "test-nonce"))
        expected = hmac.new(b"test-secret", canonical.encode(), hashlib.sha256).hexdigest()
        self.assertEqual(headers["X-Sig"], expected)


    def test_401_reenrolls_and_retries_with_new_device(self):
        old = {"client_id": "old-device", "client_secret": "old-secret"}
        new = {"client_id": "new-device", "client_secret": "new-secret"}
        get = Mock(side_effect=[response(data=old), response(401), response(data=new), response()])
        with patch.object(gcm_transport, "get", get):
            result = self.auth.signed_get("https://example.invalid/download", {}, (1, 1))
        self.assertEqual(result.status_code, 200)
        self.assertEqual(get.call_count, 4)
        self.assertEqual(get.call_args_list[1].kwargs["headers"]["X-Client-Id"], "old-device")
        self.assertEqual(get.call_args_list[3].kwargs["headers"]["X-Client-Id"], "new-device")
        self.assertEqual(gcm_auth_platform.read_credential(), new)


    def test_enrollment_connection_failure_has_safe_structured_error(self):
        import requests
        with patch("requests.Session.request", side_effect=requests.Timeout("https://private.invalid/?secret=hidden")), contextlib.redirect_stdout(io.StringIO()) as output:
            with self.assertRaises(data_source.DataSourceUnavailable) as ctx:
                data_source.get_signed_download_url("GCM/Data/translations.json")
        self.assertEqual(ctx.exception.code, "connection_failed")
        self.assertNotIn("private.invalid", str(ctx.exception) + output.getvalue())
        self.assertEqual(data_source.status()["state"], "connection_failed")

    def test_registration_server_failure_and_cooldown_keep_server_status(self):
        from requests import Response
        failure = Response()
        failure.status_code = 503
        failure._content = b"{}"
        with patch("requests.Session.request", return_value=failure) as request:
            for _ in range(2):
                with self.assertRaises(data_source.DataSourceUnavailable) as ctx:
                    data_source.get_signed_download_url("GCM/Data/translations.json")
                self.assertEqual(ctx.exception.code, "server_error")
        self.assertEqual(request.call_count, 1)


    def test_generation_with_and_without_secret_cannot_reuse_stale_key(self):
        spec = importlib.util.spec_from_file_location("build_gcm_core", ROOT / "scripts" / "build_gcm_core.py")
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        with self.assertRaises(ValueError):
            builder.validate("MISSING_GLOBAL\n", "broken.py")
        output = self.root / "generated"
        with contextlib.redirect_stdout(io.StringIO()):
            builder.build(output, FIXTURE)
            self.assertTrue((output / "auth.py").is_file())
            builder.build(output)
        self.assertFalse((output / "auth.py").exists())
        for name in ("config.py", "search_index.py", "download.py", "search.py"):
            compile((output / name).read_text(encoding="utf-8"), name, "exec")

