---
name: add-chain
description: 'Use when integrating a NEW spoke chain into the SODAX SDK. The footprint branches HARD by chain family: an EVM chain is smaller (reuses the shared EvmSpokeService) but still must update hardcoded viem/wagmi maps across sdk + wallet-sdk-core + wallet-sdk-react; a new non-EVM family (Solana / Sui / Stacks / Near / Stellar / Icon / Injective-like) is a full cross-package integration with its own SpokeService; Bitcoin is a special trading-wallet model. Triggers on "add a chain", "integrate <chain>", "support <chain> spoke", "new spoke service", "wallet connect for a new chain". The chain token list is handled by the add-token skill.'
---

# Adding a Chain to the SODAX SDK

> The footprint differs **heavily by chain family**, and the codebase refactors over time (e.g. the
> per-chain `SpokeProvider` was removed — don't add one). **Verify against CURRENT `src/`**, and read a
> recent chain of the SAME family end-to-end as your template. Never assume.

## 0. Required inputs — STOP and ask if any is missing
Confirm with the requester / contract / solver teams first:
- **Chain FAMILY — the first and biggest decision** (it determines the whole footprint).
- Chain key + value, `chainId`, mainnet/testnet, explorer URLs; native wallet/signing model.
- On-chain readiness: spoke contracts + hub assets/vaults deployed; the chain's token list.
- Does the chain SDK need a `@sodax/libs` build workaround? Backend + solver recognition?
**Feature matrix — fill this BEFORE coding; implement ONLY the ✓ features.** Enable a feature only when its contract / backend / data source exists for the chain; if you can't confirm one, **ASK** — don't assume all (adds broken features) or just one (misses support):

| swap | bridge | money market | staking | dex / CL | migration | partner fee | recovery |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ?+evidence | ? | ? | ? | ? | ? | ? | ? |

Each ✓ feature then drives its own touch points (e.g. money-market token wiring, a dapp-kit storage/trustline gate, a backend DTO) — so the per-package work below is **scoped by this matrix**, not all-or-nothing.

| Family | Spoke service | Footprint |
| --- | --- | --- |
| **EVM** | reuses the single shared **`EvmSpokeService`** (`EvmChainKey = ChainKeysByType<'EVM'>`) | **small** — mostly `@sodax/types` config |
| **New non-EVM** (Solana/Sui/Stacks/Near/Stellar/Icon/Injective-like) | a **new `<Chain>SpokeService`** | **large** — full cross-package integration |
| **Bitcoin-like** | `BitcoinSpokeService` + `entities/btc/` trading-wallet (RadFi/Bound) model | **special** — different shape, do not generalize |

## Complete coverage — CHECK every package; edit only when required (don't skip, don't over-edit)
A chain *can* reach **all 7 packages** — but edit each **only when the family + feature matrix requires it** (`libs` only for a build workaround; `dapp-kit` only for a special gate). Checklist:
- `types` · `libs` (only if build workaround) · `sdk` · `wallet-sdk-core` · `wallet-sdk-react`
- `dapp-kit` — usually nothing (chain-agnostic); only a special-need hook (NEAR storage / Stellar trustline).
- **`packages/skills`** — the **largest footprint and easiest to forget** (consumer docs). Update the skill knowledge that references chains (esp. `sodax-wallet-sdk-react`: config / hooks / imports / checklist), then run `pnpm check:ai`.
- **apps** — `apps/node/src/<chain>.ts` smoke script; wire the chain into `apps/demo`, `apps/example-next-js-16`, `apps/wallet-modal-example` as relevant.

## Per-family quirks — check these 4 dimensions for YOUR non-EVM chain
A new non-EVM chain follows §2; it is **not** a copy of an existing one. Ask which of these apply to it:

| Quirk dimension | Trigger → what to add | Examples |
| --- | --- | --- |
| **Native SDK breaks the bundler** | → a `@sodax/libs/<chain>/…` subpath and/or force-bundle in wallet-core `tsup` | Stacks (`stacks/core`+`connect`), Injective (`wallet-strategy`), Near (`near-api-js` bundled) |
| **Special on-chain gate before deposit/MM** | → a dedicated dapp-kit hook | Near (storage: `useRegisterNearStorage`/`useNearStorageCheck`), Stellar (trustline: `useStellarTrustlineCheck`/`useRequestTrustline`) |
| **Native wallet SDK needs React context** | → `providerManaged: true` + a `providers/<chain>/` Provider/Hydrator/Actions trio | Solana, Sui (and EVM) |
| **Needs a chain-specific helper** | → an `entities/<chain>/` helper | Stellar (`CustomSorobanServer`), Icon, Injective, Solana |

## 1. EVM chain (smaller — but NOT zero-code)
Reuses the shared `EvmSpokeService` (no new spoke service), but you MUST also update the **hardcoded viem-chain maps** — miss them and the chain compiles yet has no runtime route / wallet:
- **types:** chain key (`chain-keys.ts`); `baseChainInfo` (`type: 'EVM'`) + `spokeChainConfig` (`chains.ts`); tokens (via `add-token`).
- **sdk:** add a `case` to `getEvmViemChain` in `shared/utils/constant-utils.ts` (returns the viem `Chain`).
- **wallet-sdk-core:** add a `case` to `getEvmViemChain` in `wallet-providers/evm/EvmWalletProvider.ts`.
- **wallet-sdk-react:** add the chain to **both** the `chains` array AND the `transports` map in `createWagmiConfig` (`xchains/evm/EvmXService.ts`); add a `<Chain>ChainEntry` in `types/config.ts`.
- **Tests:** add the chain to **`TEST_CHAINS` in `EvmSpokeService.test.ts`** (the shared `describe.each` matrix — without this the chain runs but is NOT test-covered) + `apps/node/src/evm.ts` smoke + `e2e-tests/e2e.test.ts`.

## 2. New non-EVM family (large) — full integration
Template: read a recent same-shape chain end-to-end (`Stacks`, `Near`, `Sui`, …). Touch points:
- **types (deepest layer):**
  - `chains/chain-keys.ts`: chain key (+ a `ChainTypeArr` member for a NEW family).
  - `chains/chains.ts`: `baseChainInfo` (`type`, explorer) + `spokeChainConfig` (addresses / RPC).
  - `<chain>/<chain>.ts` (+ extras, e.g. `near/near-api-js.ts`): chain types, raw tx/receipt types, and the `I<Chain>WalletProvider` interface (extends `WalletAddressProvider`).
  - `wallet/providers.ts`: add `I<Chain>WalletProvider` to the provider union.
  - **`common/common.ts` — #1 easy-to-miss for a NEW family:** a branch in **every** per-family conditional type — `GetChainType`, `GetAddressType`, `GetTokenAddressType`, `GetWalletProviderType`, `TxReturnType`, the 3 estimate-gas return types (~20 sites; `checkTs` finds the gaps). Note estimate-gas shape is family-dependent (EVM/Bitcoin/Near/Solana → decimal string; Sui/Stellar/Stacks/Icon/Injective → structured object).
  - `utils/utils.ts`: chain helper fns (`is<Chain>ChainKey`, …); `backend/backendApiV2.ts`: DTO if chain-specific.
  - `tokens.ts` + `swap.ts`/`moneyMarket.ts`: tokens (via `add-token`). Plus chain-type guards.
- **sdk:**
  - `services/spoke/<Chain>SpokeService.ts` + `services/spoke/index.ts` barrel; **register in `SpokeService.ts`** (~8 sites: import + type import + guard import + spoke union + `GetSpokeServiceType` conditional + `public readonly <chain>` field + ctor construct + `getSpokeService` route).
  - `shared/guards.ts` (chain guards), `shared/types/spoke-types.ts` (DepositParams/SendMessage + the chain's `<Chain>RawTransactionReceipt` + a branch in `GetTxReceiptType`), chain-specific `shared/utils/<chain>-utils.ts`; add `entities/<chain>/` **only if** the chain needs helpers (`btc`/`icon`/`injective`/`solana`/`stellar` have them; `stacks`/`near`/`sui` don't).
  - **Generic — NO per-chain edit (verified 0 chain refs):** hub services (`EvmHubProvider`, `EvmAssetManagerService`) and intent-relay (`IntentRelayApiService`) work on the generic spoke abstraction. Don't go hunting for hub/relay edits.
- **wallet-sdk-core:** `wallet-providers/<chain>/` provider — its "Adding a New Chain Provider" playbook.
- **wallet-sdk-react:** `xchains/<chain>/` XService/XConnector + a `chainRegistry.ts` entry — its "Adding A New Chain Type" playbook.
- **dapp-kit** — `@sodax/dapp-kit` is the React-Query hooks layer over `@sodax/sdk`; feature hooks (`useSwap`/`useBridge`/`useStake`/`useSupply`/…) are **chain-agnostic** — they take a `chainKey` + a `walletProvider` and route to the SDK.
  **When to add:** by default **nothing** — a chain that uses the same deposit/swap/MM flow as existing chains works automatically. Add a hook **only** for a step the generic hooks don't cover: an extra on-chain pre-step (NEAR storage `useRegisterNearStorage`; Stellar trustline `useRequestTrustline`), a custodial/exchange flow (Bitcoin Bound: auth/session/trading-wallet/UTXO hooks), or chain-type-specific balance logic (`useXBalances`). (`useSpokeProvider` was removed in a refactor — don't reference it; confirm provider hooks in current `src/`.)
