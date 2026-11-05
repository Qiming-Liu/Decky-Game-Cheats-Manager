"""Archive extraction path and size safeguards."""
import stat
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import trainer_archive
from library import zip_bytes


class ArchiveTest(unittest.TestCase):
    def test_rejects_absolute_windows_paths_and_links(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ("/escape.exe", "C:\\escape.exe", "..\\escape.exe"):
                with self.subTest(name=name):
                    archive = root / "input.zip"
                    archive.write_bytes(zip_bytes({name: b"bad"}))
                    with self.assertRaises(ValueError):
                        trainer_archive.extract(str(archive), str(root / "output"))
            archive = root / "link.zip"
            with zipfile.ZipFile(archive, "w") as out:
                entry = zipfile.ZipInfo("link.exe")
                entry.create_system = 3
                entry.external_attr = (stat.S_IFLNK | 0o777) << 16
                out.writestr(entry, "../../outside")
            with self.assertRaises(ValueError):
                trainer_archive.extract(str(archive), str(root / "output"))

    def test_enforces_expanded_size_limit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "input.zip"
            archive.write_bytes(zip_bytes({"large.exe": b"123456789"}))
            with patch.object(trainer_archive, "MAX_BYTES", 4), self.assertRaises(ValueError):
                trainer_archive.extract(str(archive), str(root / "output"))
