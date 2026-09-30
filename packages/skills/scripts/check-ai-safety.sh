#!/usr/bin/env bash
#
# CI guard against unsafe fund-moving patterns in consumer-facing code examples. Agents copy
# these blocks verbatim, so a zero minimum output or a skipped simulation in an example ships
# straight into user code. Scans fenced code blocks in skills/**/*.md plus the standalone
# .tsx examples; prose may name the patterns (e.g. to forbid them).
#
# Opt-out: `ai-safety-allow` in a comment on the same line.

set -euo pipefail

cd "$(dirname "$0")/.."   # packages/skills/

python3 - <<'PY'
import re
import sys
from pathlib import Path

# Only the zero literal is flagged: `minOutputAmount: minFromQuote` or `0n` inside math is fine.
RULES = [
    (re.compile(r"\bmin[A-Za-z]*(?:Amount|Out|Output|Received)[A-Za-z]*\s*:\s*(?:0n|0|'0'|\"0\")\s*(?:[,}\n]|//|$)"),
     "zero minimum output — derive it from a live quote minus slippage"),
    (re.compile(r"\bskipSimulation\s*:\s*true\b"),
     "skipSimulation: true — simulation catches a reverting tx before the user pays gas"),
]
ALLOW = "ai-safety-allow"
FENCE = re.compile(r"^\s*(```|~~~)")

def code_lines(path: Path):
    if path.suffix == ".tsx":
        yield from enumerate(path.read_text(encoding="utf-8").splitlines(), 1)
        return
    in_code = False
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if FENCE.match(line):
            in_code = not in_code
            continue
        if in_code:
            yield n, line

problems = []
files = sorted(Path("skills").rglob("*.md")) + sorted(Path("skills").rglob("*.tsx"))
for path in files:
    for n, line in code_lines(path):
        if ALLOW in line:
            continue
        for rx, why in RULES:
            if rx.search(line):
                problems.append(f"{path}:{n}: {why}\n    {line.strip()}")

if problems:
    print("\n".join(problems), file=sys.stderr)
    print(f"\ncheck-ai-safety: {len(problems)} problem(s)", file=sys.stderr)
    sys.exit(1)
print(f"check-ai-safety: OK ({len(files)} files)")
PY