- **libs:** a subpath only if the chain SDK needs a build workaround.
- **Tokens:** run the **`add-token`** skill.

## 3. Bitcoin — the exception (don't generalize it)
Bitcoin doesn't follow the non-EVM pattern: it uses a **custodial trading-wallet model (RadFi / Bound Exchange)** instead of direct spoke deposits, and has the heaviest dapp-kit footprint. **Don't apply §2** — read the existing Bitcoin integration directly if you ever touch it.

## Wallet integration (two layers — usually the hardest part)
1. **Signer — `@sodax/wallet-sdk-core`:** a `<Chain>WalletProvider` extending `BaseWalletProvider`, implementing `I<Chain>WalletProvider` (sign / broadcast). EVM reuses the shared `EvmWalletProvider`.
2. **Connect layer — `@sodax/wallet-sdk-react`:**
   - `xchains/<chain>/`: a `<Chain>XService` + one `<Chain>XConnector` **per supported wallet** (e.g. Unisat / Xverse / OKX for Bitcoin, StellarWalletsKit for Stellar, Hana for Icon).
   - a `chainRegistry.ts` entry exposing `defaultConnectors`, `providerManaged`, `createWalletProvider` (builds the wallet-sdk-core provider from the connected service), and optional `createActions` / `discoverConnectors`; **plus a `<Chain>ChainEntry` in `types/config.ts`** (the wallet config typing — easy to miss).
   - **`providerManaged` branch — decides the shape:** if the chain's native wallet SDK needs React context (wagmi=EVM, wallet-adapter=Solana, dapp-kit=Sui) → set `providerManaged: true` AND add a `providers/<chain>/` Provider/Hydrator/Actions trio mounted conditionally in `SodaxWalletProvider.tsx`. Otherwise (Stacks/Near/Icon/Injective/Stellar/Bitcoin) just the registry entry — no trio.
