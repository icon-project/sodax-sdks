---
name: add-token
description: 'Use when adding a NEW token (or a list of tokens) to the SODAX Core SDK — define it once in the chain token map, then opt into the swap (production or staging solver list) and/or money-market lists (bridge, partner-fee and recovery auto-include). Triggers on "add a token", "add a token list", "add a swap token", "support a token", "list xStock / SPL / ERC20 tokens", "wire a token into swapSupportedTokens", "move a token between staging and production". Input is on-chain contract data — token symbol, decimals, hub address, and spoke-chain address.'
---

# Adding a Token to the SODAX SDK

> Verify every path and field shape against the current `@sodax/types` source before and
> after editing — they drift. `references/example-xstock-swap-token.md` (the real merged
> change) is the ground truth for the swap path. Never assume; confirm in `src/`.

## 0. Required inputs — STOP and ask if any is missing
Do **not** infer, guess, or self-author these. If any is missing or ambiguous, ask the requester or
the source of truth (contract team / solver team) **before writing anything**:

- **Per token:** `symbol`, `name`, `decimals`, spoke `address`, `hubAsset`, `vault`, `chainKey`, and `access` (if restricted).
- **Feature scope per token** — swap, money market, or both (a list may be mixed); don't default to swap-only.
- **Swap environment** (if swap-scoped) — **production or staging?** The solver runs two list tiers and a token goes in exactly one (see §2b). Plus its **activation state**: live and filled, or added-but-not-filled-yet (parked). Don't infer the tier from context — confirm it.
- **Money-market readiness** (if MM-scoped) — the token's `vault` must already be a hub reserve asset (see Hub-side caveat).
- **Bridge expectation** (if bridge support is requested) — the counterpart token(s) sharing the same `vault` on the destination chain(s).

Only `name`, `chainKey`, and `vault` may be *derived*, and only when unambiguous (e.g. `chainKey`
from a clearly-Solana base58 address; `vault = hubAsset` for a hub-minted token). Anything else → ask.

## 1. The token model (confirm the live shape in `@sodax/types/src` first)

A token is **defined once** in its chain's supported-tokens map; features then consume it two
ways — some need an **explicit opt-in edit**, the rest **pick it up automatically**:

1. **Define** the `XToken` in its chain's `<chain>SupportedTokens` map in `chains/tokens.ts`
   (wired into `spokeChainConfig[<chain>].supportedTokens`). This is the single source.
2. **Opt into the curated lists** the token belongs in — only **swap** and **money market** keep one.

Complete feature map (verified — re-check in source, it can change):

| Feature | Adding a token | Mechanism |
| --- | --- | --- |
| **Swap** | **EDIT** → add to **one** tier in `swap/swap.ts`: `swapSupportedTokens[<chain>]` (production) **or** `stagingSwapSupportedTokens[<chain>]` (staging) | curated opt-in list (a subset); the two tiers are **disjoint per chain** |
| **Money market** | **EDIT** → add to `moneyMarketSupportedTokens[<chain>]` (`moneyMarket/moneyMarket.ts`) | curated opt-in list (a subset) |
| **Bridge** | nothing — auto | `isBridgeable` derives from `supportedTokens`; real bridging still needs a matching counterpart token + correct `vault` on the dest chain, so *defined ≠ bridgeable everywhere* |
| **Partner fee** | nothing — auto | iterates **every** `supportedTokens` entry |
| **Recovery** | nothing — auto | iterates **every** `supportedTokens` entry |
| **Staking** | nothing — out of scope | SODA-specific (`supportedTokens['SODA']`); staking a different token is a separate feature change, not add-token |
| **DEX / Migration** | nothing | pools / fixed legacy set (`['ICX','bnUSD','BALN']`) |

**The only explicit edits are the curated lists: swap and money market.** Defining the token in
the chain map makes bridge / partner-fee / recovery include it automatically (they iterate the
full map and skip entries whose `hubAsset` is a placeholder like `'0x'`). Both curated lists are
**packaged in `@sodax/types`** → editing either is **release-gated**. (A backend money-market
tokens API also exists; whether it enables tokens without a release is **unverified** — confirm first.)

