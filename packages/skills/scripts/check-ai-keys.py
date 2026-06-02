#!/usr/bin/env python3
"""
check-ai-keys.py — source-vs-doc lint for queryKey / mutationKey strings.

For every `queryKey: [...]` and `mutationKey: [...]` literal in the source
hooks directory, extracts the leading STRING-LITERAL PREFIX (e.g.
`['staking', 'info', srcChainKey, srcAddress]` → `('staking', 'info')`).

Then walks the docs directory and finds the same syntactic forms in
fenced code blocks and inline-code spans. Every doc claim's literal prefix
MUST exist in the source set; otherwise the doc is out of sync.

This is the surgical lint for the `'stakingInfo'` vs `'info'`-style drift
class. Variable segments (chain keys, addresses, etc.) are ignored — only
the literal string-prefix is checked, which is what determines React
Query's key-tree placement.

Allow-list mechanism: lines or tables that intentionally document a v1 key
(for migration narratives) can carry an inline `<!-- ai-keys-allow -->`
HTML comment within ~3 lines of the array to opt out.

Usage:
    check-ai-keys.py --src <src/hooks dir> --docs <knowledge dir>
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# Regex to find `queryKey:` / `mutationKey:` followed by an opening `[`.
KEY_DECL = re.compile(r"\b(queryKey|mutationKey)\s*:\s*\[", re.MULTILINE)

# Backticked-array-in-table form: `` `['feature', 'action', ...]` ``.
TABLE_BACKTICK_ARRAY = re.compile(r"`(\[\s*['\"][a-zA-Z0-9_]+['\"][^`]*\])`", re.MULTILINE)

STRING_LIT = re.compile(r"['\"`]([a-zA-Z0-9_]+)['\"`]")

ALLOW_COMMENT = re.compile(r"<!--\s*ai-keys-allow\b.*?-->|//\s*ai-keys-allow\b", re.DOTALL)


def find_array_end(text: str, open_idx: int) -> int:
    depth = 1
    i = open_idx + 1
    while i < len(text):
        c = text[i]
        if c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def _collect_prefix(body: str) -> list[str]:
    """Tokenize an array body and return the leading string-literal prefix."""
    prefix: list[str] = []
    depth = 0
    token = ""
    tokens: list[str] = []
    for ch in body:
        if ch in "([{":
            depth += 1
            token += ch
        elif ch in ")]}":
            depth -= 1
            token += ch
        elif ch == "," and depth == 0:
            tokens.append(token.strip())
            token = ""
        else:
            token += ch
    if token.strip():
        tokens.append(token.strip())
    for tok in tokens:
        lit = STRING_LIT.fullmatch(tok)
        if not lit:
            break
        prefix.append(lit.group(1))
    return prefix


def extract_keys(text: str) -> list[tuple[str, tuple[str, ...], int, int]]:
    """Return list of `(kind, literal-prefix, start_offset, end_offset)`."""
    results = []
    for m in KEY_DECL.finditer(text):
        kind = m.group(1)
        open_idx = m.end() - 1
        close_idx = find_array_end(text, open_idx)
        if close_idx < 0:
            continue
        body = text[open_idx + 1 : close_idx]
        prefix = _collect_prefix(body)
        results.append((kind, tuple(prefix), m.start(), close_idx + 1))
    for m in TABLE_BACKTICK_ARRAY.finditer(text):
        overlap = any(start <= m.start() < end for _, _, start, end in results)
        if overlap:
            continue
        body = m.group(1)[1:-1]
        prefix = _collect_prefix(body)
        if not prefix:
            continue
        results.append(("any", tuple(prefix), m.start(), m.end()))
    return results


def line_of(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def collect_source_set(src_dir: Path) -> set[tuple[str, tuple[str, ...]]]:
    seen: set[tuple[str, tuple[str, ...]]] = set()
    for ts in src_dir.rglob("*.ts"):
        if ts.name.endswith(".test.ts"):
            continue
        text = ts.read_text()
        for kind, prefix, _, _ in extract_keys(text):
            if prefix:
                seen.add((kind, prefix))
    return seen


def collect_doc_claims(docs_dir: Path, root: Path) -> list[tuple[Path, int, str, tuple[str, ...], str]]:
    claims = []
    for md in docs_dir.rglob("*.md"):
        text = md.read_text()
        for kind, prefix, start, end in extract_keys(text):
            if not prefix:
                continue
            line_no = line_of(text, start)
            lines = text.splitlines()
            preceding = "\n".join(lines[max(0, line_no - 7) : line_no - 1])
            if ALLOW_COMMENT.search(preceding):
                continue
            claims.append((md, line_no, kind, prefix, text[start:end]))
    return claims


def closest_match(prefix: tuple[str, ...], source_set: set[tuple[str, tuple[str, ...]]], kind: str) -> tuple[str, ...] | None:
    candidates = [p for (k, p) in source_set if kind == "any" or k == kind]
    best: tuple[str, ...] | None = None
    best_score = 0
    for cand in candidates:
        score = 0
        for a, b in zip(prefix, cand):
            if a == b:
                score += 1
            else:
                break
        if score > best_score or (score == best_score and best is None):
            best = cand
            best_score = score
    return best if best_score > 0 else None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", required=True, help="Source hooks directory (e.g. ../dapp-kit/src/hooks)")
    parser.add_argument("--docs", required=True, help="Knowledge docs directory (e.g. knowledge/dapp-kit)")
    args = parser.parse_args()

    src_dir = Path(args.src).resolve()
    docs_dir = Path(args.docs).resolve()
    root = Path.cwd()

    if not src_dir.is_dir():
        print(f"FATAL: --src directory not found: {src_dir}", file=sys.stderr)
        return 2
    if not docs_dir.is_dir():
        print(f"FATAL: --docs directory not found: {docs_dir}", file=sys.stderr)
        return 2

    source_set = collect_source_set(src_dir)
    if not source_set:
        print(f"error: no queryKey/mutationKey literals found in {src_dir}", file=sys.stderr)
        return 2

    claims = collect_doc_claims(docs_dir, root)
    if not claims:
        print(f"ok: no queryKey/mutationKey claims found in {docs_dir} (nothing to check)")
        return 0

    failures = []
    for file, line, kind, prefix, raw in claims:
        candidate_kinds = ("queryKey", "mutationKey") if kind == "any" else (kind,)
        if any((k, prefix) in source_set for k in candidate_kinds):
            continue
        if any(
            sk in candidate_kinds and src[: len(prefix)] == prefix
            for (sk, src) in source_set
        ):
            continue
        match = closest_match(prefix, source_set, candidate_kinds[0])
        failures.append((file, line, kind, prefix, raw, match))

    if not failures:
        print(f"ok: {len(claims)} queryKey/mutationKey claims (across {docs_dir}) match source prefixes")
        return 0

    print(f"FAIL: {len(failures)} doc queryKey/mutationKey claim(s) do not match source.", file=sys.stderr)
    print(file=sys.stderr)
    for file, line, kind, prefix, raw, match in failures:
        try:
            rel = file.relative_to(root)
        except ValueError:
            rel = file
        print(f"  {rel}:{line}", file=sys.stderr)
        print(f"      doc {kind}: {raw}", file=sys.stderr)
        print(f"      -> literal prefix {list(prefix)} not in source set.", file=sys.stderr)
        if match:
            print(f"      closest source prefix: {list(match)}", file=sys.stderr)
        print(file=sys.stderr)
    print(
        "Fix the doc to match source key segments, OR (if intentionally documenting a v1 key for migration) ",
        file=sys.stderr,
    )
    print("add `<!-- ai-keys-allow -->` within 3 lines preceding the array.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
