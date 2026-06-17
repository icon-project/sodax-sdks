---
name: add-swap-token
description: Adds a new swap-supported token to the SODAX SDK token lists. Use when asked to add, enable, or list a new token for swaps/solver, or to move a token between the staging and production environments.
---

You are adding a swap-supported token to `packages/types`. Swap tokens live in two per-chain lists in [packages/types/src/swap/swap.ts](../../../packages/types/src/swap/swap.ts):

- `swapSupportedTokens` — tokens the **production** solver supports (also wired into `swapsConfig.supportedTokens`).
- `stagingSwapSupportedTokens` — tokens supported **only** in the **staging** solver environment. The staging solver supports every production token plus these, so the two lists must stay **disjoint per chain**.

## Step 1 — Always ask the user for input first

Before editing anything, ask the user (do not guess or infer from context):

1. **Environment**: staging or production?
2. **Token info**: chain (spoke chain key), symbol, name, on-chain address, decimals, and — if known — the hub asset address and vault address on Sonic.
3. **Activation**: is the token live, or should it be added but **not active yet** (the solver isn't filling it)? If not active yet, mark it per Step 3.

If any of these are missing, ask for them. Only the hub asset/vault may be looked up from existing config when the token is already defined in `packages/types/src/chains/tokens.ts` or a chain's `supportedTokens`.

## Step 2 — Ensure the token definition exists

The swap lists only **reference** token definitions; they do not define them.

- Check `spokeChainConfig[<chain>].supportedTokens` in [packages/types/src/chains/chains.ts](../../../packages/types/src/chains/chains.ts) (token objects live in [tokens.ts](../../../packages/types/src/chains/tokens.ts)).
- If the token is not defined yet, add an `XToken` entry there first (symbol, name, decimals, address, chainKey, hubAsset, vault), following the surrounding entries' style.
- Note: tokens must also exist in the chain's `supportedTokens` config for the SDK's runtime validation (`ConfigService.isValidOriginalAssetAddress`, used by `SolverApiService.getQuote`) to accept them — being in a swap list alone is not enough.

## Step 3 — Add the reference to the right list

In `packages/types/src/swap/swap.ts`, append `spokeChainConfig[ChainKeys.<CHAIN>].supportedTokens.<SYMBOL>` to the chain's array in:

- `swapSupportedTokens` for **production**, or
- `stagingSwapSupportedTokens` for **staging**.

Never add the same token to both lists. When promoting a staging token to production, **move** the line from the staging list to the production list.

### Tokens that aren't live yet

If the solver team says to add a token but **not activate it yet**, mark the parked state with the repo's existing convention so reviewers know it's intentional. These markings are **documentation only** — no test enforces them, and a trailing note never changes SDK behavior. Two forms exist and they are **not** interchangeable:

- **Listed but flagged** — keep the entry active and append a trailing `// NOTE: Not Implemented`. The token stays a full list member (exported, counted by `isSwapSupportedToken`, returned by the accessors); only the solver withholds fills. Use when the token must stay visible/selectable while the solver catches up. Precedent: Solana / Stellar / Sui `bnUSD`.
- **Parked (excluded)** — comment the whole line out, keeping a trailing reason such as `// NOTE: Not Implemented` or `// TODO: re-enable when <condition>`. The token is **not** a list member (not exported, `isSwapSupportedToken` returns false), so the SDK won't offer it at all. Precedent: Optimism `weETH`, ICON `BALN`/`OMM`, Bitcoin `BUSD`.

Confirm with the user which behavior the solver team intends, and match the comment style of the surrounding entries.

## Step 4 — Verify

- The invariants are covered by [packages/types/src/swap/swap.test.ts](../../../packages/types/src/swap/swap.test.ts) (disjointness, staging-superset accessor, union validation) and [packages/types/src/chains/tokens-dedup.test.ts](../../../packages/types/src/chains/tokens-dedup.test.ts) (no intra-list duplicates). Tests run in CI; do not run builds locally unless the user asks.
- Remind the user that production additions should be confirmed against the production solver oracle (`https://sodax-solver.iconblockchain.xyz/oracle`) or with the solver team.
- **Non-EVM chains — a string match against the oracle is inconclusive.** EVM addresses are the same lowercase hex in the oracle and the SDK, so a case-insensitive match confirms membership. Non-EVM addresses diverge in format between oracle and SDK (Sui zero-padding, Bitcoin hex, Stacks `::token` suffix), so a token's SDK `address` may be absent from the oracle JSON even when the solver supports it — and the missing match can mislead in either direction. For Sui, Bitcoin, and Stacks especially, never decide production-readiness from a string match: confirm the underlying asset with the solver team before promoting. See the "Swap supported tokens" note in [packages/types/CLAUDE.md](../../../packages/types/CLAUDE.md).
