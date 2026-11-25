"""The library's folder layout: one folder per game, and the earlier flat layout still read."""
from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

import download_jobs
import library_games
import library_layout
import library_match
import library_storage
import trainer_library

from library import LibraryCase


class LayoutRulesTest(unittest.TestCase):
    def test_folder_names_are_safe_for_filesystems_and_the_launcher(self):
        self.assertEqual(library_layout.game_folder_name("Elden Ring", "1245620"), "Elden Ring (1245620)")
        self.assertEqual(library_layout.game_folder_name("100% Orange: Juice?", "282800"), "100 Orange - Juice (282800)")
        self.assertEqual(library_layout.game_folder_name("", "42"), "42")
        # The launcher cannot pass a path that holds a backslash.
        self.assertEqual(library_layout.safe_name("Foo\\Bar <Trainer>"), "FooBar Trainer")
        self.assertEqual(library_layout.game_folder_name("游戏/名称", "42"), "游戏_名称 (42)")
        self.assertEqual(library_layout.trainer_folder_name("...", "0123456789abcdef"), "trainer [01234567]")
        self.assertLessEqual(len(library_layout.safe_name("名" * 200).encode()), library_layout.MAX_NAME_BYTES)

    def test_only_a_valid_record_makes_a_game_folder(self):
        record = library_layout.game_record("42", "Example")
        self.assertEqual(library_layout.record_app_id(record), "42")
        for damaged in ({}, [], {**record, "schema_version": 2}, {**record, "app_id": 42}, {**record, "app_id": "4x"}):
            self.assertEqual(library_layout.record_app_id(damaged), "")

    def test_entries_match_by_app_id_then_game_name_then_file_name(self):
        entry = {"app_ids": ["42"], "game_name": "Other", "name": "x", "files": []}
        self.assertTrue(library_match.matches(entry, "42", []))
        self.assertFalse(library_match.matches(entry, "43", ["Other"]))
        named = {"app_ids": [], "game_name": "ＥＬＤＥＮ ring", "name": "x", "files": []}
        self.assertTrue(library_match.matches(named, "1", ["Elden Ring"]))
        loose = {"app_ids": [], "game_name": "", "name": "[FL] Portal 2 Trainer", "files": ["Portal_2.exe"]}
        self.assertTrue(library_match.matches(loose, "1", ["Portal 2"]))
        self.assertFalse(library_match.matches(loose, "1", ["Portal"]))

    def test_finished_jobs_are_forgotten_oldest_first(self):
        jobs = {str(i): {"state": "done"} for i in range(5)} | {"active": {"state": "downloading"}}
        self.assertEqual(download_jobs.expired(jobs, 3), ["0", "1"])


