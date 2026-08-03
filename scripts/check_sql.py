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

Beyond parsing, it lints for one semantic mistake the parser is blind to and
that I have now made in this repo: an aggregate beside a bare column with no
GROUP BY.

    SELECT id FROM (...) c HAVING count(*) = 1        -- parses. always fails.

PostgreSQL rejects that at plan time with "column must appear in the GROUP BY
clause or be used in an aggregate function", but libpg_query is a parser and
sees nothing wrong. Since the sandbox this repo is developed in has no Postgres
to execute against, the only defence is to look for the shape.

This is one lint, not a type checker. Everything else semantic — a table that
does not exist, a column of the wrong type, a policy that permits the wrong
thing — still needs a real database.
"""

import glob
import os
import sys

try:
    import pglast
    from pglast import ast
except ImportError:
    print("pglast is not installed.  pip install pglast --break-system-packages")
    sys.exit(2)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATTERNS = ["supabase/**/*.sql", "scripts/**/*.sql"]

# Set-returning and window-only functions are not aggregates for this purpose.
AGGREGATES = {
    "count", "sum", "avg", "min", "max", "array_agg", "string_agg",
    "json_agg", "jsonb_agg", "bool_and", "bool_or", "every",
}


def _walk(node):
    """Every ast.Node under `node`, itself included."""
    if isinstance(node, ast.Node):
        yield node
        for name in node.__slots__:
            yield from _walk(getattr(node, name, None))
    elif isinstance(node, (list, tuple)):
        for item in node:
            yield from _walk(item)


def _calls_aggregate(node) -> bool:
    for n in _walk(node):
        if isinstance(n, ast.FuncCall) and not n.over:
            name = ".".join(f.sval for f in (n.funcname or ()) if hasattr(f, "sval"))
            if name.lower() in AGGREGATES:
                return True
    return False


def _bare_columns(node):
    """Column references that are NOT inside an aggregate call."""
    out = []
    for n in _walk(node):
        if isinstance(n, ast.FuncCall) and not n.over:
            name = ".".join(f.sval for f in (n.funcname or ()) if hasattr(f, "sval"))
            if name.lower() in AGGREGATES:
                continue  # its arguments are aggregated, so they are fine
        if isinstance(n, ast.ColumnRef):
            out.append(".".join(
                f.sval for f in (n.fields or ()) if hasattr(f, "sval")
            ) or "*")
    return out


def aggregate_without_group_by(stmts):
    """Yield a description of every SELECT that aggregates beside a bare column.

    Deliberately narrow: it only fires when the statement aggregates AND has no
    GROUP BY AND still selects a plain column. That combination has no valid
    reading, so there are no false positives to explain away — which matters,
    because a linter people learn to ignore is worse than no linter.
    """
    for stmt in stmts:
        for node in _walk(stmt):
            if not isinstance(node, ast.SelectStmt) or node.groupClause:
                continue
            targets = node.targetList or ()
            aggregates_here = _calls_aggregate(targets) or _calls_aggregate(node.havingClause)
            if not aggregates_here:
                continue
            # Bare columns in the select list, ignoring those inside aggregates.
            bare = []
            for t in targets:
                if _calls_aggregate(t):
                    continue
                bare.extend(_bare_columns(t))
            if bare:
                yield (
                    f"aggregates and selects bare column(s) {', '.join(sorted(set(bare)))} "
                    "with no GROUP BY"
                )


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
        except pglast.parser.ParseError as exc:
            failures += 1
            print(f"  FAIL  {rel}")
            print(f"        {exc}")
            continue

        problems = list(aggregate_without_group_by(stmts))
        if problems:
            failures += 1
            print(f"  FAIL  {rel}  (parses, but will not run)")
            for p in problems:
                print(f"        {p}")
        else:
            print(f"  ok    {rel}  ({len(stmts)} statements)")

    print()
    if failures:
        print(f"{failures} file(s) failed.")
        return 1
    print(f"{len(files)} SQL file(s) valid.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
