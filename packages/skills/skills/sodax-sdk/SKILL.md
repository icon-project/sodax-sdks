---
name: sodax-sdk
description: 'INTEGRATION (write NEW v2 code) — @sodax/sdk v2 is the SODAX cross-chain DeFi SDK (hub-and-spoke architecture, Sonic hub + 19 spoke chains across EVM and non-EVM). Covers intent-based swaps, lending/borrowing (money market), staking, bridging, concentrated-liquidity DEX, ICX/bnUSD/BALN token migration, partner fees, and stuck-asset recovery. Use whenever a non-React or backend codebase calls `@sodax/sdk` directly (Node scripts, indexers, bots, server APIs, custom non-React browser flows). Triggers on "use @sodax/sdk", "swap with Sodax", "Sodax bridge", "Sodax money market", "Sodax staking", "cross-chain DeFi", "Sonic hub", any `Sodax` / `ChainKeys` / `Result<T>` / `SodaxError` symbol. For React dapps, prefer `sodax-dapp-kit` instead. MIGRATION (port v1 → v2) — the v2 reshape replaced `*SpokeProvider` classes with chain-key-driven routing, throws with `Result<T>`, module-specific error unions with `SodaxError<C>`, ad-hoc wallet/raw branching with `WalletProviderSlot<K, Raw>`, and static lookup tables with `ConfigService`. Triggers on "migrate Sodax v1", "upgrade @sodax/sdk", "v1 → v2", "useSpokeProvider broken", "Sodax error types changed", v1 fingerprints (`_MAINNET_CHAIN_ID`, `*SpokeProvider`, `xChainId`, `SpokeChainId`, `MoneyMarketError`/`IntentError`/`StakingError`/`BridgeError`/`MigrationError`/`AssetServiceError`/`ConcentratedLiquidityError`/`RelayError`). Load this skill if EITHER applies; the body gates by mode.'
---

# When to use this skill

AGENTS.md routes you here when you're working with `@sodax/sdk` v2 — either writing new code or porting from v1.

**Pick your mode:**

- Writing NEW v2 code (greenfield, no v1 fingerprints, no React)? → § **Integration mode** below.
- Porting EXISTING v1 code to v2 (grep finds `useSpokeProvider`, `*_MAINNET_CHAIN_ID`, `xChainId`, `SpokeChainId`, module-specific error classes)? → § **Migration mode** below.
- Both? → do migration first, then integration. Stale v1 patterns leak into new code if you skip it.

For React dapps using hooks → use `sodax-dapp-kit` instead (this skill is still relevant for any unwrapped SDK call).

---

## Integration mode (writing new v2 code)

Pick this mode when the consumer is **writing new v2 code** that calls `@sodax/sdk` directly (no React wrapper). Common signals:

- Node.js server, script, indexer, bot, or CI test that uses `Sodax`.
- Custom browser flow without `@sodax/dapp-kit`.
- Any cross-chain DeFi action: swap, bridge, money market (supply/borrow/withdraw/repay), staking, DEX (concentrated liquidity), migration (ICX/bnUSD/BALN), partner fees, recovery.

### Workflow

Follow in order. Skipping `ai-rules.md` is the most common cause of agents reverting to v1 patterns.

1. Read [`integration/knowledge/ai-rules.md`](./integration/knowledge/ai-rules.md) — DO / DO NOT / workflow / stop conditions.
2. Read [`integration/knowledge/quickstart.md`](./integration/knowledge/quickstart.md) — install, initialize, first-run troubleshooting.
3. For your feature, read [`integration/knowledge/features/`](./integration/knowledge/features/) — `swap.md`, `money-market.md`, `staking.md`, `bridge.md`, `dex.md`, `icx-bnusd-baln.md`, `auxiliary-services.md`.
4. For specific patterns (init, raw vs signed, chain narrowing, gas, testing, errors), read [`integration/knowledge/recipes/`](./integration/knowledge/recipes/).
5. Lookups (chain keys, error codes, public API surface, wallet provider types, glossary) → [`integration/knowledge/reference/`](./integration/knowledge/reference/).
6. Non-EVM quirks (Stellar trustline, BTC PSBT, Solana PDA, ICON, NEAR) → [`integration/knowledge/chain-specifics.md`](./integration/knowledge/chain-specifics.md).

### v2 in one minute

