# Worked example — a non-EVM family integration (Stacks)

Stacks is a non-EVM chain with its **own** `SpokeService` — the "large" footprint. Verified against
**current** source (the per-chain `SpokeProvider` was removed in a refactor — there is NO `SpokeProvider`).
Use it as the template shape for a new non-EVM family; confirm each file in `src/` before copying.

## `@sodax/types`
- `chains/chain-keys.ts` — `STACKS_MAINNET: 'stacks'`.
- `chains/chains.ts` — a `baseChainInfo` entry `{ name: 'Stacks', key, type: 'STACKS', chainId, mainnet, explorer }` + a `spokeChainConfig[STACKS_MAINNET]` entry.
- `chains/tokens.ts` — `stacksSupportedTokens`; opt-in via `swap/swap.ts` / `moneyMarket/moneyMarket.ts` (use the `add-token` skill).
- `stacks/stacks.ts` — Stacks types + raw receipt types + the `IStacksWalletProvider` interface (extends `WalletAddressProvider`).
- `wallet/providers.ts` — `IStacksWalletProvider` added to the provider union.
- `common/common.ts` — a `STACKS` branch in each per-family conditional type (`GetChainType`/`GetAddressType`/`GetTokenAddressType`/`GetWalletProviderType`/`TxReturnType`/estimate-gas); `utils/utils.ts` — `isStacksChainKey`; `backend/backendApiV2.ts` if chain-specific. Plus chain-type guards.

## `@sodax/sdk`
- `shared/services/spoke/StacksSpokeService.ts` (+ `StacksSpokeService.test.ts`).
- `shared/services/spoke/SpokeService.ts` — register at: `import StacksSpokeService`, `type StacksChainKey`, `isStacksChainKeyType`, add `| StacksSpokeService` to the union, the `GetSpokeServiceType` conditional (`C extends StacksChainKey ? StacksSpokeService`), a `public readonly stacks: StacksSpokeService` field, `this.stacks = new StacksSpokeService(this.config)` in the ctor, and the `getSpokeService` return.
- `shared/services/spoke/index.ts` barrel; `shared/guards.ts`; `shared/types/spoke-types.ts` (DepositParams/SendMessage + the Stacks raw-receipt type); `shared/utils/stacks-utils.ts`.
- **No** `entities/stacks/` — Stacks needs no helper entity (contrast: `btc`/`icon`/`injective`/`solana`/`stellar` do).
- **NOT touched (generic, verified 0 chain refs):** hub services (`EvmHubProvider`, `EvmAssetManagerService`) and intent-relay (`IntentRelayApiService`).

## `@sodax/wallet-sdk-core`
- `wallet-providers/stacks/` — `StacksWalletProvider` + types + `StacksWalletProvider.test.ts` + index (per "Adding a New Chain Provider").

## `@sodax/wallet-sdk-react`
- `xchains/stacks/` — `StacksXService` + `StacksXConnector` + `useStacksXConnectors` + `StacksXService.test.ts` + `StacksXConnector.test.ts`.
- `chainRegistry.ts` entry; a `StacksChainEntry` in `types/config.ts`; `constants.ts` / `index.ts` exports (per "Adding A New Chain Type"). Stacks is **not** `providerManaged` — no `providers/stacks/` trio.

## `@sodax/dapp-kit`
- **No edit** — chain-agnostic for standard flows (feature hooks take `walletProvider` via params). Stacks added no chain-specific dapp-kit hook. (Only chains with special requirements get one: NEAR → `useRegisterNearStorage`/`useNearStorageCheck`, Stellar → trustline hooks.)

## `@sodax/libs`
- `stacks/core` + `stacks/connect` subpaths — Stacks needed `@stacks/transactions` + `@stacks/connect` build isolation. A chain whose SDK "just works" via npm needs no libs entry.

## `@sodax/skills` (consumer docs — the largest footprint; many knowledge files name chains)
Update the consumer skill knowledge that names chains — most of it under `sodax-wallet-sdk-react`
(config / hooks / imports / checklist). Validate with `pnpm check:ai`.

## apps
`apps/node/src/stacks.ts` smoke script; chain wiring in the demo / example apps that surface chains
(`apps/demo`, `apps/wallet-modal-example`, and `apps/node-cjs` interop) as relevant.

## Tests
**Created alongside:** `StacksSpokeService.test.ts`, `StacksWalletProvider.test.ts`,
`StacksXService.test.ts`, `StacksXConnector.test.ts`, `apps/node/src/stacks.ts` smoke script.
**Updated (chain-enumerating / aware):** `sdk/src/e2e-tests/e2e.test.ts`, `tokens-dedup.test.ts`,
`StakingService.test.ts`, `apps/node/src/tests/bridge-limits.test.ts` (`test.each`) and the other
cross-chain `apps/node/src/tests/*`, `wallet-sdk-react/src/chainRegistry.test.ts`, and `guards.test.ts`.