> **Hub-side caveat (vault must be a known hub asset):** for a **money-market** token, the `vault`
> must be a **hub reserve asset** — a `SodaTokens` entry or `hubConfig.bnUSD`, since `moneyMarketReserveAssets`
> (`moneyMarket.ts`) is derived from exactly those. If the `vault` is new (not a `SodaTokens` entry),
> the reserve data is missing and the token will not work in MM — that is a hub-vault change **beyond
> add-token's scope**: stop and confirm with the requester. (More generally, a `vault` that is a new
> hub vault rather than the token's own `hubAsset` must already exist — verify. xStocks reuse their
> `hubAsset` as the vault and are swap-only, so no hub-side entry was needed.)

> **Scope judgment:** the explicit choice is **swap, money market, or both** — usually more than one
> (major assets/stables go in both; xStocks are the swap-only exception). **Partner-fee / recovery**
> come for free (auto-iterate). **Bridge** has no opt-in file either, but bridging only works between
> counterpart tokens that share the **same `vault`** on both chains (`isBridgeable`) — so if the request
> needs bridge support, verify/add the matching-vault counterpart token(s) on the destination chain(s);
> do not claim it's "free". If the request doesn't state scope, **confirm with the requester; don't default to swap-only.**

## 2. Steps — define once, then opt in

### a) Define — `src/chains/tokens.ts`
Add an `XToken` to the chain's `<chain>SupportedTokens` map (e.g. `solanaSupportedTokens`,
`avalancheSupportedTokens`). `XToken = { symbol, name, decimals, address, chainKey, hubAsset, vault, access? }`.
The contract payload gives 4 fields; **supply the other 3 by hand**:

| XToken field | Source |
| --- | --- |
| `symbol`, `decimals` | payload |
| `address` | payload spoke address (e.g. `solAddress`) |
| `hubAsset` | payload `hubAddress` (Sonic hub representation) |
| `name` | **author it** (e.g. `'Circle xStock'`) |
| `chainKey` | **derive** → `ChainKeys.<SPOKE>` |
| `vault` | **verify** — for hub-minted assets often `= hubAddress`, but NOT universal (e.g. Avalanche uses `SodaTokens.soda*.address`) |
| `access?` | omit unless restricted (`withdrawOnly` / `depositOnly`) |

**Address format:**
- **EVM addresses (`hubAsset`, `vault`, EVM `address`): use checksummed (EIP-55)** — viem's `getAddress(...)` or the explorer's mixed-case form. Convention only (lookups `.toLowerCase()`, not CI-enforced), but the preferred form for new entries.
- **Non-EVM `address` keeps its native, case-sensitive form** (Solana **base58** like `XsueG8Bt…`, Sui,
  Stacks, …). Checksumming does not apply — **NEVER lowercase/uppercase or transform** it; re-casing
  base58 yields a different, wrong address. Store byte-for-byte from the contract/explorer.

### b) Opt in — per feature list (same line shape for swap and money market)
Reference the entry you just defined, once per feature the token belongs in:

```ts
// swap → src/swap/swap.ts, into swapSupportedTokens[<chain>]
spokeChainConfig[ChainKeys.<SPOKE>].supportedTokens.<SYMBOL>,
// money market → src/moneyMarket/moneyMarket.ts, into moneyMarketSupportedTokens[<chain>] (same shape)
```

Opt into **every** feature list the token belongs in — often swap *and* money market, not just
swap. Add the same `spokeChainConfig[...].supportedTokens.<SYMBOL>` line to each feature's list.
(The xStock example being swap-only is the exception, not the default.)

#### Swap list: production vs staging tier
`swap/swap.ts` keeps **two** per-chain lists; a swap token goes in **exactly one**:

- `swapSupportedTokens` — the **production** solver tokens (also wired into `swapsConfig.supportedTokens`).
- `stagingSwapSupportedTokens` — supported **only** by the **staging** solver. The staging solver serves
  the **union** (every production token **plus** these), so the two lists must stay **disjoint per chain**.

