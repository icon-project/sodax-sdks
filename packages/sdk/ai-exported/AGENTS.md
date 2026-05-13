# AGENTS.md — `@sodax/sdk` v2

> Tool-neutral entry point for any AI coding agent assisting a consumer of `@sodax/sdk`. If you're at `node_modules/@sodax/sdk/ai-exported/AGENTS.md`, you are in the right place — everything you need is reachable from here without leaving the npm tarball.

## Project

`@sodax/sdk` is the official SDK for SODAX, a cross-chain DeFi platform built on a hub-and-spoke architecture (Sonic is the hub; 19 spoke chains across EVM and non-EVM ecosystems). The SDK provides cross-chain swaps (intent-based via solver), lending/borrowing (money market), staking, bridging, concentrated-liquidity DEX, ICX/bnUSD/BALN migration, and partner-fee operations. It is runtime-agnostic and runs in Node.js, browsers, and bundled apps.

This package is **v2**. v2 was a deep architectural reshape of v1 — chain-key driven routing replaced per-chain provider classes; `Result<T>` replaced throwing methods; `SodaxError<C>` replaced module-specific error unions; `WalletProviderSlot<K, Raw>` replaced ad-hoc wallet/raw branching; `ConfigService` replaced static lookup tables. Code written against v1 will not compile against v2.

## When to read what

```
Are you writing NEW code against v2?           → integration/ai-rules.md, then integration/
Are you porting EXISTING v1 code to v2?        → migration/ai-rules.md, then migration/
Just need a chain key / error code / type?     → integration/reference/
Need to install + initialize the SDK?           → integration/quickstart.md
Hit a non-EVM chain quirk (Stellar, BTC, …)?   → integration/chain-specifics.md
```

If a consumer's repo has both v1 call sites and a request to extend with new code, do migration first. Stale v1 patterns leak into new code if you skip it.

**Always start with the `ai-rules.md` for the tree you're working in** — it's the consolidated DO / DO NOT / workflow / stop-conditions guide that prevents the most common v2 traps. Read it once, then dive into the per-feature docs.

## Top-level layout

```
ai-exported/
├── AGENTS.md                       # You are here
├── integration/                    # How to use v2 (new consumers)
│   ├── README.md                   # Index for this tree
│   ├── ai-rules.md                 # DO / DO NOT / workflow — read before per-feature docs
│   ├── quickstart.md               # Install + initialize + first-run troubleshooting
│   ├── architecture.md             # Every v2 design concept (TOC-navigable)
│   ├── features/                   # One file per feature service
│   │   ├── README.md
│   │   ├── swap.md
│   │   ├── money-market.md
│   │   ├── staking.md
│   │   ├── bridge.md
│   │   ├── dex.md
│   │   ├── icx-bnusd-baln.md       # MigrationService (the SDK module, not the v1→v2 port)
│   │   └── auxiliary-services.md   # PartnerService + RecoveryService + BackendApiService
│   ├── recipes/                    # One file per pattern — init, result/errors, raw, signed, narrowing, testing, gas, backend-init
│   ├── reference/                  # One file per table — chain keys, wallet providers, error codes, public API, glossary
│   └── chain-specifics.md          # Non-EVM quirks (Stellar trustline, BTC PSBT, Solana PDA, ICON, NEAR)
└── migration/                      # How to port v1 → v2
    ├── README.md                   # Overview + reading order + cross-cutting checklist + v1↔v2 glossary
    ├── ai-rules.md                 # DO / DO NOT / workflow for porting agents
    ├── breaking-changes/           # Cross-cutting v1→v2 changes
    │   ├── type-system.md          # @sodax/types renames + ChainKeys + WalletProviderSlot + RpcConfig + IConfigApi Result
    │   ├── architecture.md         # *SpokeProvider deletion + ConfigService + relay reshape + invariants
    │   └── result-and-errors.md    # Throws → Result<T>; module errors → SodaxError<C>; v1↔v2 code crosswalk; return shapes
    ├── features/                   # Per-feature pure-SDK migration playbooks
    │   ├── README.md
    │   ├── swap.md, money-market.md, staking.md, bridge.md, dex.md, icx-bnusd-baln.md, auxiliary-services.md
    └── recipes.md                  # Codemods + error-shape adapter + result adapter
```

## v2 in one minute

