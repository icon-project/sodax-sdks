#!/usr/bin/env bash
# Sourced by retitle-docs-pr.sh and withdraw-docs-pr.sh: the generated description block one
# writes and the other reverts. Not executed directly.

DOCS_BLOCK_MARKER='<!-- docs-auto-merge -->'
DOCS_BLOCK_TITLE_MARKER='<!-- docs-auto-merge:title'

# Drops a complete marker pair and the blank line that followed it, so a re-run neither stacks
# summaries nor grows the gap. A lone unmatched marker leaves the body as it found it, rather
# than truncating every line below it.
strip_docs_block() {
  awk -v marker="$DOCS_BLOCK_MARKER" '
    { line[NR] = $0 }
    $0 == marker { if (!start) start = NR; else if (!stop) stop = NR }
    END {
      if (!start || !stop) { for (i = 1; i <= NR; i++) print line[i]; exit }
      last = (line[stop + 1] == "") ? stop + 1 : stop
      for (i = 1; i <= NR; i++) if (i < start || i > last) print line[i]
    }
  '
}

# The title banked in the block before it was replaced; empty when no block has been written.
recorded_docs_title() {
  local line
  while IFS= read -r line; do
    case "$line" in
      "${DOCS_BLOCK_TITLE_MARKER} "*" -->")
        line="${line#"${DOCS_BLOCK_TITLE_MARKER} "}"
        printf '%s\n' "${line%" -->"}"
        return
        ;;
    esac
  done
}
