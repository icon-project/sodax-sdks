---
name: sodax-sdk-integration
description: 'Build NEW code against @sodax/sdk v2 — the SODAX cross-chain DeFi SDK (hub-and-spoke architecture, Sonic hub + 19 spoke chains across EVM and non-EVM). Covers intent-based swaps, lending/borrowing (money market), staking, bridging, concentrated-liquidity DEX, ICX/bnUSD/BALN migration, partner fees, and stuck-asset recovery. Use this skill whenever a non-React or backend codebase calls `@sodax/sdk` directly (Node scripts, indexers, bots, server APIs, custom non-React browser flows). Triggers on "use @sodax/sdk", "swap with Sodax", "Sodax bridge", "Sodax money market", "Sodax staking", "cross-chain DeFi", "Sonic hub", any `Sodax` / `ChainKeys` / `Result<T>` / `SodaxError` symbol, or any cross-chain DeFi operation in a backend context. For React dapps, prefer `sodax-dapp-kit-integration` instead.'
---

# When to use this skill

Pick this skill when the consumer is **writing new v2 code** that calls `@sodax/sdk` directly (no React wrapper). Common signals:

- Node.js server, script, indexer, bot, or CI test that uses `Sodax`.
- Custom browser flow without `@sodax/dapp-kit`.
- Any cross-chain DeFi action: swap, bridge, money market (supply/borrow/withdraw/repay), staking, DEX (concentrated liquidity), migration (ICX/bnUSD/BALN), partner fees, recovery.

For React dapps using hooks → use `sodax-dapp-kit-integration` instead (this skill is still relevant for any unwrapped SDK call).

For porting v1 code → use `sodax-sdk-migration` first.

# Workflow

Follow in order. Skipping `ai-rules.md` is the most common cause of agents reverting to v1 patterns.

1. Read [`../../knowledge/sdk/integration/ai-rules.md`](../../knowledge/sdk/integration/ai-rules.md) — DO / DO NOT / workflow / stop conditions.
2. Read [`../../knowledge/sdk/integration/quickstart.md`](../../knowledge/sdk/integration/quickstart.md) — install, initialize, first-run troubleshooting.
3. For your feature, read [`../../knowledge/sdk/integration/features/`](../../knowledge/sdk/integration/features/) — `swap.md`, `money-market.md`, `staking.md`, `bridge.md`, `dex.md`, `icx-bnusd-baln.md`, `auxiliary-services.md`.
4. For specific patterns (init, raw vs signed, chain narrowing, gas, testing, errors), read [`../../knowledge/sdk/integration/recipes/`](../../knowledge/sdk/integration/recipes/).
5. Lookups (chain keys, error codes, public API surface, wallet provider types, glossary) → [`../../knowledge/sdk/integration/reference/`](../../knowledge/sdk/integration/reference/).
6. Non-EVM quirks (Stellar trustline, BTC PSBT, Solana PDA, ICON, NEAR) → [`../../knowledge/sdk/integration/chain-specifics.md`](../../knowledge/sdk/integration/chain-specifics.md).

# v2 in one minute

1. **Chain key drives everything.** Pass `srcChainKey: ChainKeys.ETHEREUM_MAINNET` on the request payload — the SDK routes internally and TypeScript narrows `walletProvider` to the chain-specific interface via `GetWalletProviderType<K>`. There are **no** `*SpokeProvider` classes to construct.
2. **Every async public method returns `Result<T>`.** Branch on `result.ok`. No throws across service boundaries. Sub-Result forwarding is the default: `if (!sub.ok) return sub`.
3. **Errors are `SodaxError<C>`.** A single class with a closed 13-code reason vocabulary plus a `feature` field. The pair `(feature, code)` is your discriminator. Use `isSodaxError(e)` (not bare `instanceof`).
4. **Signed vs raw is a discriminated union.** `WalletProviderSlot<K, Raw>` enforces at compile time: `{ raw: false, walletProvider }` for signing, `{ raw: true }` for unsigned-tx building. Mixing them is a TypeScript error.
5. **Config is dynamic; overrides only land on `sodax.config`.** Always read via `sodax.config.*` (e.g. `sodax.config.spokeChainConfig[chainKey]`). Direct imports of `spokeChainConfig` / `sodaxConfig` from `@sodax/types` / `@sodax/sdk` are packaged-default snapshots and silently miss both `await sodax.config.initialize()` updates and `new Sodax(config)` overrides.

# Top traps to avoid

1. **Reaching for a `*SpokeProvider`.** They're deleted. Pass an object satisfying the chain-specific `I*WalletProvider` interface directly into the SDK call payload. Implementations come from your application — write your own or install `@sodax/wallet-sdk-core`.
2. **Forgetting `raw: false`.** Without the discriminator, `walletProvider` is rejected with "Object literal may only specify known properties." Add `raw: false` for signed flows; `raw: true` for unsigned-tx building.
3. **Importing from `@sodax/types` directly.** `@sodax/sdk` re-exports the entire `@sodax/types` surface. Add `@sodax/sdk` as your only dependency; importing `@sodax/types` separately risks version skew.
4. **Treating `Result<T>` as throw-on-failure.** v2 mutation methods do **not** throw on SDK-level failure — they resolve `{ ok: false, error }`. A `try/catch` only catches *exceptions* from inside `mutationFn` (e.g. missing `walletProvider`); it will **not** catch `RELAY_TIMEOUT` or `EXECUTION_FAILED`. Branch on `.ok`.
5. **Reading `xToken.xChainId` or hard-coding `*_MAINNET_CHAIN_ID`.** Renamed: `XToken.chainKey` and `ChainKeys.*`. v1 numeric/string chain-id constants are gone.

# Conventions agents must follow

- **`Result<T>` discrimination on `.ok`.** Always branch on `result.ok` before reading `.value` or `.error`. Forward sub-Results without re-wrapping (`if (!sub.ok) return sub`).
- **`(feature, code)` for error switching.** Use `isSodaxError(e)`, then `e.feature` and `e.code` for routing logic. Don't string-match on `e.message`.
- **`ChainKeys.*` over hard-coded strings.** The set of supported chains evolves per release.
- **No `as unknown as <Type>` double-casts.** v2 type narrowing makes them unnecessary — chain-key generic flow + `GetWalletProviderType<K>` resolves to the exact interface.
- **Don't generate `try { await sodax.<method>(...) } catch` for SDK-level failures.** That catch never fires for `Result.!ok`. Branch on `result.ok`.
- Import only from the package root: `import { Sodax, ChainKeys, type SpokeChainKey } from '@sodax/sdk'`. Don't deep-import from `dist/...`.

# Verification

1. `pnpm tsc --noEmit` from the consumer repo — must exit clean.
2. Every `await sodax.<feature>.<method>(...)` call site has `if (!result.ok)` branching.
3. No `xToken.xChainId`, no `*_MAINNET_CHAIN_ID`, no `*SpokeProvider` references.
4. `isSodaxError(e)` (not bare `instanceof SodaxError`) in cross-bundle code.

# Related skills

- `sodax-sdk-migration` — port v1 SDK call sites to v2.
- `sodax-wallet-sdk-core-integration` — set up a wallet provider for signing flows.
- `sodax-dapp-kit-integration` — React hooks wrapping this SDK.
- `sodax-wallet-sdk-react-integration` — React wallet connectivity layer.