1. **Chain key drives everything.** Pass `srcChainKey: ChainKeys.ETHEREUM_MAINNET` (or any of 20 keys) on the request payload. The SDK routes to the correct per-chain spoke service internally and TypeScript narrows the wallet-provider parameter to the chain-specific interface via `GetWalletProviderType<K>`. There are **no** `*SpokeProvider` classes to construct.
2. **Every async public method returns `Result<T>`.** Branch on `result.ok`. No throws across service boundaries. Sub-Result forwarding is the default: `if (!sub.ok) return sub`.
3. **Errors are `SodaxError<C>`.** A single class with a closed 13-code reason vocabulary (`VALIDATION_FAILED`, `RELAY_TIMEOUT`, `EXECUTION_FAILED`, …) plus a `feature` field (`'swap' | 'moneyMarket' | …`). The pair `(feature, code)` is your discriminator. Use `isSodaxError(e)` (not bare `instanceof`).
4. **Signed vs raw is a discriminated union.** `WalletProviderSlot<K, Raw>` enforces at compile time: `{ raw: false, walletProvider: <chain-narrowed> }` for signing, `{ raw: true }` for unsigned-tx building. Mixing them is a TypeScript error.
5. **Config is dynamic.** `await sodax.config.initialize()` fetches current chain/token config from the backend, with a safe fallback to packaged defaults. Prefer `sodax.config.*` so backend updates take effect — static defaults stay stale until you initialize. Per-symbol status of v1 globals (deleted vs still-exported-as-defaults) lives in [`migration/breaking-changes/architecture.md`](migration/breaking-changes/architecture.md) § 2.

## Top 5 v1 → v2 traps

1. **Reaching for a `*SpokeProvider`.** They're deleted. Pass an object satisfying the chain-specific `I*WalletProvider` interface (e.g. `IEvmWalletProvider`) directly into the SDK call payload. Implementations come from your application — write your own to satisfy the interface, or install `@sodax/wallet-sdk-core` (a separate SODAX package, not bundled into `@sodax/sdk`) for ready-made implementations. The chain key on the payload is what routes — there is no provider class for `@sodax/sdk` consumers to instantiate.
2. **Forgetting `raw: false`.** Without the discriminator, `walletProvider` is rejected with "Object literal may only specify known properties, and 'walletProvider' does not exist in type". Add `raw: false` for signed flows; `raw: true` for unsigned-tx building.
3. **Importing from `@sodax/types` directly.** `@sodax/sdk` re-exports the entire `@sodax/types` surface via its barrel. Add `@sodax/sdk` as your only dependency; importing `@sodax/types` separately risks version skew.
4. **Treating `Result<T>` as throw-on-failure.** v2 mutation methods do **not** throw on SDK-level failure — they resolve `{ ok: false, error }`. A `try { await sodax.<method>(...) } catch` only catches *exceptions* from inside `mutationFn` (e.g. missing `walletProvider`); it will **not** catch `RELAY_TIMEOUT` or `EXECUTION_FAILED`. Branch on `.ok`.
5. **Reading `xToken.xChainId` or hard-coding `*_MAINNET_CHAIN_ID`.** Renamed: `XToken.chainKey` and `ChainKeys.*`. v1 numeric/string chain-id constants are gone. `ChainKeys.ICON_MAINNET` is `'0x1.icon'` (a string), not the legacy numeric ID — `Number(chainKey)` returns `NaN`.

See `migration/README.md` for the complete trap list and `migration/breaking-changes/` for full v1↔v2 detail.

## Public API contract

- Import only from the package root: `import { Sodax, ChainKeys, type SpokeChainKey } from '@sodax/sdk'`.
- Do **not** add `@sodax/types` to your dependencies — `@sodax/sdk` re-exports the full types surface (`export * from '@sodax/types'` from the barrel). Importing `@sodax/types` separately is unsupported and may silently version-skew.
- Do **not** deep-import from `dist/...`. Internal paths are not stable across releases. Anything intended for consumer use is exported from the root.
- The published tarball ships `dist/` and `ai-exported/`. Do not rely on any other path being present.

## Conventions agents must follow

- **`Result<T>` discrimination on `.ok`.** Always branch on `result.ok` before reading `.value` or `.error`. Forward sub-Results without re-wrapping (`if (!sub.ok) return sub`).
- **`(feature, code)` for error switching.** Use `isSodaxError(e)`, then `e.feature` and `e.code` for routing logic. Don't string-match on `e.message`.
- **`ChainKeys.*` over hard-coded strings.** Use `ChainKeys.ETHEREUM_MAINNET`, not `'eth'` / `'0xa86a.fuji'`. The set of supported chains evolves per release.
- **No `as unknown as <Type>` double-casts.** v2 type narrowing makes them unnecessary in 99% of cases — chain-key generic flow + `GetWalletProviderType<K>` resolves to the exact interface. If a cast feels needed, look for the chain-key narrowing pattern in `integration/recipes/` first.
- **Conventional commits if generating commits** in the consumer repo (`feat:`, `fix:`, `chore:`). Many SODAX-adjacent repos enforce this via commitlint.
- **Don't generate `try { await sodax.<method>(...) } catch` for SDK-level failures.** That catch never fires for `Result` `!ok`. Branch on `result.ok`.

## Pointers

- `integration/README.md` — start here for any new v2 work.
- `migration/README.md` — start here for any v1 → v2 port.
- `integration/quickstart.md` — install, initialize, first-run troubleshooting.
- `integration/reference/` — chain key table, error code table, public API surface, glossary.
