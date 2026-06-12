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

## Step 4 — Verify

- The invariants are covered by [packages/types/src/swap/swap.test.ts](../../../packages/types/src/swap/swap.test.ts) (disjointness, staging-superset accessor, union validation) and [packages/types/src/chains/tokens-dedup.test.ts](../../../packages/types/src/chains/tokens-dedup.test.ts) (no intra-list duplicates). Tests run in CI; do not run builds locally unless the user asks.
- Remind the user that production additions should be confirmed against the production solver oracle (`https://sodax-solver.iconblockchain.xyz/oracle`) or with the solver team.
