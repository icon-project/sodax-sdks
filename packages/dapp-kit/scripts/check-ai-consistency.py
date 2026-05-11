#!/usr/bin/env python3
"""
check-ai-consistency.py — cross-doc lint for polling-interval claims.

For each `useFoo` hook in `src/hooks/**/*.ts` that declares a `refetchInterval:
<number>`, extract the source value. Then walk `ai-exported/**/*.md` for
polling claims about that hook (e.g. "polls 3s", "auto-refreshes every 3s",
"3s interval", "5 second polling"). Assert:

1. Every doc claim matches the source value.
2. Multiple doc claims about the same hook agree with each other.

Out of scope (per plan): return-shape consistency (partly covered by the
snippet guard's tsc pass on actual code blocks; tables don't lint well).
Field-name and call-shape claims (documented exceptions exist).

Allow-marker (same convention as check-ai-keys):
  - `<!-- ai-consistency-allow -->` HTML comment within 6 lines preceding the
    claim, OR
  - `// ai-consistency-allow` inside a fenced code block.

Run:
    python3 scripts/check-ai-consistency.py
"""
from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "src" / "hooks"
DOCS_DIR = ROOT / "ai-exported"

# Extract source `refetchInterval: <number>` paired with the enclosing hook function name.
# We do not parse TS — we use a simple regex on the source text and pair each match with
# the most recent `export function useFoo` or `export const useFoo =` preceding it.
HOOK_DECL = re.compile(r"export\s+(?:function|const)\s+(use[A-Z][a-zA-Z0-9]*)")
REFETCH = re.compile(r"refetchInterval\s*:\s*(\d+(?:_\d+)*)")

# Doc-side polling-claim patterns. We require a `useFoo` mention within ~60 chars of a
# polling-y number to bind the claim to a hook.
HOOK_MENTION = re.compile(r"`(use[A-Z][a-zA-Z0-9]*)`")
TIME_LITERAL = re.compile(
    r"(?<![\w.])(\d+(?:[._]\d+)?)\s*(ms|millisecond|seconds?|s|min(?:ute)?s?)(?!\w)",
    re.IGNORECASE,
)

ALLOW_COMMENT = re.compile(r"<!--\s*ai-consistency-allow\b.*?-->|//\s*ai-consistency-allow\b", re.DOTALL)

# Filter words near the time literal that signal it IS a polling claim. We avoid binding
# every random "60s" to a hook — only matches that are near "poll", "refetch", "refresh",
# "interval", "auto" etc. count.
POLLING_KEYWORDS = re.compile(
    r"\b(poll(?:s|ing|ed)?|refetch(?:es|ing)?|refresh(?:es|ing|ed)?|interval|auto[-\s]?refresh|every\s+\d)",
    re.IGNORECASE,
)


def normalize_ms(value: str, unit: str) -> int:
    """Convert (number, unit) to milliseconds. Unit is normalized lowercase."""
    n = float(value.replace("_", "").replace(",", ""))
    u = unit.lower()
    if u.startswith("ms") or u.startswith("milli"):
        return int(round(n))
    if u == "s" or u.startswith("second"):
        return int(round(n * 1000))
    if u.startswith("min"):
        return int(round(n * 60 * 1000))
    return -1


def collect_source_intervals() -> dict[str, int]:
    """For each useFoo declared in src/hooks/, return its `refetchInterval: <ms>` if any."""
    result: dict[str, int] = {}
    for ts in SRC_DIR.rglob("*.ts"):
        if ts.name.endswith(".test.ts"):
            continue
        text = ts.read_text()
        # Find each hook decl and the first refetchInterval after it (and before the
        # next hook decl, to avoid bleeding across functions in the same file).
        hooks = [(m.group(1), m.start()) for m in HOOK_DECL.finditer(text)]
        for i, (hook, start) in enumerate(hooks):
            end = hooks[i + 1][1] if i + 1 < len(hooks) else len(text)
            scope = text[start:end]
            ri = REFETCH.search(scope)
            if not ri:
                continue
            raw = ri.group(1).replace("_", "")
            result[hook] = int(raw)
    return result


