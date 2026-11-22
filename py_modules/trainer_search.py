"""Decky result IDs and isolation around the original GCM search worker."""
from __future__ import annotations

import hashlib

import gcm_bridge
import gcm_runtime


class SearchError(Exception):
    pass


def trainer_id(trainer):
    return hashlib.sha1(f"{trainer['origin']}|{trainer['url']}".encode()).hexdigest()[:16]


def search(keyword: str, lang: str = "en") -> list[dict]:
    index = gcm_bridge.load_search_index()
    from _gcm_core.download import DownloadBaseThread
    from _gcm_core.search import DownloadDisplayThread
    keyword = keyword.strip()
    if not gcm_bridge.is_chinese(keyword) and len(index.sanitize(keyword)) < index.MIN_QUERY_LEN:
        raise SearchError("keyword_too_short")
    # GCM shares class-level results and language settings. Serialize searches,
    # including translation workers, then return detached per-request records.
    with gcm_runtime.SEARCH_LOCK:
        gcm_runtime.settings["language"] = "zh_CN" if lang == "zh" else "en_US"
        index.translation_index.refresh()
        if not index.translation_index.has_data():
            raise SearchError("database_missing")
        worker = DownloadDisplayThread(keyword)
        worker.status_pause_time = 0
        worker.run()
        results = [dict(entry) for entry in DownloadBaseThread.trainer_urls]
        failures = [event for event in worker.message.events if len(event) > 1 and event[1] == "failure"]
        if failures and not (len(failures) == 1 and failures[0][0] == "No search results found."):
            raise SearchError("database_missing" if any("update" in str(e[0]).lower() for e in failures) else "search_failed")
        for entry in results:
            entry["id"] = trainer_id(entry)
            # Tables open through Cheat Engine, which the UI installs on demand.
            entry["table"] = is_table(entry)
        return results


def is_table(entry: dict) -> bool:
    return (entry.get("origin") in {"the_cheat_script", "ct_other"}
            or str(entry.get("extension", "")).lower().lstrip(".") in {"ct", "cetrainer"})


def is_cheat_engine(entry: dict) -> bool:
    """Cheat Engine ships in the catalog as an ordinary entry named after itself."""
    return (str(entry.get("game_name", "")).lower() == "none"
            and str(entry.get("custom_name", "")).strip().lower() == "cheat engine")


def cheat_engine_entry() -> dict | None:
    """The catalog's Cheat Engine package as a downloadable trainer, if listed."""
    import trainer_db
    catalog = trainer_db.load("gcm_trainers.json")
    for trainer in catalog if isinstance(catalog, list) else []:
        if isinstance(trainer, dict) and is_cheat_engine(trainer) and trainer.get("gcm_url"):
            version = str(trainer.get("version", "") or "")
            entry = {
                "game_name": "none", "origin": trainer.get("origin", "other"), "author": "",
                "custom_name": "Cheat Engine", "url": trainer["gcm_url"], "version": version, "extension": "",
                "trainer_name": f"Cheat Engine {version}".strip(), "table": False,
            }
            entry["id"] = trainer_id(entry)
            return entry
    return None
