"""Adapt the supplied GCM signer without importing its Windows initialization."""
from __future__ import annotations

import ast
import copy
import types
from pathlib import Path

FUNCTIONS = {
    "_enroll", "_get_credential", "_refresh_credential", "_client_meta",
    "_canonical_string", "_signed_headers", "signed_get",
}
CONSTANTS = {
    "ENROLL_ENDPOINT", "SIGNED_URL_DOWNLOAD_ENDPOINT", "SIGNED_URL_UPLOAD_ENDPOINT",
    "VERSION_CHECKER_ENDPOINT", "PATCH_PATTERNS_ENDPOINT", "CLIENT_API_KEY",
    "_ENROLL_TIMEOUT", "_RETRY_INTERVAL", "_UNKNOWN_CREDENTIAL", "_REQUEST_ATTEMPTS",
}


class Adapt(ast.NodeTransformer):
    def visit_ImportFrom(self, node):
        if node.module == "config":
            node.module = "gcm_runtime"
        return node

    def visit_Dict(self, node):
        # The only protocol-field change: describe the actual target platform.
        for key, value in zip(node.keys, node.values):
            if isinstance(key, ast.Constant) and key.value == "platform":
                if not isinstance(value, ast.Constant) or value.value != "win32":
                    raise ValueError("Unsupported GCM enrollment platform schema")
                value.value = "linux"
        return self.generic_visit(node)


def render(source: str) -> str:
    try:
        tree = ast.parse(source)
    except SyntaxError:
        raise ValueError("Invalid GCM secret configuration syntax") from None
    selected = []
    found_functions = set()
    found_constants = set()
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in FUNCTIONS:
            found_functions.add(node.name)
            selected.append(Adapt().visit(copy.deepcopy(node)))
        elif isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id in CONSTANTS:
            name = node.targets[0].id
            ast.literal_eval(node.value)  # Configuration constants must be literal data.
            found_constants.add(name)
            selected.append(node)
    if found_functions != FUNCTIONS or found_constants != CONSTANTS:
        raise ValueError("Unsupported GCM secret configuration interface")
    preamble = '''import hashlib, hmac, json, os, random, threading, time, uuid
from urllib.parse import urlparse
import gcm_transport as requests
from gcm_auth_platform import credential_path, machine_hash as _machine_hash, store_credential as _store_credential, read_credential as _read_credential
from gcm_runtime import quiet as print
_CREDENTIAL_FILE = credential_path()
_lock = threading.Lock()
_credential = None
_last_attempt = 0.0
'''
    return preamble + ast.unparse(ast.fix_missing_locations(ast.Module(body=selected, type_ignores=[]))) + "\n"


def load(path: str):
    module = types.ModuleType("decky_gcm_private_auth")
    # Compiled filename deliberately does not include the supplied secret's path.
    code = compile(render(Path(path).read_text(encoding="utf-8-sig")), "<GCM authentication>", "exec")
    exec(code, module.__dict__)
    return module
