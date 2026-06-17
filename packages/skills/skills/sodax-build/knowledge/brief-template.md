# Product brief template

The output skeleton. After the Stage 5 playback and the user's confirmation, fill this in and write it to `./product-briefs/<slug>.md` (or output inline if there is no writable workspace). Keep the language at the user's tier. Do not include app code — the brief ends with a handoff.

## The 9 sections

1. **Problem & users** — who this is for and the problem it solves, in the user's own words.
2. **What it does (plain English)** — the core user-facing behavior, no jargon.
3. **SODAX features used — and why each** — a table tying each feature to a requirement. One row per feature; if you cannot tie a feature to a requirement, drop it.
4. **Chains & assets** — which chains for Phase 1 (recommend small); flag any non-EVM chain that pulls in a chain-specific wallet provider; note that exact token/chain support is confirmed at dev time against live source.
5. **Monetization** — partner-fee intent (percentage vs fixed, which actions, recipient deferred), framed per [`monetization.md`](./monetization.md). No promised returns.
6. **Out of scope (v1)** — the explicit parking lot from Stage 5. This is what keeps Phase 1 shippable.
7. **Phased build plan** — Phase 1 is a single tracer-bullet (smallest end-to-end slice). Each phase has a **"done when"** line. Later phases are bullets, not detail.
8. **Risks & assumptions** — unsupported-chain checks, exact-value confirmations needed, non-EVM provider work, fee-policy confirmation, and any market/price assumption (never a promise).
9. **Handoff to dev skills** — from [`handoff.md`](./handoff.md): the ordered dev skill(s) + mode + starter app + scaffolding steps. Skills named in prose only.

## Worked example (abridged) — Cross-chain payments widget

**1. Problem & users.** People want to pay someone who holds funds on a different chain without manually bridging. Audience: end-users of a consumer wallet app; builder is non-technical.

**2. What it does.** Enter a recipient and an amount; the widget moves the funds to the recipient's chain. If the recipient wants a different coin, it converts on the way.

**3. SODAX features used.**

| Requirement | Feature | Why |
|---|---|---|
| Move the same coin cross-chain | Bridge | Same asset on the other side |
| Convert to a different coin | Swap | Intent-based; live quote, min-output floor |
| Earn from the product | Partner fee | Small disclosed fee on each transfer |

**4. Chains & assets.** Phase 1: two EVM chains (confirm the pair against live source). EVM-only → no extra wallet providers. Token support confirmed at dev time.

**5. Monetization.** Small percentage partner fee on each transfer, disclosed in the UI. Exact cap confirmed against live SDK source before shipping. Fee recipient deferred.

**6. Out of scope (v1).** Non-EVM chains; fiat on-ramp; recurring payments; multiple fee tiers.

**7. Phased build plan.** *Phase 1 (tracer-bullet):* connect a wallet, enter recipient + amount on one EVM chain pair, execute one real cross-chain transfer with the partner fee attached. **Done when:** one end-to-end transfer completes in the safest supported environment (testnet if the feature flow supports it; confirm from the dev skill / source) and the fee lands at the configured address. *Later:* swap-on-the-way; more chains; richer UI.

**8. Risks & assumptions.** Chain pair must be confirmed supported; exact fee cap must be confirmed; cross-chain transfers incur gas + relay costs the user pays (not a SODAX fee); received amount on a swap depends on a live quote, never promised.

**9. Handoff.** Web app + wallet → load `sodax-wallet-sdk-react` (integration), then `sodax-dapp-kit` (integration); partner fee adds the `sodax-sdk` partner feature. Starter app + ordered steps from [`handoff.md`](./handoff.md).
