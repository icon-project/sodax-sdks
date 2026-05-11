# `_ai-imports-fixture/`

Auto-generated TypeScript fixture used by [`scripts/check-ai-imports.sh`](../check-ai-imports.sh).

The script walks every markdown file under `packages/dapp-kit/ai-exported/`,
extracts every `import … from '@sodax/dapp-kit'` statement (single-line and
multi-line), and writes each statement to its own `imp-NNN.ts` file in this
directory. Each fixture file starts with a `// from <markdown-path>` comment
pointing back to the source.

The fixture tsconfig rewrites `@sodax/dapp-kit` to `'../../src/index.js'` so
the typecheck runs against the local source — drift catches immediately,
no published-package round-trip required.

The `imp-*.ts` files are gitignored — they're regenerated every time the
guard runs. Keeping them out of git keeps the diff focused on the markdown
they're extracted from.

To run the guard locally:

```bash
pnpm -C packages/dapp-kit run check:ai-imports
```
