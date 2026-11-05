"""Library behavior and data integrity regressions."""
from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from unittest.mock import patch

import trainer_download
import trainer_library

from library import LibraryCase


class LibraryTest(LibraryCase):

    def test_directory_persists_and_switch_moves_files(self):
        (self.library / "trainer.CT").write_bytes(b"table")
        target = self.root / "other"
        target.mkdir()
        trainer_library.set_directory(str(target))
        self.assertEqual(Path(trainer_library.directory()), target.resolve())
        self.assertFalse((self.library / "trainer.CT").exists())
        self.assertEqual((target / "trainer.CT").read_bytes(), b"table")
        self.assertEqual(len(trainer_library.scan()["trainers"]), 1)
        with self.assertRaisesRegex(ValueError, "library_changed"):
            asyncio.run(trainer_download.start({}, expected_directory=str(self.library)))
        with self.assertRaises((OSError, ValueError)):
            trainer_library.set_directory(str(self.root / "missing"))
        self.assertEqual(Path(trainer_library.directory()), target.resolve())

    def test_scanned_paths_match_sidecar_executables_through_library_alias(self):
        folder = self.library / "Trainer"
        folder.mkdir()
        (folder / "Trainer.exe").write_bytes(b"program")
        (self.library / "Standalone.exe").write_bytes(b"program")
        alias = str(self.library / ".." / self.library.name)
        with patch.object(trainer_library, "directory", return_value=alias):
            for item in trainer_library.scan()["trainers"]:
                executable = trainer_library.executable(item["id"], item["files"][0], alias)
                # The frontend recognizes a selected executable by its entry path.
                self.assertIn(Path(item["path"]), (Path(executable), Path(executable).parent))

    def test_migration_preserves_metadata_and_support_files(self):
        source = self.root / "Trainer.exe"
        source.write_bytes(b"program")
        result = trainer_library.import_file(str(source), "42", "Example", str(self.library))
        (Path(result["path"]) / "support.dll").write_bytes(b"support")
        target = self.root / "new"
        target.mkdir()
        trainer_library.set_directory(str(target))
        item = trainer_library.scan("42")["trainers"][0]
        self.assertEqual((Path(item["path"]) / "support.dll").read_bytes(), b"support")
        self.assertEqual(item["game_name"], "Example")
        self.assertEqual(list(self.library.iterdir()), [])

    def test_migration_conflict_or_copy_failure_preserves_originals(self):
        (self.library / "trainer.CT").write_bytes(b"original")
        target = self.root / "new"
        target.mkdir()
        (target / "trainer.CT").write_bytes(b"existing")
        with self.assertRaisesRegex(ValueError, "library_conflict"):
            trainer_library.set_directory(str(target))
        self.assertEqual((target / "trainer.CT").read_bytes(), b"existing")
        (target / "trainer.CT").unlink()
        with patch("library_transactions.shutil.copy2", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                trainer_library.set_directory(str(target))
        self.assertEqual(Path(trainer_library.directory()), self.library.resolve())
        self.assertEqual((self.library / "trainer.CT").read_bytes(), b"original")
        self.assertEqual(list(target.iterdir()), [])

    def test_settings_failure_rolls_back_published_migration(self):
        (self.library / "trainer.CT").write_bytes(b"original")
        target = self.root / "new"
        target.mkdir()
        with patch("trainer_library.write_json", side_effect=OSError("settings failed")):
            with self.assertRaises(OSError):
                trainer_library.set_directory(str(target))
        self.assertEqual(Path(trainer_library.directory()), self.library.resolve())
        self.assertEqual((self.library / "trainer.CT").read_bytes(), b"original")
        self.assertEqual(list(target.iterdir()), [])

    def test_migration_rejects_nested_paths(self):
        nested = self.library / "nested"
        nested.mkdir()
        for target in (nested, self.root):
            with self.assertRaisesRegex(ValueError, "library_nested"):
                trainer_library.set_directory(str(target))

    def test_import_copies_and_binds_without_replacing_source(self):
        source = self.root / "Trainer.exe"
        source.write_bytes(b"program")
        first = trainer_library.import_file(str(source), "42", "Example", str(self.library))
        second = trainer_library.import_file(str(source), "42", "Example", str(self.library))
        self.assertNotEqual(first["path"], second["path"])
        self.assertEqual(source.read_bytes(), b"program")
        entries = trainer_library.scan("42", "Unrelated name")["trainers"]
        self.assertEqual(len(entries), 2)
        self.assertEqual(trainer_library.scan("43", "Example")["trainers"], [])
        trainer_library.delete(entries[0]["id"], str(self.library), "42")
        self.assertEqual(len(trainer_library.scan()["trainers"]), 1)
        self.assertEqual(source.read_bytes(), b"program")

    def test_import_accepts_uppercase_exe_and_rejects_other_file_types(self):
        for extension in (".bat", ".CT", ".zip", ".txt"):
            source = self.root / f"Trainer{extension}"
            source.write_bytes(b"original")
            with self.assertRaisesRegex(ValueError, "Choose an .exe file"):
                trainer_library.import_file(str(source), "42", "Example", str(self.library))
            self.assertEqual(source.read_bytes(), b"original")
        self.assertEqual(list(self.library.iterdir()), [])
        source = self.root / "Trainer.EXE"
        source.write_bytes(b"program")
        trainer_library.import_file(str(source), "42", "Example", str(self.library))
        self.assertEqual(len(trainer_library.scan("42")["trainers"]), 1)
        self.assertEqual(trainer_library.scan("43")["trainers"], [])

    def test_import_failure_does_not_publish_partial_installation(self):
        source = self.root / "Trainer.exe"
        source.write_bytes(b"program")
        with patch("library_transactions.shutil.copy2", side_effect=OSError("copy failed")):
            with self.assertRaises(OSError):
                trainer_library.import_file(str(source), "42", "Example", str(self.library))
        self.assertEqual(list(self.library.iterdir()), [])

    def test_import_cleanup_failure_does_not_report_committed_copy_as_failed(self):
        source = self.root / "Trainer.exe"
        source.write_bytes(b"program")
        real_temporary = tempfile.TemporaryDirectory

        class FailingCleanup(real_temporary):
            def __exit__(self, *args):
                super().__exit__(*args)
                raise OSError("cleanup failed")

        with patch("library_transactions.tempfile.TemporaryDirectory", FailingCleanup):
            result = trainer_library.import_file(str(source), "42", "Example", str(self.library))
        self.assertTrue((Path(result["path"]) / "Trainer.exe").is_file())
        self.assertEqual(len(trainer_library.scan("42")["trainers"]), 1)

    def test_management_rejects_stale_directory_and_unknown_files(self):
        source = self.root / "Trainer.exe"
        source.write_bytes(b"program")
        trainer_library.import_file(str(source), "42", "Example", str(self.library))
        item = trainer_library.scan()["trainers"][0]
        with self.assertRaisesRegex(ValueError, "library_changed"):
            trainer_library.delete(item["id"], str(self.root), "42")
        with self.assertRaisesRegex(ValueError, "Unknown trainer file"):
            trainer_library.executable(item["id"], "../Trainer.exe", str(self.library))
        self.assertTrue(Path(trainer_library.executable(item["id"], "Trainer.exe", str(self.library))).is_file())

    def test_unmanaged_folder_and_shared_trainer_are_not_deleted(self):
        folder = self.library / "Existing"
        folder.mkdir()
        (folder / "Trainer.exe").write_bytes(b"keep")
        item = trainer_library.scan()["trainers"][0]
        with self.assertRaisesRegex(ValueError, "Only trainers"):
            trainer_library.delete(item["id"], str(self.library), "42")
        trainer_library.write_json(folder / trainer_library.METADATA, {"schema_version": 1, "app_ids": ["42", "43"]})
        with self.assertRaisesRegex(ValueError, "shared"):
            trainer_library.delete(item["id"], str(self.library), "42")
        self.assertTrue((folder / "Trainer.exe").exists())


    def test_corrupt_metadata_does_not_hide_other_trainers(self):
        folder = self.library / "Elden Ring Trainer"
        folder.mkdir()
        (folder / "trainer.exe").write_bytes(b"trainer")
        trainer_library.write_json(folder / trainer_library.METADATA, {
            "app_ids": 1245620, "game_name": ["wrong type"], "trainer_name": 42,
        })
        self.assertEqual(len(trainer_library.scan("1245620", "Elden Ring")["trainers"]), 1)
