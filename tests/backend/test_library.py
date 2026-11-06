"""Library behavior and data integrity regressions."""
from __future__ import annotations

import asyncio
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
        folder = self.library / "Imported"
        folder.mkdir()
        (folder / "Trainer.exe").write_bytes(b"program")
        (folder / "support.dll").write_bytes(b"support")
        trainer_library.write_json(folder / trainer_library.METADATA,
                                   {"schema_version": 1, "game_name": "Example", "app_ids": ["42"]})
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

    def test_local_file_is_used_in_place_and_removing_it_keeps_the_file(self):
        source = self.root / "Downloads" / "My Tool.bat"
        source.parent.mkdir()
        source.write_bytes(b"program")
        result = trainer_library.link_file(str(source), "42", "Example", str(self.library))
        self.assertEqual(Path(result["path"]), source.resolve())
        self.assertEqual(list(self.library.iterdir()), [])
        trainer_library.link_file(str(source), "42", "Example", str(self.library))
        entries = trainer_library.scan("42", "Unrelated name")["trainers"]
        self.assertEqual(len(entries), 1)
        self.assertEqual(trainer_library.scan("43", "Example")["trainers"], [])
        item = entries[0]
        self.assertEqual(trainer_library.executable(item["id"], item["files"][0], str(self.library)), str(source.resolve()))
        source.unlink()
        self.assertTrue(trainer_library.scan("42")["trainers"][0]["missing"])
        source.write_bytes(b"program")
        trainer_library.delete(item["id"], str(self.library), "42")
        self.assertEqual(trainer_library.scan("42")["trainers"], [])
        self.assertEqual(source.read_bytes(), b"program")

    def test_local_file_accepts_programs_and_tables_only(self):
        source = self.root / "Trainer.zip"
        source.write_bytes(b"original")
        with self.assertRaises(ValueError):
            trainer_library.link_file(str(source), "42", "Example", str(self.library))
        for name in ("Trainer.EXE", "Table.CT"):
            source = self.root / name
            source.write_bytes(b"program")
            trainer_library.link_file(str(source), "42", "Example", str(self.library))
        items = trainer_library.scan("42")["trainers"]
        self.assertEqual(len(items), 2)
        table = next(item for item in items if item["files"] == ["Table.CT"])
        self.assertEqual(trainer_library.executable(table["id"], "Table.CT", str(self.library)), str((self.root / "Table.CT").resolve()))

    def test_cheat_engine_is_shared_and_hidden_from_game_rows(self):
        self.assertFalse(trainer_library.cheat_engine()["installed"])
        folder = self.library / "Cheat Engine 7.5"
        (folder / "autorun").mkdir(parents=True)
        (folder / "Cheat Engine.exe").write_bytes(b"program")
        trainer_library.write_json(folder / trainer_library.METADATA, {"schema_version": 1, "version": "7.5", "app_ids": []})
        self.assertEqual(trainer_library.scan("42", "Cheat Engine")["trainers"], [])
        engine = trainer_library.cheat_engine()
        self.assertEqual((engine["installed"], engine["version"], engine["path"]), (True, "7.5", str(folder.resolve() / "Cheat Engine.exe")))
        self.assertFalse(engine["bridge"])
        self.assertTrue(trainer_library.install_bridge(folder))
        self.assertTrue(trainer_library.cheat_engine()["bridge"])
        self.assertEqual((folder / "autorun" / "decky_gcm.lua").read_bytes(), (trainer_library.RESOURCES / "decky_gcm.lua").read_bytes())
        # A linked installation wins over the library's copy and is only forgotten on removal.
        linked = self.root / "MyCE"
        linked.mkdir()
        (linked / "Cheat Engine.exe").write_bytes(b"program")
        trainer_library.link_cheat_engine(str(linked))
        self.assertEqual(trainer_library.cheat_engine()["folder"], str(linked.resolve()))
        with self.assertRaises(ValueError):
            trainer_library.link_cheat_engine(str(self.root))
        trainer_library.remove_cheat_engine()
        self.assertEqual(trainer_library.cheat_engine()["folder"], str(folder.resolve()))
        self.assertTrue((linked / "Cheat Engine.exe").is_file())
        trainer_library.remove_cheat_engine()
        self.assertFalse(trainer_library.cheat_engine()["installed"])
        self.assertFalse(folder.exists())

    def test_local_file_inside_library_is_not_listed_twice(self):
        folder = self.library / "Example Trainer"
        folder.mkdir()
        (folder / "Trainer.exe").write_bytes(b"program")
        trainer_library.write_json(folder / trainer_library.METADATA, {"schema_version": 1, "app_ids": ["42"]})
        trainer_library.link_file(str(folder / "Trainer.exe"), "42", "Example", str(self.library))
        self.assertEqual(len(trainer_library.scan("42")["trainers"]), 1)

    def test_links_survive_library_folder_change(self):
        source = self.root / "Trainer.exe"
        source.write_bytes(b"program")
        trainer_library.link_file(str(source), "42", "Example", str(self.library))
        target = self.root / "new"
        target.mkdir()
        trainer_library.set_directory(str(target))
        self.assertEqual(len(trainer_library.scan("42")["trainers"]), 1)

    def test_management_rejects_stale_directory_and_unknown_files(self):
        source = self.root / "Trainer.exe"
        source.write_bytes(b"program")
        trainer_library.link_file(str(source), "42", "Example", str(self.library))
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
