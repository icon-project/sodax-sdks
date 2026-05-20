#!/usr/bin/env python3
"""
check-ai-consistency.py — cross-doc lint for polling-interval claims.

For each `useFoo` hook in the source hooks directory that declares a
`refetchInterval: <number>`, extract the source value. Then walk the docs
directory for polling claims about that hook (e.g. "polls 3s",
"auto-refreshes every 3s", "3s interval", "5 second polling"). Assert
every doc claim matches the source value.

Allow-marker:
  - `<!-- ai-consistency-allow -->` HTML comment within 6 lines preceding the
    claim, OR
  - `// ai-consistency-allow` inside a fenced code block.

Usage:
    check-ai-consistency.py --src <src/hooks dir> --docs <knowledge dir>
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

HOOK_DECL = re.compile(r"export\s+(?:function|const)\s+(use[A-Z][a-zA-Z0-9]*)")
REFETCH = re.compile(r"refetchInterval\s*:\s*(\d+(?:_\d+)*)")

HOOK_MENTION = re.compile(r"`(use[A-Z][a-zA-Z0-9]*)`")
TIME_LITERAL = re.compile(
    r"(?<![\w.])(\d+(?:[._]\d+)?)\s*(ms|millisecond|seconds?|s|min(?:ute)?s?)(?!\w)",
    re.IGNORECASE,
)

ALLOW_COMMENT = re.compile(r"<!--\s*ai-consistency-allow\b.*?-->|//\s*ai-consistency-allow\b", re.DOTALL)

POLLING_KEYWORDS = re.compile(
    r"\b(poll(?:s|ing|ed)?|refetch(?:es|ing)?|refresh(?:es|ing|ed)?|interval|auto[-\s]?refresh|every\s+\d)",
    re.IGNORECASE,
)


def normalize_ms(value: str, unit: str) -> int:
    n = float(value.replace("_", "").replace(",", ""))
    u = unit.lower()
    if u.startswith("ms") or u.startswith("milli"):
        return int(round(n))
    if u == "s" or u.startswith("second"):
        return int(round(n * 1000))
    if u.startswith("min"):
        return int(round(n * 60 * 1000))
    return -1


def collect_source_intervals(src_dir: Path) -> dict[str, int]:
    result: dict[str, int] = {}
    for ts in src_dir.rglob("*.ts"):
        if ts.name.endswith(".test.ts"):
            continue
        text = ts.read_text()
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


def collect_doc_polling_claims(docs_dir: Path, source_intervals: dict[str, int]) -> list[tuple[Path, int, str, int, str]]:
    claims: list[tuple[Path, int, str, int, str]] = []
    for md in docs_dir.rglob("*.md"):
        text = md.read_text()
        hook_mentions = [(m.group(1), m.start(), m.end()) for m in HOOK_MENTION.finditer(text)]

        for tm in TIME_LITERAL.finditer(text):
            value = tm.group(1)
            unit = tm.group(2)
            ms = normalize_ms(value, unit)
            if ms <= 0:
                continue
            if ms > 5 * 60 * 1000:
                continue
            context_start = max(0, tm.start() - 80)
            context_end = min(len(text), tm.end() + 80)
            ctx = text[context_start:context_end]
            if not POLLING_KEYWORDS.search(ctx):
                continue
            same_line_start = text.rfind("\n", 0, tm.start()) + 1
            same_line_end = text.find("\n", tm.end())
            if same_line_end < 0:
                same_line_end = len(text)
            same_line_hooks: list[tuple[str, int, int]] = [
                (h, hs, he) for (h, hs, he) in hook_mentions if hs >= same_line_start and he <= same_line_end
            ]
            if same_line_hooks:
                source_known = [(h, hs, he) for (h, hs, he) in same_line_hooks if h in source_intervals]
                if not source_known:
                    continue
                best_hook = min(source_known, key=lambda triple: abs(triple[1] - tm.start()))[0]
            else:
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
            line_no = line_of(text, tm.start())
            lines = text.splitlines()
            preceding = "\n".join(lines[max(0, line_no - 7) : line_no - 1])
            if ALLOW_COMMENT.search(preceding):
                continue
            claims.append((md, line_no, best_hook, ms, f"{value}{unit}"))
    return claims


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

    source_intervals = collect_source_intervals(src_dir)
    if not source_intervals:
        print(f"error: no `refetchInterval:` declarations found in {src_dir}", file=sys.stderr)
        return 2

    claims = collect_doc_polling_claims(docs_dir, source_intervals)

    by_hook: dict[str, list[tuple[Path, int, int, str]]] = defaultdict(list)
    for file, line, hook, ms, raw in claims:
        by_hook[hook].append((file, line, ms, raw))

    failures: list[str] = []
    for hook, hook_claims in by_hook.items():
        source_ms = source_intervals[hook]
        for file, line, claim_ms, raw in hook_claims:
            if claim_ms != source_ms:
                try:
                    rel = file.relative_to(root)
                except ValueError:
                    rel = file
                failures.append(
                    f"  {rel}:{line}\n"
                    f"      doc claim: `{hook}` polls {raw}  ({claim_ms} ms)\n"
                    f"      source: refetchInterval = {source_ms} ms\n"
                )

    if not failures:
        total = sum(len(v) for v in by_hook.values())
        print(f"ok: {total} polling-interval claim(s) across {docs_dir} match source")
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
