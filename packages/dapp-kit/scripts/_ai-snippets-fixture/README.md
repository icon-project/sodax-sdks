# `_ai-snippets-fixture/`

Auto-generated TypeScript fixtures used by [`scripts/check-ai-snippets.sh`](../check-ai-snippets.sh).

The script walks every markdown file under `packages/dapp-kit/ai-exported/`, extracts every fenced `​```ts` and `​```tsx` code block, wraps each block in an async function, and writes it to its own `snippet-NNN.tsx` file. The wrapped fixture is then typechecked against the local dapp-kit source.

This is the recurrence prevention for the call-shape bug class: if a doc shows `useQuote({ params: <Request> })` when source actually requires `useQuote({ params: { payload: <Request> } })`, the snippet fixture fails to compile and CI rejects.

## How extraction works

For each markdown file:

1. Tracks code-fence open/close per line.
2. Recognizes `​```ts` and `​```tsx` info-strings as TypeScript blocks.
3. Skips other fences (` ```bash`, ` ```text`, ` ```diff`) — diff blocks contain both v1 (`-`) and v2 (`+`) examples, and the v1 side is intentionally wrong; typechecking them is meaningless.
4. Strips any leading `+ ` from added-diff lines (in case authors mark new content with `+`).
5. Wraps the block in `async function _check() { /* ... */ }` so `await` works.
6. Rewrites `@sodax/dapp-kit` imports to `'../../src/index.js'` (local source); `@sodax/sdk` and `@sodax/wallet-sdk-react` resolve through `node_modules`.
7. Prepends a reference to `_preamble.d.ts` which declares ambient typed shims for common identifiers (`walletProvider`, `intentParams`, `srcChainKey`, etc.). Snippets can reference those without local declarations.

## Ambient shims (`_preamble.d.ts`)

The preamble declares ambient `const`s typed against the SDK. This means a snippet like:

```tsx
const { data } = useQuote({ params: { payload: someRequest } });
```

…compiles even when the snippet doesn't show where `someRequest` comes from. The shim binds `someRequest` to the canonical SDK type at the typecheck boundary, so any structural mismatch (wrong field name, missing field, wrong wrapper) trips a real `tsc` error pointing at the snippet's file.

If a snippet needs a name not in the shim, prefer adding a local `declare const` inside the snippet over extending the shim — keeps the shim list bounded and explicit.

## Skipping a snippet

To intentionally exclude a code block (e.g. it's prose-ish JSX with no canonical-shape claim), add a line comment as the first content line of the block:

```ts
// @ai-snippets-skip
useFoo({ params: { bar } });
```

The extractor recognizes this magic comment and emits no fixture for that block.

## To run manually

```bash
pnpm -C packages/dapp-kit run check:ai-snippets
```

The `snippet-*.tsx` files are gitignored — they're regenerated every run.