Accessors derive from the lists — `getSupportedSolverTokens` (production only), `getStagingSolverTokens`
(full staging set = production + staging-only), and `isSwapSupportedToken` validates against the **union**
(it does not gate on environment; the caller picks the tier). Never add the same token to both lists; to
**promote** staging → production, **move** the line (don't copy).

**Deciding the tier — oracle-assisted, but human-confirmed (don't auto-decide).** The split is grounded in
the production solver oracle (`https://sodax-solver.iconblockchain.xyz/oracle`) — the maintainer syncs the
lists from it by hand; the SDK does not fetch it at runtime. You **may** use it as a *signal*, never the sole decider:
- **EVM tokens** — addresses are the same lowercase hex in oracle and SDK, so a case-insensitive match is a
  reliable membership signal → use it to *suggest* production vs staging.
- **Non-EVM (Sui / Bitcoin / Stacks / ICON)** — address formats diverge (Sui zero-padding, Bitcoin hex,
  Stacks `::token` suffix; ICON often absent entirely), so a string match is **inconclusive in both directions**.
  Do **not** decide the tier from the oracle for these — confirm with the solver team.
- The oracle can also list a **stale** deployment (an older address for a token whose SDK address is correct),
  so "present in the oracle" ≠ "this exact token is production-ready". The SDK address is authoritative.

So: optionally fetch the oracle to pre-fill an EVM suggestion, then **confirm the environment + activation with
the requester / solver team** before writing. Production-readiness is a solver-team coordination call, not a pure lookup.

**Tokens added but not filled yet (activation).** If the solver team wants a token listed but **not yet filled**,
mark the parked state with the repo's existing convention (documentation only — no test enforces it):
- **Listed but flagged** — keep the entry active and append a trailing `// NOTE: Not Implemented`. It stays a full
  list member (exported, counted by `isSwapSupportedToken`, returned by accessors); only the solver withholds fills.
- **Parked (excluded)** — comment the whole line out with a trailing reason. It is **not** a list member
  (`isSwapSupportedToken` returns false), so the SDK won't offer it at all.

Confirm which behavior the solver team intends and match the surrounding entries' comment style.

### c) Batch / list input
When handed a **list** of tokens (e.g. 8 at once):
- **Scope per token** — a list may be mixed; do not assume one scope for all. Confirm which
  feature lists *each* token belongs in (some swap-only, some swap + money market).
- **Group by chain** — a list may span chains; add each entry to *its own* `<chain>SupportedTokens`
  map and that chain's feature lists. Do not assume a single chain.
- **Confirm before writing** — present the resolved `name` / `chainKey` / `vault` for every token
  (the 3 authored/derived fields) and get sign-off, since none come verbatim from the payload.
- **Dedup is partial** — `tokens-dedup.test.ts` only checks tokens **opted into the swap (production +
  staging) and money-market lists** (per chain); it does **not** scan the raw `<chain>SupportedTokens` map.
  Manually scan that chain's map for an existing `symbol` / `address` before adding (within the list and vs existing entries).

## 3. Do NOT touch (handled automatically / unrelated)
- `chains.ts` map body — the new entry flows in by reference.
- `SpokeTokenSymbols` union, `isSwapSupportedToken`, `getSupportedSolverTokens`, `getStagingSolverTokens` — derive from the lists/map.
- `chains/tokens-dedup.test.ts` — don't edit it; but it only checks tokens **already in the swap (production + staging) / money-market lists** (per chain), **not** the raw `<chain>SupportedTokens` map (see the dedup caveat in step 2c).
- `packages/sdk/src/shared/constants.ts` `hubAssets` registry — commented out; not a touch point.
- SDK `src/` — Token-2022 mints (xStocks) are handled generically in `SolanaSpokeService`; no runtime change.

## 4. Preconditions (off-SDK — not code edits)
- `hubAsset` + `vault` must be deployed on-chain first — that is where the payload originates.
- The solver/relayer backend must recognize the hub asset to route intents. The SDK config
  only makes the SDK *aware* of the token; it does not create liquidity or routes.

## 5. Verify
```bash
pnpm --filter @sodax/types test    # vitest → tokens-dedup.test.ts (swap prod+staging / MM lists) + swap.test.ts (disjointness, staging-superset, union validation)
pnpm checkTs                        # tsc → the `satisfies XToken` constraint catches a malformed entry (missing/wrong-typed field)
```
That is this skill's whole job: the token is defined and wired in the **right place and format**,
and the checks pass.

**Out of scope — do not do these here:** versioning / releasing / publishing and any
`CONFIG_VERSION` bump are the separate **`release-sdk`** skill. This change only edits
`@sodax/types` source; it bumps nothing.

## Reference
`references/example-xstock-swap-token.md` — the real 8-token swap-only change, fully worked.
