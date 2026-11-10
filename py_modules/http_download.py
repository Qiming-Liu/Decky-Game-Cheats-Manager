"""Thin wrapper around GCM's original retry/range/cache download engine."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

DATABASE_STAGING_PREFIX = ".gcm-db-"


class _Abort(BaseException):
    """Carries a progress callback's exception past the engine's retry handlers,
    which catch Exception and would otherwise retry the chunk on a new request."""


def download(url, directory, on_progress=None, filename=None):
    """Download `url` into `directory`. An exception raised by `on_progress`
    (such as a cancellation) stops every chunk worker and is raised here."""
    from _gcm_core.download import DownloadBaseThread
    from gcm_runtime import Signal
    os.makedirs(directory, exist_ok=True)
    worker = DownloadBaseThread()
    aborted: list[Exception] = []
    if on_progress:
        def report(segments):
            if aborted:
                raise _Abort()
            try:
                on_progress(sum(s[0] for s in segments), sum(s[1] for s in segments))
            except Exception as error:
                aborted.append(error)
                raise _Abort() from error
        worker.progress = Signal(report)
    try:
        result = _download(worker, url, directory, filename)
    except _Abort:
        raise aborted[0] from None
    except Exception:
        if aborted:
            raise aborted[0] from None
        raise
    if aborted:
        raise aborted[0]
    return result


def _download(worker, url, directory, filename):
    if filename is None:
        result = worker.request_download(url, directory, raise_errors=True, atomic=True)
        if not result:
            raise OSError("GCM download failed verification")
        return result
    # Fixed database filenames must not depend on the server's Content-Disposition.
    # Copy the old cache to staging so upstream ETag/304 handling still works.
    import shutil
    from urllib.parse import unquote_plus, urlparse
    destination = Path(directory) / os.path.basename(filename)
    with tempfile.TemporaryDirectory(prefix=DATABASE_STAGING_PREFIX, dir=directory) as staging:
        cached_name = os.path.basename(unquote_plus(urlparse(url).path.rsplit("/", 1)[-1]))
        if destination.is_file() and cached_name:
            shutil.copyfile(destination, Path(staging) / cached_name)
        result = worker.request_download(url, staging, raise_errors=True, atomic=True)
        if not result:
            raise OSError("GCM download failed verification")
        # A bad response must not replace a previously working database.
        import json
        with open(result, encoding="utf-8") as source:
            data = json.load(source)
        if not isinstance(data, list):
            raise ValueError("Invalid trainer database format")
        os.replace(result, destination)
    return str(destination)
