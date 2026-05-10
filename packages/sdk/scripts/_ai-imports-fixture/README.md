# `_ai-imports-fixture/`

Generated fixture for the `check:ai-imports` CI guard. **Do not edit `imp-*.ts` by hand** — they're regenerated each run by [`../check-ai-imports.sh`](../check-ai-imports.sh).

The guard:

1. Walks every `*.md` file in `ai-exported/`.
2. Extracts every `import … from '@sodax/sdk'` statement (handling single-line and multi-line forms; skipping `-`-prefixed diff lines).
3. Writes each statement to its own file `imp-NNN.ts` (one statement per file so duplicate names across docs don't collide). Each file's first line is a `// from <markdown>` comment pointing back to the source.
4. Rewrites `'@sodax/sdk'` to a relative import of the local `src/index.js`.
5. Runs `tsc --noEmit -p .` against this fixture's `tsconfig.json`.

If a doc references a `@sodax/sdk` symbol that no longer exists (or never did), the typecheck fails with a clear `Module '"…/src/index.js"' has no exported member 'X'` error, pointing at `imp-NNN.ts`'s comment header to trace back to the markdown file.

`imp-*.ts` files are gitignored — they're build artifacts, not source.