1. **Chain key drives everything.** Pass `srcChainKey: ChainKeys.ETHEREUM_MAINNET` on the request payload — the SDK routes internally and TypeScript narrows `walletProvider` to the chain-specific interface via `GetWalletProviderType<K>`. There are **no** `*SpokeProvider` classes to construct.
2. **Every async public method returns `Result<T>`.** Branch on `result.ok`. No throws across service boundaries. Sub-Result forwarding is the default: `if (!sub.ok) return sub`.
3. **Errors are `SodaxError<C>`.** A single class with a closed 13-code reason vocabulary plus a `feature` field. The pair `(feature, code)` is your discriminator. Use `isSodaxError(e)` (not bare `instanceof`).
4. **Signed vs raw is a discriminated union.** `WalletProviderSlot<K, Raw>` enforces at compile time: `{ raw: false, walletProvider }` for signing, `{ raw: true }` for unsigned-tx building. Mixing them is a TypeScript error.
5. **Config is dynamic; overrides only land on `sodax.config`.** Always read via `sodax.config.*` (e.g. `sodax.config.spokeChainConfig[chainKey]`). Direct imports of `spokeChainConfig` / `sodaxConfig` from `@sodax/types` / `@sodax/sdk` are packaged-default snapshots and silently miss both `await sodax.config.initialize()` updates and `new Sodax(config)` overrides.

### Top traps to avoid (integration)

1. **Reaching for a `*SpokeProvider`.** They're deleted. Pass an object satisfying the chain-specific `I*WalletProvider` interface directly into the SDK call payload. Implementations come from your application — write your own or install `@sodax/wallet-sdk-core`.
2. **Forgetting `raw: false`.** Without the discriminator, `walletProvider` is rejected with "Object literal may only specify known properties." Add `raw: false` for signed flows; `raw: true` for unsigned-tx building.
3. **Importing from `@sodax/types` directly.** `@sodax/sdk` re-exports the entire `@sodax/types` surface. Add `@sodax/sdk` as your only dependency; importing `@sodax/types` separately risks version skew.
4. **Treating `Result<T>` as throw-on-failure.** v2 mutation methods do **not** throw on SDK-level failure — they resolve `{ ok: false, error }`. A `try/catch` only catches *exceptions* from inside `mutationFn` (e.g. missing `walletProvider`); it will **not** catch `RELAY_TIMEOUT` or `EXECUTION_FAILED`. Branch on `.ok`.
5. **Reading `xToken.xChainId` or hard-coding `*_MAINNET_CHAIN_ID`.** Renamed: `XToken.chainKey` and `ChainKeys.*`. v1 numeric/string chain-id constants are gone.

### Conventions agents must follow (integration)

- **`Result<T>` discrimination on `.ok`.** Always branch on `result.ok` before reading `.value` or `.error`. Forward sub-Results without re-wrapping (`if (!sub.ok) return sub`).
- **`(feature, code)` for error switching.** Use `isSodaxError(e)`, then `e.feature` and `e.code` for routing logic. Don't string-match on `e.message`.
- **`ChainKeys.*` over hard-coded strings.** The set of supported chains evolves per release.
- **No `as unknown as <Type>` double-casts.** v2 type narrowing makes them unnecessary — chain-key generic flow + `GetWalletProviderType<K>` resolves to the exact interface.
- **Don't generate `try { await sodax.<method>(...) } catch` for SDK-level failures.** That catch never fires for `Result.!ok`. Branch on `result.ok`.
- Import only from the package root: `import { Sodax, ChainKeys, type SpokeChainKey } from '@sodax/sdk'`. Don't deep-import from `dist/...`.

### Verification (integration)

1. `pnpm tsc --noEmit` from the consumer repo — must exit clean.
2. Every `await sodax.<feature>.<method>(...)` call site has `if (!result.ok)` branching.
3. No `xToken.xChainId`, no `*_MAINNET_CHAIN_ID`, no `*SpokeProvider` references.
4. `isSodaxError(e)` (not bare `instanceof SodaxError`) in cross-bundle code.

---

## Migration mode (v1 → v2 porting)

Pick this mode when the consumer has **existing v1 SDK code** that needs to compile against v2. Common signals (grep for these):

```bash
grep -rE '_MAINNET_CHAIN_ID\b|\bSpokeProvider\b|\bxChainId\b|\bSpokeChainId\b|hubAssets|moneyMarketSupportedTokens' src/
grep -rE 'instanceof (MoneyMarketError|IntentError|StakingError|BridgeError|MigrationError|AssetServiceError|ConcentratedLiquidityError|RelayError)' src/
```

If the consumer has v1 fingerprints AND also wants new features: **do migration first**.

### Workflow

1. Read [`migration-v1-to-v2/knowledge/ai-rules.md`](./migration-v1-to-v2/knowledge/ai-rules.md) — DO / DO NOT / workflow / stop conditions. **Read first** — prevents the most common porting mistakes.
2. Read [`migration-v1-to-v2/knowledge/README.md`](./migration-v1-to-v2/knowledge/README.md) — overview, reading order, cross-cutting checklist, v1↔v2 glossary.
3. **Cross-cutting first.** In order:
   - [`breaking-changes/type-system.md`](./migration-v1-to-v2/knowledge/breaking-changes/type-system.md) — renames at `@sodax/types`, `ChainKeys`, `WalletProviderSlot`, `RpcConfig`, `IConfigApi` Result.
   - [`breaking-changes/architecture.md`](./migration-v1-to-v2/knowledge/breaking-changes/architecture.md) — `*SpokeProvider` deletion, `ConfigService`, relay reshape.
   - [`breaking-changes/result-and-errors.md`](./migration-v1-to-v2/knowledge/breaking-changes/result-and-errors.md) — throws → `Result<T>`; module errors → `SodaxError<C>`; v1↔v2 code crosswalk.
