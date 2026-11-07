"""Adapt the author-supplied GCM configuration (a Windows module) to SteamOS.

The rules are generic and know nothing about the configuration's contents:

- Windows-only imports, everything that depends on them, and import-time statements
  are dropped; private values only that code used go with them.
- Names the remaining code still needs are taken from `gcm_auth_binding`, a Git-ignored
  mapping onto `gcm_auth_platform`, so no private name appears in this repository.
- The public upstream imports are redirected to the Decky runtime. String constants
  that exactly equal a key of the binding's optional `LITERALS` mapping are replaced
  by its value; without one, 'win32' becomes 'steamos'.

Only the interface upstream GCM's config.py declares is checked: `signed_get` and the
endpoint constants. Nothing here describes, tests or depends on the service protocol.
"""
from __future__ import annotations

import ast
import builtins
import copy
import importlib
import symtable
import types
from pathlib import Path

WINDOWS_MODULES = {"winreg", "ctypes", "msvcrt", "_winapi", "win32api", "win32crypt", "win32con", "pywintypes"}
REQUIRED_CONSTANTS = ("CLIENT_API_KEY", "SIGNED_URL_DOWNLOAD_ENDPOINT")
BINDING_MODULE = "gcm_auth_binding"
PREAMBLE = "import gcm_transport as requests\nfrom gcm_runtime import quiet as print\n"


DEFAULT_LITERALS = {"win32": "steamos"}


class Adapt(ast.NodeTransformer):
    def __init__(self, literals=None):
        self.literals = DEFAULT_LITERALS if literals is None else literals

    def visit_Import(self, node):
        node.names = [alias for alias in node.names if alias.name != "requests"]
        return node if node.names else None

    def visit_ImportFrom(self, node):
        if node.module == "config":
            node.module = "gcm_runtime"
        return node

    def visit_Constant(self, node):
        # Exact matches only: a path or message that merely contains the text is kept.
        if isinstance(node.value, str) and node.value in self.literals:
            return ast.copy_location(ast.Constant(value=self.literals[node.value]), node)
        return node


def _defined(node):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return {node.name}
    if isinstance(node, ast.Assign):
        return {target.id for target in node.targets if isinstance(target, ast.Name)}
    if isinstance(node, (ast.Import, ast.ImportFrom)):
        return {(alias.asname or alias.name).split(".")[0] for alias in node.names}
    return set()


def _referenced(node):
    names = set()
    for child in ast.walk(node):
        if isinstance(child, ast.Name) and isinstance(child.ctx, ast.Load):
            names.add(child.id)
        elif isinstance(child, (ast.Global, ast.Nonlocal)):
            names.update(child.names)
    return names


def _imports_windows(node):
    if isinstance(node, ast.Import):
        return any(alias.name.split(".")[0] in WINDOWS_MODULES for alias in node.names)
    return isinstance(node, ast.ImportFrom) and (node.module or "").split(".")[0] in WINDOWS_MODULES


def _binding_module():
    try:
        return importlib.import_module(BINDING_MODULE)
    except ModuleNotFoundError as error:
        if error.name != BINDING_MODULE:
            raise
        return None


def _binding():
    module = _binding_module()
    return dict(module.BINDING) if module else {}


def _literals():
    module = _binding_module()
    literals = getattr(module, "LITERALS", None) if module else None
    if literals is None:
        return dict(DEFAULT_LITERALS)
    if not all(isinstance(key, str) and isinstance(value, str) for key, value in dict(literals).items()):
        raise ValueError("Platform binding literals must map strings to strings")
    return dict(literals)


def _select(body, bound):
    """Drop the Windows layer; return the kept nodes and the bound names they still use."""
    kept = [node for node in body if not isinstance(node, ast.Expr)]
    tainted = set()
    while True:
        dropped = [node for node in kept if _imports_windows(node) or _defined(node) & bound or _referenced(node) & tainted]
        if not dropped:
            break
        for node in dropped:
            if not _defined(node) & bound:
                tainted |= _defined(node)
        kept = [node for node in kept if node not in dropped]
    while True:
        used = set().union(*(_referenced(node) for node in kept)) if kept else set()
        dead = [node for node in kept if isinstance(node, ast.Assign) and _defined(node)
                and all(name.startswith("_") and name not in used for name in _defined(node))]
        if not dead:
            break
        kept = [node for node in kept if node not in dead]
    used = set().union(*(_referenced(node) for node in kept)) if kept else set()
    if used & tainted:
        raise ValueError("GCM configuration depends on Windows-only code with no platform binding")
    return kept, sorted(used & bound)


def validate(source: str, name: str):
    """Reject output that still references anything this plugin does not provide."""
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


def render(source: str) -> str:
    try:
        tree = ast.parse(source)
    except SyntaxError:
        raise ValueError("Invalid GCM data-source configuration syntax") from None
    binding = _binding()
    kept, needed = _select(copy.deepcopy(tree.body), set(binding))
    functions = {node.name for node in kept if isinstance(node, ast.FunctionDef)}
    constants = {name for node in kept if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str)
                 for name in _defined(node)}
    if "signed_get" not in functions or not set(REQUIRED_CONSTANTS) <= constants:
        raise ValueError("Unsupported GCM data-source configuration interface")
    # Binding values are gcm_auth_platform attributes, optionally called ("state_path()").
    platform = ("import gcm_auth_platform\n" + "".join(f"{name} = gcm_auth_platform.{binding[name]}\n" for name in needed)) if needed else ""
    adapt = Adapt(_literals())
    body = [node for node in (adapt.visit(node) for node in kept) if node is not None]
    result = PREAMBLE + platform + ast.unparse(ast.fix_missing_locations(ast.Module(body=body, type_ignores=[]))) + "\n"
    validate(result, "<GCM data source>")
    return result


def load(path: str):
    module = types.ModuleType("decky_gcm_private_auth")
    # Compiled filename deliberately does not include the supplied file's path.
    code = compile(render(Path(path).read_text(encoding="utf-8-sig")), "<GCM data source>", "exec")
    exec(code, module.__dict__)
    return module
