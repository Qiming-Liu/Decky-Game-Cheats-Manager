"""Generate Qt-free modules from the pinned GCM submodule. Never edit gcm/."""
from __future__ import annotations

import argparse
import ast
import builtins
import copy
import hashlib
import json
import os
import symtable
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "gcm" / "src" / "scripts"
MODULES = REPO / "py_modules"
sys.path.insert(0, str(MODULES))


def parse(name):
    path = SCRIPTS / name
    if not path.is_file():
        raise ValueError("GCM submodule missing; run git submodule update --init")
    return ast.parse(path.read_text(encoding="utf-8-sig"))


def functions(tree, names):
    selected = [copy.deepcopy(n) for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    if {n.name for n in selected} != set(names):
        raise ValueError("Pinned GCM function interface changed")
    return selected


class Imports(ast.NodeTransformer):
    def visit_ImportFrom(self, node):
        if node.module in {"config", "search_index"}:
            node.level = 1
        return node


class AuthNames(ast.NodeTransformer):
    def visit_Name(self, node):
        if node.id in {"SIGNED_URL_DOWNLOAD_ENDPOINT", "CLIENT_API_KEY", "signed_get"}:
            return ast.copy_location(ast.Attribute(value=ast.Name(id="auth", ctx=ast.Load()), attr=node.id, ctx=node.ctx), node)
        return node


def worker(tree, class_name, methods, bases, attributes=()):
    original = next((n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == class_name), None)
    if original is None:
        raise ValueError("Pinned GCM worker class changed")
    body = functions(ast.Module(body=original.body, type_ignores=[]), methods)
    for node in original.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in attributes for t in node.targets):
            body.insert(0, copy.deepcopy(node))
    result = ast.ClassDef(name=class_name, bases=[ast.Name(id=b, ctx=ast.Load()) for b in bases], keywords=[], body=body, decorator_list=[])
    return ast.fix_missing_locations(AuthNames().visit(result))


def validate(source, name):
    compile(source, name, "exec")
    table = symtable.symtable(source, name, "exec")
    known = {s.get_name() for s in table.get_symbols() if s.is_assigned() or s.is_imported()} | set(dir(builtins)) | {"__name__", "__file__"}
    def check(scope):
        for symbol in scope.get_symbols():
            if symbol.is_referenced() and symbol.is_global() and symbol.get_name() not in known:
                raise ValueError(f"Unadapted upstream dependency in {name}: {symbol.get_name()}")
        for child in scope.get_children():
            check(child)
    check(table)


def emit(output, name, preamble, nodes):
    source = "# Generated from the pinned GCM submodule; GPL-3.0. Do not edit.\n" + preamble + "\n" + ast.unparse(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[]))) + "\n"
    validate(source, name)
    (output / name).write_text(source, encoding="utf-8")


def build(output, secret=None):
    output.mkdir(parents=True, exist_ok=True)
    config = parse("config.py")
    names = {"APP_VERSION", "API_TIMEOUT", "RETRY_STATUSES"}
    constants = [n for n in config.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in names for t in n.targets)]
    if len(constants) != len(names):
        raise ValueError("Pinned GCM configuration interface changed")
    emit(output, "config.py", "import re, unicodedata\nfrom pypinyin import lazy_pinyin\nfrom gcm_runtime import DATABASE_PATH, is_chinese", constants + functions(config, {"trainer_sort_key"}))
    index = Imports().visit(parse("search_index.py"))
    emit(output, "search_index.py", "", index.body)
    download_tree = parse("threads/download_base_thread.py")
    download_constants = [n for n in download_tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in {"_PARALLEL_THRESHOLD", "_DOWNLOAD_TIMEOUT"} for t in n.targets)]
    if len(download_constants) != 2:
        raise ValueError("Pinned GCM download constants changed")
    base = worker(download_tree, "DownloadBaseThread", {
        "__init__", "request_download", "download_queued", "find_download_fname",
        "get_signed_download_url", "find_best_trainer_match", "translate_trainer", "load_json_content",
    }, ["QThread"], {"trainer_urls", "headers"})
    emit(output, "download.py", '''import hashlib, json, os, queue, threading, time, uuid
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse, unquote, unquote_plus
import gcm_transport as requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from gcm_runtime import BackendWorker as QThread, DATABASE_PATH, settings, is_chinese, tr, auth, quiet as print
from .config import API_TIMEOUT, RETRY_STATUSES
from .search_index import translation_index
''', download_constants + functions(download_tree, {"create_http_session"}) + [base])
    search_tree = parse("threads/download_display_thread.py")
    search_class = next(n for n in search_tree.body if isinstance(n, ast.ClassDef) and n.name == "DownloadDisplayThread")
    methods = {n.name for n in search_class.body if isinstance(n, ast.FunctionDef)}
    expected = {"__init__", "run", "translate_keyword", "keyword_match", "search_from_fling_archive", "search_from_fling_main", "search_from_xiaoxing", "search_from_ct", "search_from_gcm"}
    if methods != expected:
        raise ValueError("Pinned GCM search worker interface changed")
    emit(output, "search.py", '''import concurrent.futures, time, traceback
from gcm_runtime import settings, is_chinese, tr, quiet as print
from .config import trainer_sort_key
from .search_index import MIN_QUERY_LEN, QueryMatcher, sanitize, translation_index
from .download import DownloadBaseThread
''', [worker(search_tree, "DownloadDisplayThread", expected, ["DownloadBaseThread"])])
    if secret:
        from gcm_auth_adapter import render
        source = render(Path(secret).read_text(encoding="utf-8-sig"))
        validate(source, "auth.py")
        path = output / "auth.py"
        path.write_text(source, encoding="utf-8")
        os.chmod(path, 0o600)
    else:
        # A no-secret build must not accidentally reuse a previous release's key.
        (output / "auth.py").unlink(missing_ok=True)
    (output / "__init__.py").write_text('"""Generated GCM core (GPL-3.0)."""\n', encoding="utf-8")
    files = ("config.py", "search_index.py", "threads/download_base_thread.py", "threads/download_display_thread.py")
    manifest = {name: hashlib.sha256((SCRIPTS / name).read_bytes()).hexdigest() for name in files}
    (output / "sources.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("Generated GCM core; authentication " + ("included" if secret else "not configured"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--secret", default=os.environ.get("GCM_SECRET_CONFIG_PATH"))
    parser.add_argument("--output", type=Path, default=MODULES / "_gcm_core")
    args = parser.parse_args()
    secret = args.secret
    if not secret and (MODULES / "secret_config.py").is_file():
        secret = MODULES / "secret_config.py"
    try:
        build(args.output, secret)
    except Exception as error:
        # SyntaxError can include source lines from the private input. Never print it.
        print(f"GCM core generation failed ({type(error).__name__}); check source compatibility and configuration.", file=sys.stderr)
        sys.exit(1)