4. **Per-feature playbooks** under [`features/`](./migration-v1-to-v2/knowledge/features/) — `swap.md`, `money-market.md`, `staking.md`, `bridge.md`, `dex.md`, `icx-bnusd-baln.md`, `auxiliary-services.md` — read only the ones the consumer uses.
5. **Codemods + adapters** for mechanical replacement → [`recipes.md`](./migration-v1-to-v2/knowledge/recipes.md).
6. **Cross-check** symbols in [`reference/`](./migration-v1-to-v2/knowledge/reference/) — `deleted-exports.md`, `error-code-crosswalk.md`, `return-shapes.md`, `sodax-config.md`.

### Mechanical type renames (do these first)

Apply in this order — type-level changes don't affect behavior; runtime patterns require thinking.

| v1 | v2 | Codemod |
|---|---|---|
| `*_MAINNET_CHAIN_ID` | `ChainKeys.*_MAINNET` | regex `(\w+)_MAINNET_CHAIN_ID` → `ChainKeys.$1_MAINNET` |
| `XToken.xChainId` (and tokens-likes) | `XToken.chainKey` | field rename |
| `SpokeChainId` / `ChainId` | `SpokeChainKey` | type rename |
| `Token` | `XToken` | type rename |
| `AddressType` (BTC) | `BtcAddressType` | only at `@sodax/types` import sites |

Then on every signed-call payload: drop `spokeProvider`, add `walletProvider`, add `raw: false` discriminator, rename `intentParams` → `params`. Plus add `srcChainKey` + `srcAddress` to every action params object (MM, staking, deposit, …).

### Top traps to avoid (migration)

1. **Reaching for a `*SpokeProvider`.** They're deleted. Pass `walletProvider` (an `I*WalletProvider` impl) directly in the call payload.
2. **`instanceof MoneyMarketError` (and other module error classes).** Deleted. Replace with `isSodaxError(e) && e.feature === 'moneyMarket'`.
3. **Destructuring cross-chain results as arrays.** v1 had `bridge()` returning a string and others returning tuples; v2 returns `TxHashPair = { srcChainTxHash, dstChainTxHash }` for **every** cross-chain mutation. Destructure as `{ srcChainTxHash, dstChainTxHash } = result.value`.
4. **Keeping `try/catch` to inspect v1 error codes.** v2 returns `Result<T>` — failure lives on `result.error.code`, not on a thrown error. The v2 code names changed too — see `reference/error-code-crosswalk.md`.
5. **Calling `getStakingInfo(hubAddress)`.** Renamed to `getStakingInfoFromSpoke(srcAddress, srcChainKey)`. `getStakingInfo` is not a public method anymore.

### DO NOT

- Grep-replace `srcChain` → `srcChainKey` blindly. The `Intent` read shape keeps `srcChain` / `dstChain` as `IntentRelayChainId` (bigint). Only **request** types changed.
- Assume `BalnSwapService` lock methods (`stake`, `unstake`, `claim`, `claimUnstaked`, `cancelUnstake`, `getDetailedUserLocks`) return `Result<T>`. They still throw — known carve-out. Keep `try/catch` for those specific calls.
- Add `@sodax/types` as a peer dependency. It's bundled into `@sodax/sdk`'s public surface.

### Verification (migration)

```bash
pnpm tsc --noEmit    # must exit clean
# No leftover v1 fingerprints:
grep -rE '_MAINNET_CHAIN_ID\b|\bxChainId\b|\bSpokeChainId\b|\bSpokeProvider\b|hubAssets|moneyMarketSupportedTokens' src/   # empty
grep -rE 'MoneyMarketError|IntentError|StakingError|BridgeError|MigrationError|AssetServiceError|ConcentratedLiquidityError|RelayError' src/   # empty
```

Every `await sodax.<feature>.<method>(...)` call site must have `if (!result.ok)` branching (highest-leverage change — if you stop early, ensure result branching is at least in place).

---

# Related skills

- `sodax-wallet-sdk-core` — set up a wallet provider for signing flows (integration mode) or upgrade an existing wallet-sdk-core surface (migration mode).
- `sodax-dapp-kit` — React hooks wrapping this SDK.
- `sodax-wallet-sdk-react` — React wallet connectivity layer.