class GameFolderTest(LibraryCase):
    def _trainer(self, folder: Path, metadata: dict | None = None):
        folder.mkdir(parents=True)
        (folder / "Trainer.exe").write_bytes(b"program")
        if metadata is not None:
            library_storage.write_json(folder / library_storage.METADATA, {"schema_version": 1, **metadata})

    def test_downloads_for_one_game_share_one_folder(self):
        first = self._install()
        second = self._install(version="2.0")
        self.assertEqual(first["state"], "done", first["error"])
        game = self.library.resolve() / "Elden Ring (1245620)"
        self.assertEqual({Path(first["path"]).parent, Path(second["path"]).parent}, {game})
        self.assertEqual([child.name for child in self.library.iterdir()], [game.name])
        # The page still compares a job with the library it was shown for.
        self.assertEqual(Path(first["directory"]), self.library.resolve())
        self.assertEqual(len(trainer_library.scan("1245620")["trainers"]), 2)
        self.assertEqual(trainer_library.scan("999", "Elden Ring")["trainers"], [])

    def test_a_renamed_game_keeps_its_folder(self):
        game = library_games.ensure(self.library, "42", "Old Name")
        self.assertEqual(library_games.ensure(self.library, "42", "New Name"), game)
        self.assertEqual(library_games.ensure(self.library, "43", "Old Name").name, "Old Name (43)")
        self.assertEqual(len(list(self.library.iterdir())), 2)

    def test_a_taken_name_is_left_alone(self):
        self._trainer(self.library / "Example (42)")
        game = library_games.ensure(self.library, "42", "Example")
        self.assertEqual(game.name, "Example (42) (2)")
        self.assertTrue((self.library / "Example (42)" / "Trainer.exe").is_file())

    def test_both_layouts_are_listed_for_their_game(self):
        self._trainer(self.library / "Old Trainer [aaaaaaaa]", {"app_ids": ["42"]})
        game = library_games.ensure(self.library, "42", "Example")
        self._trainer(game / "New Trainer [bbbbbbbb]", {"app_ids": ["42"]})
        # A file the user dropped into the game folder belongs to that game.
        (game / "Table.CT").write_bytes(b"table")
        other = library_games.ensure(self.library, "43", "Other")
        self._trainer(other / "Other Trainer", {"app_ids": ["43"]})
        names = sorted(item["name"] for item in trainer_library.scan("42")["trainers"])
        self.assertEqual(names, ["New Trainer [bbbbbbbb]", "Old Trainer [aaaaaaaa]", "Table"])
        self.assertEqual(len(trainer_library.scan()["trainers"]), 4)
        for item in trainer_library.scan("42")["trainers"]:
            program = trainer_library.executable(item["id"], item["files"][0], str(self.library))
            self.assertTrue(Path(program).is_file())

    def test_deleting_the_last_trainer_removes_the_game_folder_only_when_empty(self):
        game = library_games.ensure(self.library, "42", "Example")
        self._trainer(game / "One", {"app_ids": ["42"]})
        self._trainer(game / "Two", {"app_ids": ["42"]})
        one, two = trainer_library.scan("42")["trainers"]
        trainer_library.delete(one["id"], str(self.library), "42")
        self.assertTrue(game.is_dir())
        (game / "notes.txt").write_bytes(b"keep")
        trainer_library.delete(two["id"], str(self.library), "42")
        self.assertEqual((game / "notes.txt").read_bytes(), b"keep")
        (game / "notes.txt").unlink()
        library_games.prune(game)
        self.assertFalse(game.exists())

    def test_a_trainer_folder_is_never_taken_for_a_game_folder(self):
        folder = self.library / "Old Trainer"
        self._trainer(folder, {"app_ids": ["200"], "trainer_name": "Old"})
        library_storage.write_json(folder / library_layout.GAME_RECORD, library_layout.game_record("999", "Other"))
        item, = trainer_library.scan()["trainers"]
        self.assertEqual((item["name"], item["app_ids"]), ("Old", ["200"]))

    def test_a_game_folder_is_not_left_without_its_record(self):
        with patch("library_games.write_json", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                library_games.ensure(self.library, "42", "Example")
        self.assertEqual(list(self.library.iterdir()), [])
        self.assertEqual(library_games.ensure(self.library, "42", "Example").name, "Example (42)")

    def test_a_restore_that_does_not_happen_leaves_no_game_folder(self):
        job, cached, trainer = self._trash_download()

        def refuse(content, target, metadata, library):
            raise OSError("cannot publish")

        self.assertIsNone(trainer_library.restore_trainer(trainer, [], commit=refuse, app_id="42", game_name="Example"))
        self.assertEqual([child.name for child in self.library.iterdir()], [".gcm-trash"])
        self.assertTrue(cached.exists())

    def test_moving_into_a_library_with_the_same_game_merges_its_folder(self):
        game = library_games.ensure(self.library, "42", "Example")
        self._trainer(game / "Here", {"app_ids": ["42"]})
        target = self.root / "old-library"
        target.mkdir()
        # The game had another name when the old library made its folder.
        there = library_games.ensure(target, "42", "Earlier Name")
        self._trainer(there / "There", {"app_ids": ["42"]})
        trainer_library.set_directory(str(target))
        self.assertEqual([child.name for child in target.iterdir() if not child.name.startswith(".")], ["Earlier Name (42)"])
        self.assertEqual(sorted(item["name"] for item in trainer_library.scan("42")["trainers"]), ["Here", "There"])
        self.assertEqual(list(self.library.iterdir()), [])
        # The same trainer in both is a conflict, and nothing moves.
        back = self.root / "trainers"
        clash = library_games.ensure(back, "42", "Example")
        self._trainer(clash / "Here", {"app_ids": ["42"]})
        with self.assertRaisesRegex(ValueError, "library_conflict"):
            trainer_library.set_directory(str(back))
        self.assertTrue((there / "There" / "Trainer.exe").is_file())
        self.assertEqual([child.name for child in clash.iterdir() if not child.name.startswith(".")], ["Here"])

    def test_game_folders_move_with_the_library(self):
        game = library_games.ensure(self.library, "42", "Example")
        self._trainer(game / "Trainer", {"app_ids": ["42"]})
        target = self.root / "moved"
        target.mkdir()
        trainer_library.set_directory(str(target))
        item, = trainer_library.scan("42")["trainers"]
        self.assertEqual(Path(item["path"]), target.resolve() / "Example (42)" / "Trainer")
        self.assertEqual(list(self.library.iterdir()), [])
