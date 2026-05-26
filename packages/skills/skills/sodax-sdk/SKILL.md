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

## Prefer a granular skill if the feature is known

If the user has already picked a single feature, load the matching granular skill instead of this broad one — it loads ~3 KB of focused workflow vs this file's ~13 KB and links directly into the right knowledge files. The granular skills sit in the same family (`sdk`) and cover both integration and migration via internal cross-links.

| Feature | Granular skill | Trigger phrases |
|---|---|---|
| Intent-based swap (market + limit orders) | [`./swap/SKILL.md`](./swap/SKILL.md) | "swap with Sodax", "limit order", "cancel intent" |
| Cross-chain lending / borrowing | [`./money-market/SKILL.md`](./money-market/SKILL.md) | "supply", "borrow", "withdraw collateral", "repay" |
| Direct token bridge via vault | [`./bridge/SKILL.md`](./bridge/SKILL.md) | "bridge tokens", "cross-chain transfer" |
| SODA ↔ xSoda staking | [`./staking/SKILL.md`](./staking/SKILL.md) | "stake SODA", "instant unstake", "claim staking rewards" |
| Concentrated-liquidity LP | [`./dex/SKILL.md`](./dex/SKILL.md) | "LP position", "concentrated liquidity", "deposit hub assets" |
| ICX / bnUSD / BALN migration to SODAX | [`./icx-bnusd-baln/SKILL.md`](./icx-bnusd-baln/SKILL.md) | "migrate ICX", "legacy bnUSD", "BALN lockup" |
| Partner fees | [`./partner/SKILL.md`](./partner/SKILL.md) | "claim partner fee", "partner auto-swap preference", "approve partner fee token" |
| Stuck-asset recovery | [`./recovery/SKILL.md`](./recovery/SKILL.md) | "recover stuck assets on Sonic", "RecoveryService", "withdrawHubAsset" |
| Backend HTTP client (intents, orderbook, MM reads) | [`./backend-api/SKILL.md`](./backend-api/SKILL.md) | "submit swap tx to backend", "getIntentByHash", "Sodax backend API", "custom IConfigApi" |

Load this broad skill (keep reading below) when:

- The feature is not yet decided.
- The task spans **multiple** features (e.g. swap + money-market in one flow).
- The consumer is doing a **full v1 → v2 port** of an existing codebase.

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
3. For your feature, read [`integration/knowledge/features/`](./integration/knowledge/features/) — `swap.md`, `money-market.md`, `staking.md`, `bridge.md`, `dex.md`, `icx-bnusd-baln.md`, `partner.md`, `recovery.md`, `backend-api.md`.
4. For specific patterns (init, raw vs signed, chain narrowing, gas, testing, errors), read [`integration/knowledge/recipes/`](./integration/knowledge/recipes/).
5. Lookups (chain keys, error codes, public API surface, wallet provider types, glossary) → [`integration/knowledge/reference/`](./integration/knowledge/reference/).
6. Non-EVM quirks (Stellar trustline, BTC PSBT, Solana PDA, ICON, NEAR) → [`integration/knowledge/chain-specifics.md`](./integration/knowledge/chain-specifics.md).

### v2 in one minute

1. **Chain key drives everything.** Pass `srcChainKey: ChainKeys.ETHEREUM_MAINNET` on the request payload — the SDK routes internally and TypeScript narrows `walletProvider` to the chain-specific interface via `GetWalletProviderType<K>`. There are **no** `*SpokeProvider` classes to construct.
2. **Every async public method returns `Result<T>`.** Branch on `result.ok`. No throws across service boundaries. Sub-Result forwarding is the default: `if (!sub.ok) return sub`.
3. **Errors are `SodaxError<C>`.** A single class with a closed 13-code reason vocabulary plus a `feature` field. The pair `(feature, code)` is your discriminator. Use `isSodaxError(e)` (not bare `instanceof`).
4. **Signed vs raw is a discriminated union.** `WalletProviderSlot<K, Raw>` enforces at compile time: `{ raw: false, walletProvider }` for signing, `{ raw: true }` for unsigned-tx building. Mixing them is a TypeScript error.
5. **Config is dynamic; overrides only land on `sodax.config`.** Always read via `sodax.config.*` (e.g. `sodax.config.spokeChainConfig[chainKey]`). Direct imports of `spokeChainConfig` / `sodaxConfig` from `@sodax/types` / `@sodax/sdk` are packaged-default snapshots and silently miss both `await sodax.config.initialize()` updates and `new Sodax(config)` overrides.

### Top traps, conventions, verification

The DO / DO NOT / verification checklist lives in [`integration/knowledge/ai-rules.md`](./integration/knowledge/ai-rules.md) — read it before writing any call site. The biggest source of generated v1-style code is skipping it.

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
4. **Per-feature playbooks** under [`features/`](./migration-v1-to-v2/knowledge/features/) — `swap.md`, `money-market.md`, `staking.md`, `bridge.md`, `dex.md`, `icx-bnusd-baln.md`, `partner.md`, `recovery.md`, `backend-api.md` — read only the ones the consumer uses.
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

### Top traps, DO NOT, verification

The full DO / DO NOT list, mode-specific pitfalls, and verification protocol live in [`migration-v1-to-v2/knowledge/ai-rules.md`](./migration-v1-to-v2/knowledge/ai-rules.md) — read it before touching any call site. Highest-leverage rule: every `await sodax.<feature>.<method>(...)` call site must have `if (!result.ok)` branching.

---

# Related skills

- `sodax-wallet-sdk-core` — set up a wallet provider for signing flows (integration mode) or upgrade an existing wallet-sdk-core surface (migration mode).
- `sodax-dapp-kit` — React hooks wrapping this SDK.
- `sodax-wallet-sdk-react` — React wallet connectivity layer.