3. **Output:** consumers read the typed provider via `useWalletProvider({ xChainId })` and pass it into SDK / dapp-kit calls; the spoke service uses it to sign.

## 4. Tests — required per chain (not optional)

**A) Create a test beside every new file** (mirror the existing per-chain tests):
- **sdk:** `<Chain>SpokeService.test.ts`; plus `entities/<chain>/<chain>-utils.test.ts` if the chain has a helper entity (e.g. `entities/btc/btc-utils.test.ts`).
- **wallet-sdk-core:** `<Chain>WalletProvider.test.ts`.
- **wallet-sdk-react:** `<Chain>XService.test.ts` / `<Chain>XConnector.test.ts` (as the chain needs); **`providers/<chain>/<Chain>Hydrator.test.tsx` if `providerManaged`** (evm/solana/sui each have one).
- **apps/node:** a `src/<chain>.ts` smoke script.

**B) Update the chain-enumerating / chain-aware tests so the new chain is covered and green:**
- **Enumerate chains (must pass):** `sdk/src/e2e-tests/e2e.test.ts`, `types/.../tokens-dedup.test.ts` (tokens via `add-token`), `sdk/.../StakingService.test.ts`, and `apps/node/src/tests/bridge-limits.test.ts` (iterates chains via `test.each`).
- **Cross-chain suite — add the chain where relevant:** `apps/node/src/tests/{mm-cross-chain,raw-spoke-provider,submit-swap-tx,estimate-gas,backend-api,bnusd-migration}.test.ts`.
- **Chain-aware (add a case):** `wallet-sdk-react/src/chainRegistry.test.ts` (new `ChainType`), `sdk/src/shared/guards.test.ts` (if you add a chain-type guard).

**C) Type layer = `checkTs`, not a runtime test.** The `common.ts` conditional-type branches, the `wallet/providers.ts` union, and `spoke-types.ts` have **no `.test` file** — `pnpm checkTs` is their coverage. (dapp-kit special hooks are mostly untested in the repo, so a test there is optional, not required.)

**Full coverage = (A) + (B) + (C) green.** Run the full set (see §5): `pnpm test` does NOT cover sdk e2e or `apps/node`, so also run `pnpm --filter @sodax/sdk test:e2e`, the `apps/node` smoke directly, `pnpm checkTs`, and `pnpm check:ai` if you touched `packages/skills`.

EVM chain: no new per-chain test **files**, but you MUST add the chain to **`TEST_CHAINS` in `EvmSpokeService.test.ts`** (the shared `describe.each` matrix) — otherwise it runs untested. Plus `apps/node/src/evm.ts` + the enumerating tests in (B).

## 5. Preconditions (off-SDK) + Verify
- Spoke contracts + hub assets/vaults deployed on-chain; backend chain config + solver/relayer recognition; RPC endpoints. SDK code only makes the SDK *aware* of the chain.
```bash
pnpm build:packages && pnpm checkTs
pnpm test                            # unit — NOTE: excludes apps/node AND sdk e2e-tests
pnpm --filter @sodax/sdk test:e2e    # the e2e you updated is a SEPARATE runner
# apps/node `test` is a no-op → run the chain's smoke directly, e.g. tsx apps/node/src/<chain>.ts
pnpm check:ai                        # ONLY if you changed packages/skills consumer docs
pnpm check:ai-dev-files
```
`pnpm test` does NOT cover `e2e-tests` or `apps/node` — run `test:e2e` and the smoke script explicitly.

## Reference
- `references/example-evm-chain.md` — an **EVM** chain (smaller path; the hardcoded viem maps are the whole risk).
- `references/example-stacks-chain.md` — a **non-EVM** family (Stacks; the large full-integration footprint).
