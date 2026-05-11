#!/usr/bin/env python3
"""
check-ai-keys.py — source-vs-doc lint for queryKey / mutationKey strings.

For every `queryKey: [...]` and `mutationKey: [...]` literal in
`src/hooks/**/*.ts`, extracts the leading STRING-LITERAL PREFIX (e.g.
`['staking', 'info', srcChainKey, srcAddress]` → `('staking', 'info')`).

Then walks `ai-exported/**/*.md` and finds the same syntactic forms in
fenced code blocks and inline-code spans. Every doc claim's literal prefix
MUST exist in the source set; otherwise the doc is out of sync.

This is the surgical lint for the `'stakingInfo'` vs `'info'`-style drift
class. Variable segments (chain keys, addresses, etc.) are ignored — only
the literal string-prefix is checked, which is what determines React
Query's key-tree placement.

Example failure:
    ai-exported/integration/reference/querykey-conventions.md:124
        doc: ['staking', 'stakingInfo', srcChainKey, srcAddress]
        not found in source. Closest match: ('staking', 'info', ...)

Allow-list mechanism: lines or tables that intentionally document a v1 key
(for migration narratives) can carry an inline `<!-- ai-keys-allow -->`
HTML comment within ~3 lines of the array to opt out.

Run:
    python3 scripts/check-ai-keys.py
Exits 0 on clean, non-zero with diff on drift.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "src" / "hooks"
DOCS_DIR = ROOT / "ai-exported"

# Regex to find `queryKey:` / `mutationKey:` followed by an opening `[`.
# The closing `]` is found by scanning for the balancing bracket.
KEY_DECL = re.compile(r"\b(queryKey|mutationKey)\s*:\s*\[", re.MULTILINE)

# Backticked-array-in-table form: `` `['feature', 'action', ...]` ``. The kind is
# inferred from neighboring text — if "mutationKey" appears in nearby prose, treat
# as mutationKey; default to queryKey (most common in tables). This catches
# reference-doc table cells documenting key shapes.
TABLE_BACKTICK_ARRAY = re.compile(r"`(\[\s*['\"][a-zA-Z0-9_]+['\"][^`]*\])`", re.MULTILINE)

# Single string literal — either single- or double-quoted, no escapes for now (none of our
# keys contain escapes). Cleanly handles backticks too just in case.
STRING_LIT = re.compile(r"['\"`]([a-zA-Z0-9_]+)['\"`]")

# Allow-markers — either an HTML comment (markdown-friendly) or a TS line comment
# (useful inside fenced code blocks where HTML comments render as plain text).
# The rationale text after the marker is optional — `<!-- ai-keys-allow — why -->`
# and `<!-- ai-keys-allow -->` both opt out.
ALLOW_COMMENT = re.compile(r"<!--\s*ai-keys-allow\b.*?-->|//\s*ai-keys-allow\b", re.DOTALL)


def find_array_end(text: str, open_idx: int) -> int:
    """Given index of the `[` after `queryKey:`/`mutationKey:`, return the index
    of its matching `]`. Naive bracket-counting; assumes no brackets inside the
    literal string segments themselves (true for our keys)."""
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
    """Tokenize an array body (between `[` and `]`) and return the leading
    string-literal prefix tokens. Stops at the first non-literal token."""
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


def extract_keys(text: str) -> list[tuple[str, tuple[str, ...], int, int]]:  # noqa: C901
    # NB: backticked-table forms emit kind='any' to signal the consumer should match
    # against source regardless of query/mutation distinction. Tables genuinely lack
    # kind context.
    """Return list of `(kind, literal-prefix, start_offset, end_offset)`.

    `literal-prefix` is the longest tuple of consecutive string-literal
    segments at the start of the array. Once a non-literal segment appears
    (variable, expression, etc.), prefix-collection stops.

    Detects two forms:
      1. `queryKey: [...]` / `mutationKey: [...]` declarations (source + docs).
      2. Backticked arrays in markdown tables — `` `['feature', 'action']` `` —
         where the kind is inferred from prose context within ~3 lines.
    """
    results = []
    # Form 1: explicit kind: [...] declarations
    for m in KEY_DECL.finditer(text):
        kind = m.group(1)
        open_idx = m.end() - 1  # position of `[`
        close_idx = find_array_end(text, open_idx)
        if close_idx < 0:
            continue
        body = text[open_idx + 1 : close_idx]
        prefix = _collect_prefix(body)
        results.append((kind, tuple(prefix), m.start(), close_idx + 1))
    # Form 2: backticked arrays in tables. Tables genuinely lack kind context (a row
    # `| ['mm', 'supply'] | useSupply mutation |` could be either), so we emit kind='any'
    # and the comparator accepts a match against EITHER queryKey or mutationKey source set.
    for m in TABLE_BACKTICK_ARRAY.finditer(text):
        # Skip if this position is already inside a form-1 match.
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


def collect_source_set() -> set[tuple[str, tuple[str, ...]]]:
    """Walk src/hooks/**/*.ts; gather (kind, prefix) pairs."""
    seen: set[tuple[str, tuple[str, ...]]] = set()
    for ts in SRC_DIR.rglob("*.ts"):
        if ts.name.endswith(".test.ts"):
            continue
        text = ts.read_text()
        for kind, prefix, _, _ in extract_keys(text):
            if prefix:
                seen.add((kind, prefix))
    return seen


def collect_doc_claims() -> list[tuple[Path, int, str, tuple[str, ...], str]]:
    """Walk ai-exported/**/*.md; gather (file, line, kind, prefix, full-array-text).
    Skips claims preceded by `<!-- ai-keys-allow -->` within 3 lines."""
    claims = []
    for md in DOCS_DIR.rglob("*.md"):
        text = md.read_text()
        for kind, prefix, start, end in extract_keys(text):
            if not prefix:
                continue
            # Look for allow-marker in the 6 lines preceding the claim. Window is wider
            # than the natural 1-2 lines so a single marker can cover a small cluster of
            # v1/illustrative arrays (common in v1→v2 diff blocks).
            line_no = line_of(text, start)
            lines = text.splitlines()
            preceding = "\n".join(lines[max(0, line_no - 7) : line_no - 1])
            if ALLOW_COMMENT.search(preceding):
                continue
            claims.append((md, line_no, kind, prefix, text[start:end]))
    return claims


def closest_match(prefix: tuple[str, ...], source_set: set[tuple[str, tuple[str, ...]]], kind: str) -> tuple[str, ...] | None:
    """Find the source prefix that shares the longest leading subsequence with `prefix`.
    `kind` filters by query/mutation; passing 'any' searches across both."""
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
        # Prefer ties with same first segment (feature) to surface more relevant matches.
        if score > best_score or (score == best_score and best is None):
            best = cand
            best_score = score
    return best if best_score > 0 else None


def main() -> int:
    source_set = collect_source_set()
    if not source_set:
        print("error: no queryKey/mutationKey literals found in src/hooks/", file=sys.stderr)
        return 2

    claims = collect_doc_claims()
    if not claims:
        print(f"ok: no queryKey/mutationKey claims found in {DOCS_DIR.relative_to(ROOT)}/ (nothing to check)")
        return 0

    failures = []
    for file, line, kind, prefix, raw in claims:
        # 'any' kind (from table backtick form) matches against either query or mutation source.
        candidate_kinds = ("queryKey", "mutationKey") if kind == "any" else (kind,)
        # Exact match against any candidate kind.
        if any((k, prefix) in source_set for k in candidate_kinds):
            continue
        # Doc shows a shorter prefix than source (valid bare/partial invalidation reference).
        if any(
            sk in candidate_kinds and src[: len(prefix)] == prefix
            for (sk, src) in source_set
        ):
            continue
        match = closest_match(prefix, source_set, candidate_kinds[0])
        failures.append((file, line, kind, prefix, raw, match))

    if not failures:
        print(f"ok: {len(claims)} queryKey/mutationKey claims (across {DOCS_DIR.relative_to(ROOT)}) match source prefixes")
        return 0

    print(f"FAIL: {len(failures)} doc queryKey/mutationKey claim(s) do not match source.", file=sys.stderr)
    print(file=sys.stderr)
    for file, line, kind, prefix, raw, match in failures:
        rel = file.relative_to(ROOT)
        print(f"  {rel}:{line}", file=sys.stderr)
        print(f"      doc {kind}: {raw}", file=sys.stderr)
        print(f"      → literal prefix {list(prefix)} not in source set.", file=sys.stderr)
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
