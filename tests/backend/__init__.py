"""Backend tests with an isolated Decky runtime stub."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "tests" / "support"), str(ROOT / "py_modules"), str(ROOT)]
import main  # Initialize vendored dependencies before backend imports.
