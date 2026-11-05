"""Small catalog fixture shared by backend integration tests."""
import json
import os
import shutil
from gcm_bridge import DATABASE_PATH

FIXTURE_DB = {
    "translations.json": [
        {"en_US": "Elden Ring", "zh_CN": "艾尔登法环"},
        {"en_US": "Black Myth: Wukong", "zh_CN": "黑神话：悟空"},
    ],
    "fling_archive.json": [{"game_name": "Elden Ring", "gcm_url": "fling/archive/elden_ring.zip"}],
    "fling_main.json": [{"game_name": "Elden Ring", "gcm_url": "fling/main/elden_ring.zip", "version": "2026.01.01"}],
    "xiaoxing.json": [{"game_name": "黑神话：悟空", "gcm_url": "xx/wukong.zip"}],
    "cheat_table.json": [{"game_name": "Elden Ring", "gcm_url": "ct/elden_ring.CT", "author": "Hexinton"}],
    "gcm_trainers.json": [
        {"game_name": "none", "origin": "other", "custom_name": "Cheat Engine", "gcm_url": "gcm/ce.zip"},
        {"game_name": "Elden Ring", "origin": "ct_other", "gcm_url": "gcm/elden_ring.zip"},
        {"game_name": "Elden Ring", "origin": "gcm", "extension": ".CT", "gcm_url": "gcm/elden_ring.CT"},
        {"game_name": "Elden Ring", "origin": "other", "extension": "cetrainer", "gcm_url": "gcm/elden_ring.cetrainer"},
    ],
}


def write_fixture_db():
    shutil.rmtree(DATABASE_PATH, ignore_errors=True)
    os.makedirs(DATABASE_PATH)
    for name, content in FIXTURE_DB.items():
        with open(os.path.join(DATABASE_PATH, name), "w", encoding="utf-8") as f:
            json.dump(content, f, ensure_ascii=False)

