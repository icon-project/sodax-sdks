# Worked example — an EVM chain (a new L2, e.g. Kaia / Lightlink)

EVM is the **smaller** path: it reuses the shared `EvmSpokeService` + `EvmWalletProvider` + `EvmXService`
— **no new spoke service, wallet provider, or XService**. But it is **NOT zero-code**: several **hardcoded
viem-chain maps** must get an entry, or the chain compiles yet has no runtime route / wallet. Verify against current `src/`.

## `@sodax/types`
- `chains/chain-keys.ts` — the chain key (e.g. `KAIA_MAINNET: 'kaia'`). **No** new `ChainTypeArr` member — `type: 'EVM'` reuses the existing EVM family.
- `chains/chains.ts` — a `baseChainInfo` entry with `type: 'EVM'` + a `spokeChainConfig` entry (addresses / RPC).
- `chains/tokens.ts` + `swap.ts`/`moneyMarket.ts` — the chain's tokens (via the `add-token` skill).
- **No** `<chain>/<chain>.ts`, no `wallet/providers.ts` change, no `common.ts` conditional branches — the EVM type already covers all of these.

## `@sodax/sdk`
- `shared/utils/constant-utils.ts` — add a `case` to `getEvmViemChain` returning the viem `Chain`.
- **No** new `<Chain>SpokeService` — `EvmChainKey = ChainKeysByType<'EVM'>` auto-routes to the shared `EvmSpokeService`.

## `@sodax/wallet-sdk-core`
- `wallet-providers/evm/EvmWalletProvider.ts` — add a `case` to its `getEvmViemChain`. **No** new provider.

## `@sodax/wallet-sdk-react`
- `xchains/evm/EvmXService.ts` — add the chain to **both** the `chains` array AND the `transports` map in `createWagmiConfig`.
- `types/config.ts` — an `EvmChainEntry` for the chain (wallet config typing).
- **No** new XService / XConnector — EVM uses the shared wagmi-based ones.

## `@sodax/dapp-kit`
- **No edit** — chain-agnostic; a standard EVM chain has no special gate.

## `@sodax/libs`
- **No** — viem/wagmi work via npm; no build workaround.

## `@sodax/skills` + apps
- Consumer docs that name chains; `apps/node/src/evm.ts` smoke + `apps/demo` / example apps.

## Tests
- **No new per-chain test files**, BUT you MUST add the chain to **`TEST_CHAINS` in `EvmSpokeService.test.ts`** — the shared `describe.each(TEST_CHAINS)` matrix runs every EVM spoke; skip it and the new chain runs **untested**.
- **Update:** `apps/node/src/evm.ts` smoke + the enumerating tests (`e2e.test.ts`, `bridge-limits.test.ts`, `tokens-dedup.test.ts`, `chainRegistry.test.ts`).

> The whole risk for an EVM chain is the **hardcoded viem maps** (`getEvmViemChain` ×2, wagmi `chains`+`transports`) and `config.ts` — `pnpm checkTs` will NOT catch a missing viem-map entry (it fails at runtime), so verify these explicitly.