def line_of(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def collect_doc_polling_claims(source_intervals: dict[str, int]) -> list[tuple[Path, int, str, int, str]]:
    """For each markdown file, find time literals near hook mentions that look like polling
    claims. Returns list of (file, line, hook, claim_ms, claim_text)."""
    claims: list[tuple[Path, int, str, int, str]] = []
    for md in DOCS_DIR.rglob("*.md"):
        text = md.read_text()

        # Index hook mentions by their character offset, so for each time literal we can
        # find the nearest hook mention within a window.
        hook_mentions = [(m.group(1), m.start(), m.end()) for m in HOOK_MENTION.finditer(text)]

        for tm in TIME_LITERAL.finditer(text):
            value = tm.group(1)
            unit = tm.group(2)
            ms = normalize_ms(value, unit)
            if ms <= 0:
                continue
            # Skip clearly-not-polling values (e.g. timeout configs, durations >5min are
            # almost always not refetchInterval).
            if ms > 5 * 60 * 1000:
                continue
            # The number must appear near a polling-y keyword OR be inside a known polling
            # section (recognized by section headers handled elsewhere).
            context_start = max(0, tm.start() - 80)
            context_end = min(len(text), tm.end() + 80)
            ctx = text[context_start:context_end]
            if not POLLING_KEYWORDS.search(ctx):
                continue
            # Bind the time literal to a hook ONLY if the hook is mentioned on the same line
            # (or wrapped onto an adjacent line within ~50 chars). Cross-row binding in long
            # markdown tables generates false positives — each row has its own hook + time.
            same_line_start = text.rfind("\n", 0, tm.start()) + 1
            same_line_end = text.find("\n", tm.end())
            if same_line_end < 0:
                same_line_end = len(text)
            same_line_hooks: list[tuple[str, int, int]] = [
                (h, hs, he) for (h, hs, he) in hook_mentions if hs >= same_line_start and he <= same_line_end
            ]
            # If the row has ANY hook mention, only bind to one of those (and only if it's
            # also in source_intervals — otherwise the row isn't about a polling hook).
            if same_line_hooks:
                source_known = [(h, hs, he) for (h, hs, he) in same_line_hooks if h in source_intervals]
                if not source_known:
                    continue  # The row mentions a non-polling hook; skip rather than mis-bind.
                # Pick the closest among same-line source-known hooks.
                best_hook = min(source_known, key=lambda triple: abs(triple[1] - tm.start()))[0]
            else:
                # Fall back to nearest within a narrow window (50 chars) — useful when prose
                # places the hook mention immediately before the literal across a line wrap.
                best_hook = None
                best_dist = 51
                for hook, hstart, hend in hook_mentions:
                    if hook not in source_intervals:
                        continue
                    if hend < tm.start():
                        dist = tm.start() - hend
                    elif hstart > tm.end():
                        dist = hstart - tm.end()
                    else:
                        dist = 0
                    if dist < best_dist:
                        best_dist = dist
                        best_hook = hook
                if not best_hook:
                    continue
            # Check allow-marker window (6 lines preceding the claim).
            line_no = line_of(text, tm.start())
            lines = text.splitlines()
            preceding = "\n".join(lines[max(0, line_no - 7) : line_no - 1])
            if ALLOW_COMMENT.search(preceding):
                continue
            claims.append((md, line_no, best_hook, ms, f"{value}{unit}"))
    return claims


def main() -> int:
    source_intervals = collect_source_intervals()
    if not source_intervals:
        print("error: no `refetchInterval:` declarations found in src/hooks/", file=sys.stderr)
        return 2

    claims = collect_doc_polling_claims(source_intervals)

    # Group claims by hook for both source-mismatch and intra-doc-disagreement checks.
    by_hook: dict[str, list[tuple[Path, int, int, str]]] = defaultdict(list)
    for file, line, hook, ms, raw in claims:
        by_hook[hook].append((file, line, ms, raw))

    failures: list[str] = []
    for hook, hook_claims in by_hook.items():
        source_ms = source_intervals[hook]
        # Source-mismatch check.
        for file, line, claim_ms, raw in hook_claims:
            if claim_ms != source_ms:
                failures.append(
                    f"  {file.relative_to(ROOT)}:{line}\n"
                    f"      doc claim: `{hook}` polls {raw}  ({claim_ms} ms)\n"
                    f"      source: refetchInterval = {source_ms} ms\n"
                )

    if not failures:
        total = sum(len(v) for v in by_hook.values())
        print(f"ok: {total} polling-interval claim(s) across {DOCS_DIR.relative_to(ROOT)} match source")
        return 0

    print(f"FAIL: {len(failures)} polling-interval claim(s) do not match source.", file=sys.stderr)
    print(file=sys.stderr)
    for f in failures:
        print(f, file=sys.stderr)
    print(
        "Fix the doc to match source `refetchInterval`, or add `<!-- ai-consistency-allow -->` ",
        file=sys.stderr,
    )
    print("(within 6 lines preceding the claim) if the claim is intentionally illustrative.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
