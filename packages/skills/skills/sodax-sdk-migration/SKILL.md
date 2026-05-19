---
name: sodax-sdk-migration
description: Port EXISTING v1 `@sodax/sdk` consumer code to v2 — the deep architectural reshape (chain-key-driven routing replaced `*SpokeProvider` classes; `Result<T>` replaced throwing methods; `SodaxError<C>` replaced module-specific error unions; `WalletProviderSlot<K, Raw>` replaced ad-hoc wallet/raw branching; `ConfigService` replaced static lookup tables). Use whenever a codebase has v1 fingerprints — `_MAINNET_CHAIN_ID`, `*SpokeProvider`, `xChainId`, `SpokeChainId`, `MoneyMarketError`/`IntentError`/`StakingError`/`BridgeError`/`MigrationError`/`AssetServiceError`/`ConcentratedLiquidityError`/`RelayError` — and the consumer wants to compile against v2. Triggers on "migrate Sodax v1", "upgrade @sodax/sdk", "v1 → v2", "port to new Sodax", "useSpokeProvider broken", "Sodax error types changed". v1 code will not compile against v2.
---

# When to use this skill

Pick this skill when the consumer has **existing v1 SDK code** that needs to compile against v2. Common signals (grep for these):

```bash
grep -rE '_MAINNET_CHAIN_ID\b|\bSpokeProvider\b|\bxChainId\b|\bSpokeChainId\b|hubAssets|moneyMarketSupportedTokens' src/
grep -rE 'instanceof (MoneyMarketError|IntentError|StakingError|BridgeError|MigrationError|AssetServiceError|ConcentratedLiquidityError|RelayError)' src/
```

If the consumer has v1 fingerprints AND also wants new features: **do migration first**. Stale v1 patterns leak into new code if you skip it.

For new v2 code with no v1 history → use `sodax-sdk-integration` instead.

# Workflow

1. Read [`../../knowledge/sdk/migration/ai-rules.md`](../../knowledge/sdk/migration/ai-rules.md) — DO / DO NOT / workflow / stop conditions. **Read first** — prevents the most common porting mistakes.
2. Read [`../../knowledge/sdk/migration/README.md`](../../knowledge/sdk/migration/README.md) — overview, reading order, cross-cutting checklist, v1↔v2 glossary.
3. **Cross-cutting first.** In order:
   - [`breaking-changes/type-system.md`](../../knowledge/sdk/migration/breaking-changes/type-system.md) — renames at `@sodax/types`, `ChainKeys`, `WalletProviderSlot`, `RpcConfig`, `IConfigApi` Result.
   - [`breaking-changes/architecture.md`](../../knowledge/sdk/migration/breaking-changes/architecture.md) — `*SpokeProvider` deletion, `ConfigService`, relay reshape.
   - [`breaking-changes/result-and-errors.md`](../../knowledge/sdk/migration/breaking-changes/result-and-errors.md) — throws → `Result<T>`; module errors → `SodaxError<C>`; v1↔v2 code crosswalk.
4. **Per-feature playbooks** under [`features/`](../../knowledge/sdk/migration/features/) — `swap.md`, `money-market.md`, `staking.md`, `bridge.md`, `dex.md`, `icx-bnusd-baln.md`, `auxiliary-services.md` — read only the ones the consumer uses.
5. **Codemods + adapters** for mechanical replacement → [`recipes.md`](../../knowledge/sdk/migration/recipes.md).
6. **Cross-check** symbols in [`reference/`](../../knowledge/sdk/migration/reference/) — `deleted-exports.md`, `error-code-crosswalk.md`, `return-shapes.md`, `sodax-config.md`.

# Mechanical type renames (do these first)

Apply in this order — type-level changes don't affect behavior; runtime patterns require thinking.

| v1 | v2 | Codemod |
|---|---|---|
| `*_MAINNET_CHAIN_ID` | `ChainKeys.*_MAINNET` | regex `(\w+)_MAINNET_CHAIN_ID` → `ChainKeys.$1_MAINNET` |
| `XToken.xChainId` (and tokens-likes) | `XToken.chainKey` | field rename |
| `SpokeChainId` / `ChainId` | `SpokeChainKey` | type rename |
| `Token` | `XToken` | type rename |
| `AddressType` (BTC) | `BtcAddressType` | only at `@sodax/types` import sites |

Then on every signed-call payload: drop `spokeProvider`, add `walletProvider`, add `raw: false` discriminator, rename `intentParams` → `params`. Plus add `srcChainKey` + `srcAddress` to every action params object (MM, staking, deposit, …).

# Top traps to avoid

1. **Reaching for a `*SpokeProvider`.** They're deleted. Pass `walletProvider` (an `I*WalletProvider` impl) directly in the call payload.
2. **`instanceof MoneyMarketError` (and other module error classes).** Deleted. Replace with `isSodaxError(e) && e.feature === 'moneyMarket'`.
3. **Destructuring cross-chain results as arrays.** v1 had `bridge()` returning a string and others returning tuples; v2 returns `TxHashPair = { srcChainTxHash, dstChainTxHash }` for **every** cross-chain mutation. Destructure as `{ srcChainTxHash, dstChainTxHash } = result.value`.
4. **Keeping `try/catch` to inspect v1 error codes.** v2 returns `Result<T>` — failure lives on `result.error.code`, not on a thrown error. The v2 code names changed too — see `reference/error-code-crosswalk.md`.
5. **Calling `getStakingInfo(hubAddress)`.** Renamed to `getStakingInfoFromSpoke(srcAddress, srcChainKey)`. `getStakingInfo` is not a public method anymore.

# DO NOT

- Grep-replace `srcChain` → `srcChainKey` blindly. The `Intent` read shape keeps `srcChain` / `dstChain` as `IntentRelayChainId` (bigint). Only **request** types changed.
- Assume `BalnSwapService` lock methods (`stake`, `unstake`, `claim`, `claimUnstaked`, `cancelUnstake`, `getDetailedUserLocks`) return `Result<T>`. They still throw — known carve-out. Keep `try/catch` for those specific calls.
- Add `@sodax/types` as a peer dependency. It's bundled into `@sodax/sdk`'s public surface.

# Verification

```bash
pnpm tsc --noEmit    # must exit clean
# No leftover v1 fingerprints:
grep -rE '_MAINNET_CHAIN_ID\b|\bxChainId\b|\bSpokeChainId\b|\bSpokeProvider\b|hubAssets|moneyMarketSupportedTokens' src/   # empty
grep -rE 'MoneyMarketError|IntentError|StakingError|BridgeError|MigrationError|AssetServiceError|ConcentratedLiquidityError|RelayError' src/   # empty
```

Every `await sodax.<feature>.<method>(...)` call site must have `if (!result.ok)` branching (highest-leverage change — if you stop early, ensure result branching is at least in place).

# Related skills

- `sodax-sdk-integration` — write new v2 code (use after migration completes).
- `sodax-wallet-sdk-core-migration` — also additively upgrade the wallet-sdk-core surface (renames are minimal there; mostly deep-import → barrel-import).
- `sodax-dapp-kit-migration` — if the consumer also uses React hooks.
- `sodax-wallet-sdk-react-migration` — if the consumer also has v1 wallet-sdk-react.
