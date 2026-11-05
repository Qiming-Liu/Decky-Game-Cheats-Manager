"""Cache behavior and data integrity regressions."""
from __future__ import annotations

import asyncio
import time
from pathlib import Path
from unittest.mock import patch

import main
import trainer_download
import trainer_library

from library import LibraryCase


class CacheTest(LibraryCase):
    def test_deleted_download_restores_all_files_without_network_and_binds_new_game(self):
        original, cached, trainer = self._trash_download()
        self.assertFalse(Path(original["path"]).exists())
        self.assertEqual(trainer_library.scan()["trainers"], [])
        self.assertEqual((cached / "content" / "instructions.txt").read_bytes(), b"help")

        async def run():
            job = await trainer_download.start(trainer, app_id="42")
            await trainer_download.manager.wait_idle()
            return next(item for item in trainer_download.jobs() if item["id"] == job["id"])

        with patch("trainer_download.data_source.get_signed_download_url") as signer, patch("trainer_download.http_download.download") as download:
            restored = asyncio.run(run())
        self.assertEqual(restored["state"], "done", restored["error"])
        self.assertEqual(restored["path"], original["path"])
        signer.assert_not_called()
        download.assert_not_called()
        self.assertFalse(cached.exists())
        self.assertEqual(trainer_library.scan("42")["trainers"][0]["app_ids"], ["42"])
        self.assertEqual(trainer_library.scan("1245620")["trainers"], [])

    def test_changed_version_or_source_does_not_restore_cache(self):
        _, cached, trainer = self._trash_download()
        for key, value in (("version", "2.0"), ("url", "new/trainer.zip"), ("origin", "other")):
            with self.subTest(key=key):
                self.assertIsNone(trainer_library.restore_trainer({**trainer, key: value}, ["42"]))
        self.assertTrue(cached.exists())

    def test_ordinary_trash_folder_remains_visible_and_untouched(self):
        folder = self.library / "trash"
        folder.mkdir()
        (folder / "Trainer.exe").write_bytes(b"user trainer")
        trainer_library.cleanup_trash()
        self.assertEqual(Path(trainer_library.scan()["trainers"][0]["path"]), folder.resolve())
        self.assertEqual((folder / "Trainer.exe").read_bytes(), b"user trainer")

    def test_legacy_cache_migration_preserves_user_files_and_restore(self):
        original, cached, trainer = self._trash_download()
        legacy = self.library / "trash"
        cached.parent.rename(legacy)
        (legacy / "Trainer.exe").write_bytes(b"user trainer")
        trainer_library.cleanup_trash()
        self.assertFalse((legacy / cached.name).exists())
        restored = trainer_library.restore_trainer(trainer, ["42"])
        self.assertEqual(str(restored), original["path"])
        self.assertEqual((legacy / "Trainer.exe").read_bytes(), b"user trainer")

    def test_unowned_hidden_trash_is_never_cleaned_or_used(self):
        trash = self.library / ".gcm-trash"
        trash.mkdir()
        item = trash / ("a" * 32)
        item.mkdir()
        trainer_library.write_json(item / trainer_library.TRASH_RECORD, {
            "schema_version": 1, "deleted_at": time.time() - trainer_library.TRASH_MAX_AGE - 1,
        })
        trainer_library.cleanup_trash()
        self.assertTrue(item.exists())
        source = self.root / "Trainer.exe"
        source.write_bytes(b"program")
        trainer_library.import_file(str(source), "42", "Example", str(self.library))
        entry = trainer_library.scan()["trainers"][0]
        with self.assertRaisesRegex(ValueError, "not owned"):
            trainer_library.delete(entry["id"], str(self.library), "42")
        self.assertTrue(Path(entry["path"]).exists())

    def test_polling_and_cancellation_remain_available_during_restore_hashing(self):
        self._cancel_while_hashing(True)

    def test_modified_missing_or_added_support_files_prevent_restore(self):
        _, cached, trainer = self._trash_download()
        content = cached / "content"
        support = content / "instructions.txt"
        support.write_bytes(b"changed")
        self.assertIsNone(trainer_library.restore_trainer(trainer, ["42"]))
        support.unlink()
        self.assertIsNone(trainer_library.restore_trainer(trainer, ["42"]))
        support.write_bytes(b"help")
        (content / "extra.dll").write_bytes(b"extra")
        self.assertIsNone(trainer_library.restore_trainer(trainer, ["42"]))

    def test_matching_cache_older_than_a_day_restores_until_startup_cleanup(self):
        original, cached, trainer = self._trash_download()
        record = trainer_library.read_json(cached / trainer_library.TRASH_RECORD)
        record["deleted_at"] = time.time() - trainer_library.TRASH_MAX_AGE - 1
        trainer_library.write_json(cached / trainer_library.TRASH_RECORD, record)
        restored = trainer_library.restore_trainer(trainer, ["42"])
        self.assertEqual(str(restored), original["path"])
        self.assertEqual((restored / "v1" / "Trainer.exe").read_bytes(), b"trainer")
        self.assertFalse(cached.exists())

    def test_page_cleanup_removes_expired_cache_without_server_requests(self):
        _, cached, _ = self._trash_download()
        record = trainer_library.read_json(cached / trainer_library.TRASH_RECORD)
        record["deleted_at"] = time.time() - trainer_library.TRASH_MAX_AGE - 1
        trainer_library.write_json(cached / trainer_library.TRASH_RECORD, record)
        with patch("trainer_download.data_source.get_signed_download_url") as signer:
            asyncio.run(main.Plugin().cleanup_trash())
        self.assertFalse(cached.exists())
        signer.assert_not_called()

    def test_trash_migration_preserves_age_and_restore_location(self):
        _, cached, trainer = self._trash_download()
        record = trainer_library.read_json(cached / trainer_library.TRASH_RECORD)
        other = self.root / "new-library"
        other.mkdir()
        trainer_library.set_directory(str(other))
        self.assertEqual(trainer_library.read_json(other / ".gcm-trash" / cached.name / trainer_library.TRASH_RECORD), record)
        restored = trainer_library.restore_trainer(trainer, ["42"])
        self.assertEqual(restored.parent, other.resolve())
        self.assertEqual(list(self.library.iterdir()), [])

    def test_restore_conflict_does_not_replace_existing_files(self):
        original, cached, trainer = self._trash_download()
        destination = Path(original["path"])
        destination.mkdir()
        (destination / "user.exe").write_bytes(b"keep")
        self.assertIsNone(trainer_library.restore_trainer(trainer, ["42"]))
        self.assertEqual((destination / "user.exe").read_bytes(), b"keep")
        self.assertTrue(cached.exists())

    def test_restore_cleanup_failure_keeps_success(self):
        _, _, trainer = self._trash_download()
        with patch("trainer_cache.remove", side_effect=OSError("cleanup failed")):
            restored = trainer_library.restore_trainer(trainer, ["42"])
        self.assertTrue((restored / "v1" / "Trainer.exe").is_file())

    def test_delete_move_failure_keeps_original_trainer(self):
        job = self._install()
        item = trainer_library.scan()["trainers"][0]
        with patch("trainer_library.Path.rename", side_effect=OSError("move failed")):
            with self.assertRaises(OSError):
                trainer_library.delete(item["id"], trainer_library.directory(), "1245620")
        self.assertTrue((Path(job["path"]) / "v1" / "Trainer.exe").exists())

    def test_startup_cleanup_preserves_unexpired_and_unrecognized_files(self):
        _, cached, _ = self._trash_download()
        unrelated = cached.parent / "user-file.txt"
        unrelated.write_bytes(b"keep")
        trainer_library.cleanup_trash()
        self.assertTrue(cached.exists())
        record = trainer_library.read_json(cached / trainer_library.TRASH_RECORD)
        record["deleted_at"] = time.time() - trainer_library.TRASH_MAX_AGE - 1
        trainer_library.write_json(cached / trainer_library.TRASH_RECORD, record)
        trainer_library.cleanup_trash()
        self.assertFalse(cached.exists())
        self.assertEqual(unrelated.read_bytes(), b"keep")
