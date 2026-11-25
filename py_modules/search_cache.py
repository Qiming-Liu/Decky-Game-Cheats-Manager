"""Search results the frontend may ask to download.

A bounded cache shared by both panels: searching another game must not
invalidate the first panel's download buttons. Only cached IDs are accepted.
"""
from __future__ import annotations

MAX_RESULTS = 2000
RESULTS: dict[str, dict] = {}


def remember(results: list[dict]) -> None:
    RESULTS.update({item["id"]: item for item in results})
    while len(RESULTS) > MAX_RESULTS:
        del RESULTS[next(iter(RESULTS))]
