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
        # Hide tables until the Decky UI can load and control them through Cheat Engine.
        results = [
            dict(entry) for entry in DownloadBaseThread.trainer_urls
            if entry.get("origin") not in {"the_cheat_script", "ct_other"}
            and str(entry.get("extension", "")).lower().lstrip(".") not in {"ct", "cetrainer"}
        ]
        failures = [event for event in worker.message.events if len(event) > 1 and event[1] == "failure"]
        if failures and not (len(failures) == 1 and failures[0][0] == "No search results found."):
            raise SearchError("database_missing" if any("update" in str(e[0]).lower() for e in failures) else "search_failed")
        for entry in results:
            entry["id"] = trainer_id(entry)
        return results
