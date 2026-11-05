"""Loader, local-state, error-sanitizing and generation tests with no production key.

These tests exercise the plugin's own boundary around the private data-source
configuration; nothing in them describes the real service.
"""
from __future__ import annotations

import contextlib
import importlib.util
import io
import os
import tempfile
import unittest
from pathlib import Path
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

    def test_loader_redirects_public_imports_only(self):
        rendered = gcm_auth_adapter.render(FIXTURE.read_text(encoding="utf-8"))
        self.assertIn("import gcm_transport as requests", rendered)
        self.assertIn("from gcm_runtime import APP_VERSION", rendered)
        self.assertNotIn("from config import", rendered)
        self.assertNotIn("\nimport requests", rendered)
        self.assertEqual(self.auth.SIGNED_URL_DOWNLOAD_ENDPOINT, "https://example.invalid/signed_url_download_endpoint")

    def test_loader_rejects_configurations_missing_the_public_interface(self):
        for source in ("CLIENT_API_KEY = 'x'\n", "def signed_get(url, params, timeout):\n    return None\n",
                       "CLIENT_API_KEY = 'x'\nSIGNED_URL_DOWNLOAD_ENDPOINT = 'y'\ndef signed_get(url, params, timeout):\n    return undefined_name\n",
                       "def (\n"):
            with self.assertRaises(ValueError):
                gcm_auth_adapter.render(source)

    def test_local_state_is_private_and_reused_across_restarts(self):
        get = Mock(side_effect=[response(data={"ticket": "fixture-ticket"}), response()])
        with patch.object(gcm_transport, "get", get):
            self.auth.signed_get("https://example.invalid/download", {"filePath": "GCM/Data/translations.json"}, (1, 1))
        self.assertEqual(len(get.call_args_list[0].kwargs["params"]["install"]), 32)
        self.assertEqual(gcm_auth_platform.install_id(), gcm_auth_platform.install_id())
        self.assertEqual(gcm_auth_platform.load_state(), {"ticket": "fixture-ticket"})
        another = gcm_auth_adapter.load(str(FIXTURE))
        with patch.object(gcm_transport, "get", return_value=response()) as get_again:
            another.signed_get("https://example.invalid/download", {}, (1, 1))
        self.assertEqual(get_again.call_count, 1)  # Reuse disk state after restart.
        if os.name != "nt":
            self.assertEqual(Path(gcm_auth_platform.state_path()).stat().st_mode & 0o777, 0o600)
        Path(gcm_auth_platform.state_path()).write_text("[]", encoding="utf-8")
        self.assertIsNone(gcm_auth_platform.load_state())  # Corrupt state is discarded, not trusted.
        gcm_auth_platform.clear_state()
        gcm_auth_platform.clear_state()  # Idempotent.
        self.assertFalse(Path(gcm_auth_platform.state_path()).exists())

    def test_connection_failure_has_safe_structured_error(self):
        import requests
        with patch("requests.Session.request", side_effect=requests.Timeout("https://private.invalid/?secret=hidden")), contextlib.redirect_stdout(io.StringIO()) as output:
            with self.assertRaises(data_source.DataSourceUnavailable) as ctx:
                data_source.get_signed_download_url("GCM/Data/translations.json")
        self.assertEqual(ctx.exception.code, "connection_failed")
        self.assertNotIn("private.invalid", str(ctx.exception) + output.getvalue())
        self.assertEqual(data_source.status()["state"], "connection_failed")

    def test_server_failure_maps_to_server_status(self):
        from requests import Response
        failure = Response()
        failure.status_code = 503
        failure._content = b"{}"
        with patch("requests.Session.request", return_value=failure), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(data_source.DataSourceUnavailable) as ctx:
                data_source.get_signed_download_url("GCM/Data/translations.json")
        self.assertEqual(ctx.exception.code, "server_error")
        self.assertEqual(data_source.status()["state"], "server_error")

    def test_configuration_runtime_error_is_reported_as_auth_failure_without_details(self):
        with patch.object(gcm_transport, "get", return_value=response(data={"ticket": ""})), contextlib.redirect_stdout(io.StringIO()) as output:
            with self.assertRaises(data_source.DataSourceUnavailable) as ctx:
                data_source.get_signed_download_url("GCM/Data/translations.json")
        self.assertEqual(ctx.exception.code, "auth_failed")
        self.assertNotIn("Fixture", str(ctx.exception) + output.getvalue())

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
