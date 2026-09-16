# apps/playground

An embeddable SODAX swap widget and its integration playground. The widget supports wallet-backed
execution where `src/lib/execution.ts` implements the family; the API's wider asset list remains
available for quotes with an explicit exchange handoff. The playground provides style controls,
network and token restrictions, token locks, an isolated iframe preview, and integration exports.

## Commands

```bash
pnpm build:packages
pnpm --filter @sodax/playground dev
pnpm --filter @sodax/playground test
pnpm --filter @sodax/playground checkTs
pnpm --filter @sodax/playground build
pnpm --filter @sodax/playground exec biome check .
pnpm check:ai-dev-files
```

## Ownership

- `hooks/useSwapFlow.ts`: API assets, quote state, allowed networks and form state.
- `hooks/useExecution.ts`: accounts, balances, review, approvals, signing and activity tracking.
- `lib/execution.ts`: testable execution sequencing and validated wallet-family dispatch.
- `lib/destinationGate.ts`: Stellar/NEAR receiving-account prerequisites reduced to one UI state.
- `lib/activity.ts`: validated local recovery record and reconstruction of relay submissions.
- `lib/analytics.ts`: GA4 event vocabulary and the tag policy that keeps partner frames opt-in.
- `lib/widgetSettings.ts`, `lib/urlState.ts`: validated public embed configuration.
- `lib/brand.ts`, `hooks/useBrand.ts`: theme validation and derived semantic styles.
- `lib/presets.ts`: named starting brands, declared as query strings and parsed by `readBrand`.
- `views/SwapView.tsx`, `components/SetupPanel.tsx`: compact widget and Setup/Appearance/Integrate builder.
- `components/WidgetPreview.tsx`: actual iframe preview; Setup owns export defaults, trial trades stay in-frame.
- `lib/snippet.ts`: HTML and React iframe integration, plus an optional quote example.
- `hooks/useEmbedSize.ts`, `hooks/useEmbedMessages.ts`, `lib/embedMessages.ts`: height, lifecycle and theme
  messages; validate direct parent and origin. Lifecycle payloads contain status only.

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
- Dispatch signing on the wallet's chain type, never on the payload shape: EVM, Solana, Sui, Stellar
  and Bitcoin raw transactions are all `{ from, to, value, data }` and cannot be told apart.
- Check the payload's sender against the connected account wherever the family states one — `from`,
  or NEAR's `signerId`. Injective states a hex sender while its wallet reports bech32; comparing
  those rejects every valid swap, so it is exempt by design.
- A destination whose receiving account is not ready blocks execution before signing, including
  while the check is still in flight. Never let a swap leave the source chain to strand. The form
  offers the remedy only once a quote exists, surfaces the remedy's own failure, and `confirm`
  re-checks the gate against the reviewed minimum.

## Embed and UI

- `?embed=1` renders only the widget; URL rewrites preserve embed mode, branding and restrictions.
- Token allowlists use chain-and-symbol identities; empty explicit lists and unavailable locked defaults
  permit no route. Flip must respect both sides’ restrictions.
- Network and token options come from the swaps API; names/logos/explorers come from SDK exports.
  Do not hardcode network inventories or promise exclusivity for assets. The one client-side
  exception is `EXCLUDED_CHAINS` in `lib/assets.ts`: chains the API still lists but the product no
  longer routes. Add there, never filter in the UI.
- `VITE_EMBED_ORIGIN` selects the stable hosted deployment used by exported snippets. Vite variables
  are public. WalletConnect requires the deployment operator's project ID.
- The builder does not restore or report execution activity; its iframe owns the swap lifecycle.
- The hosted iframe owns its wallet session. Do not describe its React wrapper as a native component
  sharing the host wallet. Keep the standalone-opening fallback for wallets unavailable in frames.
  Unframed, embed mode is that tab: the widget keeps its embed width centred in the window rather than
  filling it, and the link that opens a new tab is not drawn in the tab it opens.
- Analytics in partner frames remains opt-in through `VITE_GTM_IN_EMBED`; no wallet addresses or hashes.
  Swap events reuse sodax.com's GA4 parameter names but must keep omitting `transaction_hash`, and
  `input_amount_usd` while nothing here prices the input. Failure reasons stay a closed set.
- Use native dialogs, keyboard-operable controls, readable errors and responsive layouts. Keep partner
  controls and technical setup in the builder, not inside the user's swap form.
- The form is the exchange's currency panel: the symbol and its chevron open the picker, the network
  and the connected balance share the line beneath it, and the flip disc centres on the seam between
  the two panels. Wallet chips name their side and sit above the form, never between the legs.
- `index.css` is ordered, not specific. A `.btn` variant declared before `.btn` silently loses every
  property the two share — keep variants below it, and check the computed style, not the rule.
- The asset picker's dialog states a height, not a max-height: its grid and network sheet size against
  it, and a max- one leaves it indefinite, so each list grows past the dialog instead of scrolling in it.
  Centre a list that can overflow with `safe center`, or its first rows land where no scroll reaches.
  It opens inside the frame the host gives the widget, so an exported embed reserves `EMBED_MIN_HEIGHT`
  and its resize handler never drops below it; the widget's ground fills the surplus, and the builder's
  preview sizes to its own column so it never outgrows the panel beside it.
- The picker names what the wallet holds, as the exchange does: an asset's total across its networks
  under the hovered tile, and the hovered network's own amount in place of the flyout's caption.
  Balances are read per chain while the dialog is open, never on a timer behind a closed one.
- `components/Dropdown.tsx` is the design system's navigation menu as a form control; use it rather
  than `<select>`, whose popup the OS draws in its own colours. Its panel is a top-layer popover
  because the builder's cards and scrolling column would clip an anchored one, so its position is a
  snapshot: anything that moves the trigger closes it. Keys resolve through `lib/dropdown.ts`.
- Preview appearance changes must not restyle the builder or reload an active swap. Setup edits are
  blocked while its preview has a wallet dialog, review, preparation or activity.
- Preserve the SODAX B2B palette and semantic CSS roles. Brand overrides validate values and derive
  contrast. Theme resolves pre-paint in `index.html` and must agree with `useBrand`; that script does
  no colour maths, which is why `writeBrand` spells out the theme a surface implies; a hand-written
  URL carrying only `surface` paints the stored theme until `useBrand` mounts. A preset seeds
  that same state; it must not name a real third-party brand or load a font outside `FONT_STACKS`.
- A brand states one surface and both themes derive from it: the theme that surface already is renders
  it exactly, the other gets a ground derived from it, so `?theme=` and `sodax:theme` reach a branded
  embed. With no `theme` the surface decides — never invert a ground a partner chose. Corrections are
  reported per theme; pooling them reports one the theme on screen did not make.
- No UI framework or icon-library dependency. Import SDK/types through `@sodax/dapp-kit`.
- `polyfill.ts` must remain the first entry import; the SDK graph needs `Buffer` during evaluation.
- Swap is the only flow. Do not turn the swap widget into a multi-product dashboard; another product
  is another widget.

Run mocked execution tests, the production build, and browser checks for both the playground and
embed. Mainnet signing must be validated by a funded wallet owner before calling a release production
ready. Record untested families or wallet environments explicitly.
