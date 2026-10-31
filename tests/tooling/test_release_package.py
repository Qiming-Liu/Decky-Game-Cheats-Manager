"""Verify source-free release imports and artifact boundaries."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from scripts import package_release


class ReleasePackageTest(unittest.TestCase):
    def test_protected_packages_and_decky_entry_point_execute(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "example").mkdir()
            (root / "example/__init__.py").write_text("from .auth import sign\n")
            (root / "example/auth.py").write_text(
                "import hmac\nKEY = 'fixture-release-key'\n"
                "def sign(value):\n return hmac.digest(KEY.encode(), value, 'sha256').hex()\n")
            (root / "main.py").write_text(
                "from __future__ import annotations\nfrom example import sign\n"
                "class Plugin:\n def result(self):\n  return sign(b'payload')\n")
            for source in root.rglob("*.py"):
                package_release.protect_python(source, root)
            self.assertEqual(list(root.rglob("*.py")), [root / "main.py"])
            for artifact in root.rglob("*"):
                if artifact.is_file():
                    self.assertNotIn(b"fixture-release-key", artifact.read_bytes())
            result = subprocess.run([sys.executable, "-c",
                "import sys,importlib.util; sys.path.insert(0,sys.argv[1]); "
                "s=importlib.util.spec_from_file_location('plugin',sys.argv[1]+'/main.py'); "
                "m=importlib.util.module_from_spec(s); s.loader.exec_module(m); "
                "print(m.Plugin().result())", str(root)], capture_output=True, text=True, check=True)
            import hmac
            self.assertEqual(result.stdout.strip(), hmac.digest(b"fixture-release-key", b"payload", "sha256").hex())

    def test_zip_allowlist_and_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "source"
            root.mkdir()
            for name in ("plugin.json", "package.json", "LICENSE", "README.md"):
                (root / name).write_text("{}")
            (root / "main.py").write_text("class Plugin: pass\n")
            for name in ("py_modules/_gcm_core", "py_modules/_vendor/requests", "dist", "db", "gcm"):
                (root / name).mkdir(parents=True)
            (root / "py_modules/_vendor/requests/__init__.py").write_text("pass\n")
            (root / "py_modules/_gcm_core/auth.py").write_text("KEY = 'fixture-only'\n")
            (root / "py_modules/secret_config.py").write_text("DO_NOT_SHIP = True\n")
            (root / "dist/index.js").write_text("export default {};\n")
            (root / "dist/index.js.map").write_text("DO_NOT_SHIP")
            (root / "gcm/LICENSE.txt").write_text("license")
            (root / "db/catalog.json").write_text("{}")
            output = Path(temporary) / "release.zip"
            def javascript(args, **kwargs):
                Path(args[-1]).write_text("export default {};\n")
            with patch.object(package_release, "ROOT", root), patch.object(package_release.subprocess, "run", side_effect=javascript):
                package_release.package(output)
            with zipfile.ZipFile(output) as archive:
                names = archive.namelist()
                self.assertTrue(all(name.startswith("DeckyGCM/") for name in names))
                self.assertIn("DeckyGCM/py_modules/_gcm_core/auth.pyc", names)
                self.assertIn("DeckyGCM/package.json", names)
                self.assertEqual([name for name in names if name.endswith(".py")], ["DeckyGCM/main.py"])
                self.assertFalse(any("secret_config" in name or name.endswith(".map") for name in names))
            self.assertTrue((root / "py_modules/_gcm_core/auth.py").exists())


if __name__ == "__main__":
    unittest.main()
