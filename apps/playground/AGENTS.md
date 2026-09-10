# apps/playground

An embeddable SODAX swap widget and its integration playground. The widget supports wallet-backed
execution where `src/lib/execution.ts` implements the family; the API's wider asset list remains
available for quotes with an explicit exchange handoff. The playground provides style controls,
network restrictions, preview widths, and collapsed integration code.

## Commands

```bash
pnpm build:packages
pnpm --filter @sodax/playground dev
pnpm --filter @sodax/playground test
pnpm --filter @sodax/playground checkTs
pnpm --filter @sodax/playground build
pnpm exec biome check apps/playground
pnpm check:ai-dev-files
```

## Ownership

- `hooks/useSwapFlow.ts`: API assets, quote state, allowed networks and form state.
- `hooks/useExecution.ts`: accounts, balances, review, approvals, signing and activity tracking.
- `lib/execution.ts`: testable execution sequencing and validated wallet-family dispatch.
- `lib/activity.ts`: validated local recovery record and reconstruction of relay submissions.
- `lib/widgetSettings.ts`, `lib/urlState.ts`: validated public embed configuration.
- `lib/brand.ts`, `hooks/useBrand.ts`: theme validation and derived semantic styles.
- `views/SwapView.tsx`: standalone widget plus separate builder controls; code starts collapsed.
- `lib/snippet.ts`: HTML and React iframe integration, plus an optional quote example.
- `hooks/useEmbedSize.ts`: height-only messages to the host; exports check origin and frame identity.

## Execution invariants

- Browsing and quoting never require a wallet. A successful quote does not prove that the widget
  can execute that route. Keep `canExecute` and mounted wallet families consistent.
- Every executable destination needs its own connected account; never reuse an EVM address for a
  non-EVM destination. Show the complete receiving address and minimum amount in the review.
- Recheck the quote before approval and after approval. Preserve the reviewed minimum through
  intent creation. Bind every EVM broadcast to the selected chain and reject malformed raw payloads.
- Use `useSwapsApiApproveAndBroadcast`: it confirms approval resets before subsequent approvals.
- Save the broadcast transaction and relay payload before calling `submitTx`. Recovery resubmits
  that same transaction; it must never create or sign a second deposit. Failed/abandoned statuses
  need a recovery/support path, not a success label or silent retry of the trade.
- Treat local storage as untrusted and optional. Do not store credentials or private keys. The
  activity record contains public transaction details; do not send those through analytics.
- Integrator fees come from deployment configuration, not the URL or a visitor-editable input.
  The same fee must reach the quote and intent exactly once. Invalid configuration blocks execution.
- Adding a wallet family requires its signing path, destination preparation, balance behavior and
  recovery tests. Bitcoin trading wallets and destination account preparation are distinct flows.

## Embed and UI

- `?embed=1` renders only the widget; URL rewrites preserve embed mode, branding and restrictions.
- Network and token options come from the swaps API; names/logos/explorers come from SDK exports.
  Do not hardcode network inventories or promise exclusivity for assets.
- `VITE_EMBED_ORIGIN` selects the stable hosted deployment used by exported snippets. Vite variables
  are public. WalletConnect requires the deployment operator's project ID.
- The hosted iframe owns its wallet session. Do not describe its React wrapper as a native component
  sharing the host wallet. Keep the standalone-opening fallback for wallets unavailable in frames.
- Analytics in partner frames remains opt-in through `VITE_GTM_IN_EMBED`; no wallet addresses or hashes.
- Use native dialogs, keyboard-operable controls, readable errors and responsive layouts. Keep partner
  controls and technical setup in the builder, not inside the user's swap form.
- Preserve the SODAX B2B palette and semantic CSS roles. Brand overrides validate values and derive
  contrast. Theme resolves pre-paint in `index.html` and must agree with `useBrand`.
- No UI framework or icon-library dependency. Import SDK/types through `@sodax/dapp-kit`.
- `polyfill.ts` must remain the first entry import; the SDK graph needs `Buffer` during evaluation.
- The bridge view remains unmounted; do not turn the swap widget into a multi-product dashboard.

Run mocked execution tests, the production build, and browser checks for both the playground and
embed. Mainnet signing must be validated by a funded wallet owner before calling a release production
ready. Record untested families or wallet environments explicitly.
