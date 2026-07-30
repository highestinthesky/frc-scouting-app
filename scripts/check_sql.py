#!/usr/bin/env python3
"""Validate every .sql file against the real PostgreSQL grammar.

    python3 scripts/check_sql.py          # or: npm run check:sql

Uses pglast, which wraps libpg_query — the actual parser out of the PostgreSQL
source tree, not an approximation. A file that passes here will at least *parse*
on Supabase; it can still fail on semantics (a missing table, a bad column), but
it will not fail on a stray quote.

Why this exists: a typo in a migration is only discovered by pasting it into the
Supabase SQL editor and watching it fail, usually halfway through, leaving the
database in a partly-migrated state. That is a bad place to learn about a
misplaced apostrophe.

Exits non-zero on the first invalid file, so CI can gate on it.
"""

import glob
import os
import sys

try:
    import pglast
except ImportError:
    print("pglast is not installed.  pip install pglast --break-system-packages")
    sys.exit(2)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATTERNS = ["supabase/**/*.sql", "scripts/**/*.sql"]


def main() -> int:
    files = sorted(
        {f for p in PATTERNS for f in glob.glob(os.path.join(ROOT, p), recursive=True)}
    )
    if not files:
        print("No .sql files found — check the glob patterns.")
        return 1

    failures = 0
    for path in files:
        rel = os.path.relpath(path, ROOT)
        try:
            stmts = pglast.parse_sql(open(path, encoding="utf-8").read())
            print(f"  ok    {rel}  ({len(stmts)} statements)")
        except pglast.parser.ParseError as exc:
            failures += 1
            print(f"  FAIL  {rel}")
            print(f"        {exc}")

    print()
    if failures:
        print(f"{failures} file(s) failed to parse.")
        return 1
    print(f"{len(files)} SQL file(s) valid.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
