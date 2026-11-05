# Tests

- `backend/`: authentication, catalog integrity, library transactions, download lifecycle, cache ownership, and archive safeguards.
- `frontend/`: Steam menu cleanup, guarded launch-option edits, version selection, and language detection.
- `tooling/`: development payload boundaries and executable release packaging.
- `support/`: the Decky stub, catalog fixtures, and shared installation helpers; no test cases.
- `fixtures/`: an inert stand-in for the private data-source configuration. It has its
  own fictional flow and must never describe the real service or use real credentials.
- `private/`: Git-ignored, local only. Tests that exercise the Windows-to-SteamOS
  adaptation of the real configuration layout live here, never in a tracked directory.

Run all suites with `pnpm test`, or separately:

```bash
pnpm run test:frontend
pnpm run test:backend
pnpm run typecheck
```

The backend command generates the GCM core before running recursive unittest discovery.
Install vendored Python dependencies first (`bash scripts/vendor_deps.sh`). Use CPython
3.14, matching Decky, for the release bytecode packaging checks. Direct discovery is
`python -m unittest discover -s tests -v` after generation. Python test directories
contain `__init__.py` so discovery includes their modules.

Keep tests focused on plugin behavior and meaningful regressions. Do not duplicate
upstream search/range/cache algorithms or freeze translated copy and internal layouts.
