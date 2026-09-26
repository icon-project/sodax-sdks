# Core SDK size optimisation — projected evaluation

- **Scope:** `packages/sdk` (`@sodax/sdk` 2.0.0-rc.17) at commit `cbce9d2`. Wallet packages and dapp-kit are
  covered only where they change the conclusions.
- **Question:** how much smaller could a consumer's bundle get if the core SDK were tree-shakable by feature
  and by chain family (consumers import only the chain providers and feature providers they need)? And how
  much more could we save by replacing the large chain libraries we only use a small part of?
- **Method:** every size below was measured by bundling the real SDK source with esbuild, the way a
  browser app would; none is a hand estimate (effort ratings are judgement). Projections are modelled by
  removing, at bundle time, the modules a modular SDK would no longer import. Replacement libraries are
  stood in for by snippets that use the same API surface the SDK uses today. The harness and raw results
  are in [`packages/sdk/scripts/size-evaluation/`](../scripts/size-evaluation/README.md). Section 8 lists the modelling caveats.

Sizes are KB (1 KB = 1024 B). "gzip" is level 9; "brotli" is quality 11, which is what most CDNs serve. Both
are shown because they diverge sharply on duplicated content (§2.4).

---

## 1. Summary

**Today every browser consumer ships the whole SDK: 4,737 KB minified, 1,252 KB gzip, 835 KB brotli.** That
holds even if they only use one feature on one chain. It holds even if they import one helper:
`isSodaxError` alone costs 823 KB gzip from the published build. There are three causes:

1. **The flat, single-file `dist/`** discards module boundaries. Bundlers can't drop the chain SDKs it imports.
2. **Eager wiring.** `new Sodax()` builds every feature service, and `SpokeService` builds every chain service.
3. **Chain code leaks into shared modules.** The address codec in `shared-utils.ts` and the swap solver
   helpers on the hub path mean even an EVM-only core pulls in Stellar, Solana, Sui, Stacks, Bitcoin and
   PancakeSwap, which in turn pulls in Solana.

Chain libraries dominate the bytes. `SpokeService` on its own (the chain router) accounts for 1,110 of the
1,256 KB gzip.

**Projected results** (gzip; brotli in the tables):

| Consumer | Today | Modular + leak-free (L2) | + lighter chain libs (L3) |
| --- | --: | --: | --: |
| Swaps, EVM only | 1,252 | 156 (−88%) | 155 (−88%) |
| Swaps, EVM + Solana | 1,252 | 306 (−76%) | 195 (−84%) |
| All features, EVM only | 1,252 | 331 (−74%) | 205 (−84%) |
| Swaps, all chains | 1,252 | 1,036 (−17%) | 527 (−58%) |
| **Full SDK, unchanged `new Sodax()` API** | 1,252 | 1,185 (−5%) | **589 (−53%)** |

What the numbers say:

- **Modularising the API on its own is not enough.** Making providers pluggable but leaving the leaks
  (L1) only brings an EVM-only swap consumer down to 784 KB gzip (−37%). The big win comes from fixing the
  leaks (L1 → L2: 784 → 156).
- **Replacing chain libraries helps every consumer, including those on today's API.** Swapping the ICON,
  NEAR, Injective, Solana and Stellar libraries and PancakeSwap for lighter equivalents would halve the
  full, unchanged `new Sodax()` bundle (1,252 → 589 KB gzip, 835 → 449 KB brotli) with no public API
  redesign.
- **The two tracks multiply.** Once consumers can pick chains, each chain's library cost only lands on the
  consumers that pick it. Solana, for example, would add 40 KB gzip (L3) instead of 150 KB (L2).

**Highest-value levers** (gzip saved where the chain or feature is included; §5):

| Lever | Saves | Effort | Notes |
| --- | --: | :-: | --- |
| ICON: `icon-sdk-js` → ~30-line fetch JSON-RPC client | ~144 | S | The SDK uses 3 RPC calls, 2 builders and 3 converters of a 450 KB lib |
| Stellar: drop Horizon, import `@stellar/stellar-sdk/minimal/rpc` + base | ~128 | M | Horizon is used for `loadAccount`, balances and latest ledger. All three have Soroban RPC equivalents |
| DEX: PancakeSwap SDKs → vendored CL math + ABIs over viem | ~125 | M | `swap-sdk-core` alone drags in `@solana/web3.js` and bn.js |
| Injective: `@injectivelabs/sdk-ts` → LCD REST + `cosmjs-types` encoders | ~118 | M | Subpath imports don't help: the chunks share one 280 KB proto bundle |
| Solana: web3.js v1 + Anchor → `@solana/kit` + static instruction encoders | ~110 | M–L | Also removes Anchor's runtime IDL fetches (an RPC round trip each, plus `pako`) |
| NEAR: `near-api-js` → fetch `call_function` | ~33 | S | The only call the SDK makes is `JsonRpcProvider.callFunction` |
| Bitcoin: bitcoinjs-lib → `@scure/btc-signer` | ~17 | M | Lower value. Worth doing if versions of `@noble/*` converge |
| Packaging: stop inlining `@sodax/types` into swaps-api / bridge-api | 73.5 gz / 4.2 br | S | Mostly a gzip artefact, but free |

Stacks (41 KB) and Sui (73 KB) have no cheap replacement with the same capabilities (§5).

---

## 2. Where the size comes from today

### 2.1 The published build defeats tree-shaking

`tsup.config.ts` emits one entry with `splitting: false`, and `noExternal` inlines `near-api-js` and
`@sodax/types`. Once everything is one module, `"sideEffects": false` has nothing to act on. Every external
import at the top of `dist/index.mjs` is kept whenever anything from the SDK is used, because several of those
packages are side-effectful or ship as CJS/UMD.

The same imports resolved through the SDK's module graph show what per-module ESM output would give (T1).
`isSodaxError` drops from 823 KB to 0.7 KB gzip. `encodeAddress` stays heavy (491 KB) because of the
leak described in §2.3.

**T1 — Import shapes: published flat dist vs module graph (KB)**

| Import | dist min | dist gzip | dist brotli | module-graph gzip | module-graph brotli |
|---|--:|--:|--:|--:|--:|
| `new Sodax()` | 4736.9 | 1251.9 | 835.2 | 1256.2 | 836.4 |
| `isSodaxError only` | 2951.4 | 823.4 | 587.3 | 0.7 | 0.6 |
| `encodeAddress only` | 3071.6 | 865.5 | 614.5 | 491.4 | 375.0 |
| `SpokeService only` | 4126.7 | 1111.7 | 782.4 | 1110.3 | 780.4 |
| `sodaxConfig only` | 2955.6 | 824.9 | 588.3 | 37.9 | 30.0 |

@sodax/types inlined into swaps-api + bridge-api: 238.5 KB min, 73.5 KB gzip, 4.2 KB brotli.

### 2.2 Eager construction

- `Sodax` (`src/shared/entities/Sodax.ts:66-133`) constructs 12 feature services, `BackendApiService`
  with its 4 sub-clients (`BackendApiService.ts:322-334`), `ConfigService`, `EvmHubProvider` and
  `SpokeService`.
- `SpokeService` (`SpokeService.ts:30-39, 146-155`) imports and constructs all 10 chain services and
  switches on chain type in roughly ten methods. There is no registration mechanism.
- Most chain constructors open network clients at `new Sodax()`: a Solana `Connection`, Horizon and
  Soroban servers, a Sui gRPC client, three Injective gRPC clients, ICON, NEAR and Stacks.
- dapp-kit always calls `new Sodax(config)` (`packages/dapp-kit/src/providers/SodaxProvider.tsx:24`).

**T2 — Where the bytes go today (`new Sodax()`, minified KB, top 30)**

| Bucket | min KB | share |
|---|--:|--:|
| `@stellar/stellar-sdk` | 1013.3 | 21.4% |
| `icon-sdk-js` | 450.1 | 9.5% |
| `@injectivelabs/core-proto-ts-v2` | 282.9 | 6.0% |
| `@mysten/sui` | 193.7 | 4.1% |
| `viem` | 191.4 | 4.0% |
| `@solana/web3.js` | 190.1 | 4.0% |
| `@noble/curves` | 168.0 | 3.5% |
| `@sodax/types` | 150.2 | 3.2% |
| `@sodax/swaps-api` | 129.2 | 2.7% |
| `@sodax/bridge-api` | 125.7 | 2.7% |
| `@sodax/libs` | 116.5 | 2.5% |
| `sdk:shared/abis` | 95.2 | 2.0% |
| `bitcoinjs-lib` | 94.5 | 2.0% |
| `bn.js` | 87.9 | 1.9% |
| `@pancakeswap/v3-sdk` | 83.0 | 1.8% |
| `@coral-xyz/anchor` | 81.4 | 1.7% |
| `@injectivelabs/exceptions` | 74.2 | 1.6% |
| `@injectivelabs/sdk-ts` | 73.8 | 1.6% |
| `@noble/hashes` | 72.7 | 1.5% |
| `@pancakeswap/infinity-sdk` | 53.7 | 1.1% |
| `axios` | 47.9 | 1.0% |
| `near-api-js` | 47.5 | 1.0% |
| `pako` | 46.9 | 1.0% |
| `cosmjs-types` | 44.8 | 0.9% |
| `sdk:moneyMarket` | 41.6 | 0.9% |
| `abitype` | 38.9 | 0.8% |
| `sdk:leverageYield` | 36.3 | 0.8% |
| `bip174` | 34.4 | 0.7% |
| `@protobuf-ts/runtime` | 31.9 | 0.7% |
| `sdk:backendApi` | 26.9 | 0.6% |


### 2.3 Chain code leaking into shared and hub modules

These leaks are why "just make it pluggable" is not enough (T3, L1 column):

- **`shared/utils/shared-utils.ts:25-28`** value-imports `@mysten/sui/bcs`, `@solana/web3.js`,
  `@stellar/stellar-sdk` and `@sodax/libs/stacks/core`, and pulls in bitcoinjs through
  `entities/btc/btc-utils.ts`. Only `encodeAddress` / `reverseEncodeAddress` (l.152-257) need them.
  - `EvmHubProvider.ts:78` calls `encodeAddress` on the always-live hub path.
  - 14 other modules call `encodeAddress`, 9 of them in feature directories.
  - Modules that only need `sleep` / `retry` import the same file, e.g. `pollBackendSubmitTx.ts:3`.
- **`SonicSpokeService.ts:33`** imports `swap/EvmSolverService.ts`. That file imports one ABI constant,
  `CLPositionManagerAbi`, from `@pancakeswap/infinity-sdk` (`EvmSolverService.ts:40`).
  - Bundled alone, that single import costs 477 KB minified / 134 KB gzip.
  - The reason: `infinity-sdk` → `v3-sdk` → `@pancakeswap/swap-sdk-core`, which has no `sideEffects` flag
    and statically imports `PublicKey` from `@solana/web3.js`, plus bn.js, big.js and decimal.js-light.
- **Features reaching into specific chains:**
  - `this.spoke.bitcoin.*` (RadFi trading wallet) in swap, bridge, moneyMarket and leverageYield.
  - `this.spoke.stellar.server` (Horizon) and direct `@stellar/stellar-sdk` imports in sponsoring.
  - The static `SonicSpokeService.createSwapIntent` in swap and leverageYield.
- **Module-level side effects** that a split must handle:
  - `initEccLib(ecc)` at `BitcoinSpokeService.ts:48`.
  - `class … extends rpc.Server` at `CustomSorobanServer.ts:10`.
  - The ICON CJS-interop destructure at `IconSpokeService.ts:2-3`.
  - Un-annotated top-level `getAbiItem` / `parseAbi` / `getEvmViemChain` calls.

### 2.4 Duplicated code

- `@sodax/swaps-api` and `@sodax/bridge-api` each inline their own copy of `@sodax/types`
  (`noExternal: ['@sodax/types']` in both `tsup.config.ts` files).
  - Their own code is small. Most of each dist is the inlined types.
  - The consumer bundle therefore carries three copies of the token and chain tables: 238.5 KB minified,
    73.5 KB gzip.
  - Brotli's large window removes almost all of it (4.2 KB), so the real-world cost depends on the CDN.
- 11 packages are bundled in two to four versions (T8), for 277 KB minified in the extra copies:
  - `@solana/web3.js` 1.98.0 (SDK) + 1.98.4 (PancakeSwap)
  - viem 2.29.2 (SDK, pinned exactly) + 2.37.13 + 2.50.4 (PancakeSwap / Injective)
  - bn.js ×2, `@noble/curves` ×3, `@noble/hashes` ×4, and others
- Four big-number libraries ship together: bn.js (Anchor arguments), bignumber.js (money-market maths and
  one `shiftedBy` in bridge), and big.js / decimal.js-light (PancakeSwap). Native `bigint` is used
  everywhere else.

**T8 — Packages bundled in more than one version (full bundle, minified KB)**

| Package | Versions (KB) | Extra copies KB |
|---|---|--:|
| @noble/curves | 1.9.7: 103.2, 1.8.2: 32.6, 2.0.1: 32.2 | 64.8 |
| @solana/web3.js | 1.98.0: 129.5, 1.98.4: 60.6 | 60.6 |
| bn.js | 5.2.3: 44.0, 5.2.1: 43.9 | 43.9 |
| viem | 2.29.2: 157.8, 2.37.13: 28.4, 2.50.4: 5.2 | 33.6 |
| @noble/hashes | 1.8.0: 42.6, 2.0.1: 11.8, 1.7.2: 10.7, 2.2.0: 7.6 | 30.1 |
| abitype | 1.0.8: 14.1, 1.2.4: 13.4, 1.1.0: 11.4 | 24.8 |
| @scure/base | 1.2.6: 5.5, 2.0.0: 4.5, 2.3.0: 3.0 | 7.5 |
| borsh | 2.0.0: 10.6, 0.7.0: 7.3 | 7.3 |
| eventemitter3 | 5.0.4: 2.8, 4.0.7: 2.8 | 2.8 |
| base-x | 4.0.1: 1.6, 3.0.11: 1.5 | 1.5 |
| bs58 | 5.0.0: 0.1, 4.0.1: 0.1 | 0.1 |

Total in non-primary copies: 276.9 KB minified.

---

## 3. Modelled levels

| Level | What changes (as modelled) |
| --- | --- |
| **L0** today | Published `dist/index.mjs`, `new Sodax()` |
| **L1** pluggable providers | The facade and `SpokeService` no longer import the feature services and chain spoke services a consumer didn't select. Nothing else moves |
| **L2** leak-free | L1, plus: <br>• chain-specific code moves into its chain provider (address codec, chain utils/entities, chain library imports from shared code) <br>• the backend sub-clients move into their features <br>• the solver vendors its one PancakeSwap ABI <br>• `@sodax/types` stops being inlined into swaps-api / bridge-api |
| **L3** lighter libraries | L2, plus the per-chain library replacements in §5, the vendored DEX maths, and bignumber.js / rlp replaced by bigint / viem |

The exact files and imports removed at each level are listed in [`measure/scenarios.mjs`](../scripts/size-evaluation/measure/scenarios.mjs)
and [`measure/l3.mjs`](../scripts/size-evaluation/measure/l3.mjs).

## 4. Projections

### 4.1 Consumer profiles

**T3 — Consumer profiles (gzip KB, brotli in parentheses)**

| Profile | Today | L1 pluggable only | L2 leak-free | L3 + lighter libs | L3 vs today (gz / br) |
|---|--:|--:|--:|--:|--:|
| Full (all features, all chains) | 1251.9 (835.2) | 1256.2 (836.4) | 1185.4 (832.7) | 588.7 (449.1) | -53% / -46% |
| Core only (hub + EVM, no features) | 1251.9 (835.2) | 775.5 (500.5) | 143.4 (111.5) | 142.2 (110.8) | -89% / -87% |
| Swaps, EVM only | 1251.9 (835.2) | 784.3 (507.7) | 156.1 (121.9) | 154.9 (121.2) | -88% / -85% |
| Swaps, EVM + Solana | 1251.9 (835.2) | 832.3 (542.1) | 306.1 (235.7) | 194.6 (154.0) | -84% / -82% |
| Swaps, EVM + Solana + Sui | 1251.9 (835.2) | 895.6 (592.5) | 378.8 (293.9) | 267.1 (212.6) | -79% / -75% |
| Swaps, all chains | 1251.9 (835.2) | 1206.8 (802.4) | 1035.9 (756.0) | 527.3 (412.0) | -58% / -51% |
| Money market, EVM only | 1251.9 (835.2) | 790.5 (512.0) | 166.4 (130.4) | 156.7 (122.1) | -87% / -85% |
| Money market, all chains | 1251.9 (835.2) | 1213.1 (807.1) | 1038.3 (757.3) | 530.0 (413.2) | -58% / -51% |
| Bridge, EVM only | 1251.9 (835.2) | 784.1 (507.5) | 163.4 (128.2) | 153.7 (120.2) | -88% / -86% |
| Staking, EVM only | 1251.9 (835.2) | 783.1 (506.3) | 150.7 (117.6) | 149.5 (116.8) | -88% / -86% |
| DEX, EVM only | 1251.9 (835.2) | 791.3 (511.2) | 291.4 (210.5) | 165.2 (122.4) | -87% / -85% |
| Swaps + MM + Bridge, EVM only | 1251.9 (835.2) | 799.9 (518.6) | 181.2 (140.7) | 171.5 (132.8) | -86% / -84% |
| All features, EVM only | 1251.9 (835.2) | 825.2 (535.0) | 331.4 (239.3) | 204.8 (151.0) | -84% / -82% |

The same profiles in minified KB:

**T4 — Consumer profiles (minified KB)**

| Profile | Today | L1 | L2 | L3 |
|---|--:|--:|--:|--:|
| Full (all features, all chains) | 4736.9 | 4740.5 | 4517.1 | 2251.1 |
| Core only (hub + EVM, no features) | 4736.9 | 2748.5 | 507.8 | 504.6 |
| Swaps, EVM only | 4736.9 | 2779.6 | 554.2 | 551.0 |
| Swaps, EVM + Solana | 4736.9 | 2950.5 | 1066.0 | 685.6 |
| Swaps, EVM + Solana + Sui | 4736.9 | 3197.1 | 1342.8 | 960.8 |
| Swaps, all chains | 4736.9 | 4446.7 | 3841.2 | 1906.2 |
| Money market, EVM only | 4736.9 | 2839.9 | 617.4 | 596.0 |
| Money market, all chains | 4736.9 | 4507.2 | 3887.3 | 1952.5 |
| Bridge, EVM only | 4736.9 | 2792.7 | 582.0 | 560.3 |
| Staking, EVM only | 4736.9 | 2800.7 | 559.9 | 556.7 |
| DEX, EVM only | 4736.9 | 2843.3 | 1074.9 | 632.1 |
| Swaps + MM + Bridge, EVM only | 4736.9 | 2878.3 | 679.7 | 658.2 |
| All features, EVM only | 4736.9 | 3023.6 | 1285.2 | 842.3 |

Reading the table:

- **Core floor.** An EVM-only core with no features is 143 KB gzip at L2. The remaining weight is viem
  (≈174 KB minified), the `@sodax/types` config (≈148 KB minified, of which `chains/tokens.js` is 91 KB),
  the hub ABIs, `SpokeService` and `ConfigService`. Lower than this needs config and viem work (§6).
- **Features are cheap once the leaks are gone** (T6). Most add 2–23 KB gzip. DEX is the outlier at
  148 KB, all PancakeSwap and its transitive Solana dependency, and falls to 23 KB with the vendored port.
- **Chains carry the cost** (T5). Stellar is the heaviest provider even after optimisation (148 KB gzip at
  L3). Of that, `stellar-base` (the XDR schema plus primitives) is 445 KB minified.

### 4.2 Chain providers

**T5 — Chain provider marginal cost on top of "Swaps, EVM only" (gzip KB, brotli in parentheses)**

| Chain | L2 added alone | L2 removed from full | L3 added alone | Largest contributors at L2 (min KB) |
|---|--:|--:|--:|---|
| solana | 150.0 (113.7) | 90.8 | 39.7 (32.8) | @solana/web3.js=128.2, @coral-xyz/anchor=80.8, @noble/curves=61.8, pako=46.3, bn.js=44.1, @noble/hashes=22.6, bignumber.js=18.5, @solana/buffer-layout=17.9 |
| stellar | 276.6 (207.6) | 276.6 | 148.4 (117.6) | @stellar/stellar-sdk=1010.4, sdk:spoke/StellarSpokeService=10.8 |
| sui | 72.5 (58.8) | 59.1 | 72.6 (58.8) | @mysten/sui=191.5, @protobuf-ts/runtime=31.7, @mysten/bcs=11.5, @protobuf-ts/grpcweb-transport=8.2, @noble/hashes=7.5, @protobuf-ts/runtime-rpc=6.3, sdk:spoke/SuiSpokeService=5.1, @mysten/utils=4.7 |
| icon | 145.5 (120.4) | 147.5 | 1.6 (1.2) | icon-sdk-js=449.6, sdk:spoke/IconSpokeService=3.9 |
| injective | 132.8 (106.8) | 110.6 | 14.7 (12.3) | @injectivelabs/core-proto-ts-v2=280.6, @injectivelabs/sdk-ts=73.6, @injectivelabs/exceptions=73.6, axios=47.3, cosmjs-types=44.5, @protobuf-ts/runtime=31.7, @injectivelabs/indexer-proto-ts-v2=20.6, bignumber.js=18.6 |
| near | 34.6 (24.9) | 33.9 | 1.5 (1.1) | near-api-js=47.3, @noble/curves=32.0, @noble/hashes=11.8, borsh=10.5, sdk:spoke/NearSpokeService=4.8, @scure/base=4.4 |
| stacks | 40.8 (28.8) | 41.0 | 41.0 (28.8) | @sodax/libs=115.0, sdk:spoke/StacksSpokeService=4.6 |
| bitcoin | 70.0 (53.2) | 49.6 | 53.2 (42.1) | bitcoinjs-lib=93.9, @noble/curves=45.4, bip174=34.0, @noble/hashes=23.2, sdk:entities/btc=9.1, sdk:spoke/BitcoinSpokeService=8.7, typeforce=5.9, @bitcoinerlab/secp256k1=5.8 |

"Added alone" is the cost of adding that chain to "Swaps, EVM only". "Removed from full" is the saving from
dropping it from everything else. The two differ when a library is shared with another chain or feature:
`@noble/*`, bn.js and bignumber.js, for example.

### 4.3 Feature providers

**T6 — Feature provider marginal cost on top of core (L2)**

| Feature | +min KB | +gzip KB | +brotli KB | Largest contributors (min KB) |
|---|--:|--:|--:|---|
| swaps | 46.4 | 12.7 | 10.4 | sdk:swap=18.6, @sodax/swaps-api=9.7, sdk:backendApi=6.0, sdk:shared/services=3.5, sdk:errors=3.2, valibot=3.0 |
| moneyMarket | 109.7 | 23.0 | 18.9 | sdk:moneyMarket=41.5, sdk:shared/abis=39.4, bignumber.js=18.5, sdk:shared/services=5.9, sdk:errors=3.4 |
| dex | 567.1 | 148.0 | 99.0 | bn.js=87.9, @pancakeswap/v3-sdk=82.8, @solana/web3.js=53.5, @pancakeswap/infinity-sdk=53.5, @noble/curves=39.2, viem=28.3, sdk:shared/abis=24.9, sdk:dex=24.5 |
| migration (on icon+stellar) | 63.8 | 8.9 | 6.7 | sdk:shared/abis=31.0, sdk:migration=22.4, sdk:shared/services=5.9, sdk:errors=3.4 |
| bridge | 74.2 | 20.0 | 16.7 | bignumber.js=18.5, sdk:shared/abis=16.2, sdk:bridge=14.3, @sodax/bridge-api=6.4, sdk:shared/services=6.2, sdk:backendApi=4.8, sdk:errors=3.5, valibot=3.0 |
| staking | 52.1 | 7.3 | 6.1 | sdk:shared/abis=22.4, sdk:staking=19.8, sdk:shared/services=5.9, sdk:errors=3.4 |
| partners | 15.3 | 3.3 | 2.6 | sdk:partner=8.5, sdk:swap=2.6, sdk:shared/abis=2.4 |
| recovery | 21.5 | 2.1 | 1.8 | sdk:shared/abis=16.2, sdk:shared/services=2.6, sdk:recovery=2.1 |
| leverageYield | 89.6 | 16.9 | 14.0 | sdk:leverageYield=36.2, sdk:shared/abis=23.8, sdk:backendApi=8.7, sdk:shared/services=8.3, sdk:errors=3.5, valibot=2.8, @sodax/swaps-api=2.6, sdk:swap=2.6 |
| sponsoring (on stellar) | 16.4 | 5.1 | 4.2 | sdk:sponsoring=11.7 |
| dex at L3 (vendored port) | 127.5 | 23.0 | 11.6 | |

---

## 5. Chain library optimisation

Every variant was bundled standalone with the same settings, exercising the API surface the SDK uses today
([`alternatives/`](../scripts/size-evaluation/alternatives)).

**T7 — Chain library surface: today vs alternatives (standalone bundles, KB)**

| Chain | Variant | min | gzip | brotli |
|---|---|--:|--:|--:|
| solana | current: web3.js + spl-token + anchor (used symbols) | 504.7 | 148.1 | 120.5 |
| solana | alt: @solana/kit + @solana-program/* + static ix encoders | 81.8 | 26.1 | 22.5 |
| stellar | current: @stellar/stellar-sdk root (used symbols) | 1009.9 | 273.3 | 207.8 |
| stellar | alt: @stellar/stellar-sdk/minimal | 857.2 | 222.6 | 169.2 |
| stellar | alt: minimal/rpc + stellar-base, no Horizon | 548.9 | 145.5 | 117.7 |
| sui | current: gRPC client + transactions + bcs | 272.9 | 72.5 | 60.5 |
| sui | alt: JSON-RPC client + transactions + bcs | 151.8 | 43.3 | 37.7 |
| sui | alt: GraphQL client + transactions + bcs | 247.5 | 67.0 | 56.7 |
| sui | floor: transactions + bcs only (no client) | 97.2 | 29.7 | 26.2 |
| icon | current: icon-sdk-js | 449.1 | 146.0 | 120.4 |
| icon | alt: fetch JSON-RPC + tx builder | 1.0 | 0.6 | 0.5 |
| injective | current: sdk-ts root + networks + cosmjs-types | 673.2 | 133.6 | 110.1 |
| injective | alt: sdk-ts granular subpaths | 673.2 | 133.4 | 110.1 |
| injective | alt: REST (LCD) + cosmjs-types encoders | 80.3 | 13.6 | 11.8 |
| near | current: near-api-js JsonRpcProvider | 106.3 | 32.8 | 28.7 |
| near | alt: @near-js/providers | 60.8 | 16.8 | 15.0 |
| near | alt: fetch JSON-RPC call_function | 0.6 | 0.4 | 0.3 |
| stacks | current: @sodax/libs/stacks/core (used symbols) | 114.9 | 39.8 | 31.7 |
| stacks | ref: @sodax/libs/stacks/core (everything) | 122.5 | 41.6 | 33.3 |
| bitcoin | current: bitcoinjs-lib + @bitcoinerlab/secp256k1 | 215.8 | 65.5 | 56.2 |
| bitcoin | alt: @scure/btc-signer | 143.1 | 47.6 | 42.1 |
| dex | current: PancakeSwap SDK surface | 508.6 | 140.5 | 109.0 |
| dex | same, minus Solana leak in swap-sdk-core | 284.7 | 70.8 | 59.8 |
| dex | alt: vendored CL math + ABIs over viem | 63.1 | 14.8 | 13.1 |

**ICON — replace `icon-sdk-js` (−144 KB gzip, effort S).**
- The SDK uses `IconService` + `HttpProvider` for `getBalance`, `call` and `getTransactionResult`,
  `CallBuilder`, `CallTransactionBuilder`, and `Converter.toRawTransaction` / `toHex` / `toBigNumber`
  (`IconSpokeService.ts`).
- All of that is JSON-RPC plus plain-object construction. Signing happens in the wallet.
- The package is a minified UMD bundle with its own secp256k1 and big-number code, so nothing in it can be
  tree-shaken.
- A fetch-based client of about 30 lines covers the surface (0.6 KB gzip).

**NEAR — replace `near-api-js` (−33 KB gzip, effort S).**
- The only call is `JsonRpcProvider.callFunction` (`NearSpokeService.ts:49-59`), a JSON-RPC `query` /
  `call_function` request.
- As a bonus, the `noExternal: ['near-api-js']` workaround in `tsup.config.ts` goes away, and with it the
  inlined `@noble` / `borsh` copies.

**Stellar — drop Horizon, import granular entries (−128 KB gzip, effort M).**
- The root entry's `browser` condition resolves to the prebuilt `dist/stellar-sdk.min.js` UMD, about 1 MB.
  Bundlers can't shake it.
- `@stellar/stellar-sdk/minimal` only removes axios and eventsource (223 KB).
- Removing Horizon too gets to 146 KB. That means `/minimal/rpc` plus the base primitives.
- Horizon is used for three things:
  - `loadAccount` (`StellarSpokeService.ts:182, 272, 372, 546, 666`; `SponsoringService.ts:204, 404`)
  - account balances (`:619`)
  - the latest ledger (`SponsoringService.ts:228`)
- Soroban RPC covers each one: `getAccount`, `getLedgerEntries` for trustlines, and `getLatestLedger`.
- This is a behaviour change to review with the Stellar and sponsoring owners. `sodax.spoke.stellar.server`
  is public and dapp-kit uses it.
- The remaining ~445 KB minified is `stellar-base`, mostly its generated XDR schema. A hand-picked XDR
  subset is possible in principle, but high-risk and not recommended.

**Injective — replace `@injectivelabs/sdk-ts` (−118 KB gzip, effort M).**
- Importing from its granular subpaths gains nothing (T7): every chunk links the same 280 KB
  `core-proto-ts-v2` bundle.
- The SDK needs:
  - a CosmWasm smart query
  - portfolio balances
  - account number and sequence
  - simulate and broadcast of one `MsgExecuteContract`
- LCD REST plus `cosmjs-types` protobuf encoders cover this in 14 KB gzip, including the one-field
  Injective `EthSecp256k1` pubkey `Any`.
- To verify: whether the indexer portfolio semantics (`IndexerGrpcAccountPortfolioApi`) can be replaced by
  bank balances for every current caller.

**Solana — move to `@solana/kit` (−110 KB gzip, effort M–L).**
- Today the SDK ships web3.js v1, spl-token and Anchor (`AnchorProvider`, `Program`) plus bn.js, pako,
  buffer-layout, superstruct and rpc-websockets.
- Anchor fetches the IDL from chain at runtime (`Program.fetchIdl`, `entities/solana/utils/utils.ts:19,34`)
  to build two programs' instructions: deposit and `sendMessage`.
- `@solana/kit` + `@solana-program/{token,system,compute-budget}`, with static (Codama-style) instruction
  encoders for the two SODAX programs, covers the same surface in 26 KB gzip.
- It also removes the two runtime IDL fetches.
- Trade-offs:
  - the program layouts become an SDK release dependency
  - web3.js v1 types stop appearing in the public surface
  - wallet-sdk-core still uses web3.js (§8)

**Bitcoin — `@scure/btc-signer` (−17 KB gzip, effort M).**
- It is a smaller gain, and PSBT handling is correctness-critical (RadFi flows).
- The saving grows if `@noble/*` versions converge with viem's, since `@scure/btc-signer` 2.x is built on
  them.
- Schedule it after the others.

**Sui — keep `@mysten/sui` gRPC.**
- The SDK already imports the granular subpaths (`/grpc`, `/transactions`, `/bcs`).
- JSON-RPC would measure 29 KB gzip smaller, but it is not an option. Sui disabled JSON-RPC on Sui
  Foundation mainnet full nodes in late July 2026, and full decommission is planned for mid-October 2026
  ([Sui JSON-RPC migration guide](https://docs.sui.io/develop/accessing-data/json-rpc-migration),
  [Mysten SDK migration notes](https://sdk.mystenlabs.com/sui/migrations/sui-2.0/json-rpc-migration)).
- GraphQL saves only 5 KB.
- The floor without any client is 30 KB. A hand-written client for the four gRPC methods the SDK calls
  (`listCoins`, `simulateTransaction`, `getObject`, `waitForTransaction`; `SuiGrpcTransport.ts:77-147`)
  could get close, but that's a later, optional step.

**Stacks — keep, 41 KB gzip.**
- `@sodax/libs/stacks/core` already isolates `@stacks/transactions`. The used subset (40 KB) is almost the
  whole package (42 KB): contract-call construction, Clarity serialisation and c32 addresses.
- There is no maintained lighter equivalent.

**DEX — vendor the PancakeSwap maths (−125 KB gzip, effort M).**
- DEX imports `Price` and `Token`, three calldata encoders, the pool-id/key codec and two ABIs from
  `infinity-sdk`, plus `TickMath`, `PositionMath`, `maxLiquidityFor*`, `tickToPrice` and
  `sqrtRatioX96ToPrice` from `v3-sdk` (`ConcentratedLiquidityService.ts:35-54`).
- It is all bigint maths plus viem ABI encoding. The measured vendored port is 15 KB gzip standalone.
- Keep the PancakeSwap packages as test-only oracles and property-test the port against them.
- Just avoiding `swap-sdk-core`'s Solana leak would halve the cost (T7, 71 KB), but only PancakeSwap can
  fix that upstream.

The savings per lever, where the chain or feature is included (these are the figures used in §1 and §9):

**T10 — Library levers: saving where the chain / feature is included (L2 cost − L3 cost, KB)**

| Lever | min | gzip | brotli |
|---|--:|--:|--:|
| solana | 377.2 | 110.3 | 81.0 |
| stellar | 462.8 | 128.2 | 90.1 |
| icon | 449.3 | 143.9 | 119.2 |
| injective | 587.9 | 118.0 | 94.4 |
| near | 105.8 | 33.1 | 23.8 |
| bitcoin | 71.6 | 16.8 | 11.1 |
| dex (feature) | 439.7 | 125.1 | 87.4 |
| @sodax/types deduped (full bundle) | 238.5 | 73.5 | 4.2 |

---

## 6. Other levers

- **Per-module ESM output** (tsup multi-entry + `splitting: true`, or unbundled output) and
  `@sodax/types` kept external.
  - This alone doesn't shrink `new Sodax()`.
  - It makes helper-only and partial imports cheap: 823 → 0.7 KB gzip for `isSodaxError` (T1).
  - It is a prerequisite for every other level.
  - `apps/node-cjs` is the regression harness for the CJS side.
- **Accurate `sideEffects`.** Move `initEccLib` into the Bitcoin provider's lazy initialisation, and mark the
  remaining top-level `getAbiItem` / `parseAbi` / `getEvmViemChain` calls `/* @__PURE__ */` or make them
  lazy. Otherwise a split build either keeps them or silently drops required initialisation.
- **viem as a peer dependency (range, not the exact `2.29.2` pin).**
  - viem is about 174 KB minified of the EVM core.
  - A dapp that already ships viem through wagmi pays that twice whenever the versions differ.
  - This saving lands in the app bundle, so it is not included in the tables above.
- **Version alignment** removes most of the 277 KB of duplicate copies (T8). Several duplicates disappear
  anyway with the L3 replacements (web3.js 1.98.4, bn.js, the extra viem copies).
- **Per-chain token config** is low value (T9).
  - `tokens.js` is one unshakeable 91 KB block even with `sideEffects: false`: every token entry
    dereferences `SodaTokens.*` at module level.
  - Splitting it per chain would save about 10 KB minified / 8 KB gzip for an EVM-only consumer: the
    EVM + hub slice as literal modules against today's whole table (T9).
  - Only worth doing alongside the provider split, as generated per-chain modules.
  - A bigger but riskier option is to not bundle the defaults and rely on `sodax.initialize()` fetching
    config. That trades a network dependency for about 38 KB gzip.

**T9 — Token config: per-chain split potential (KB)**

| Slice | min | gzip | brotli |
|---|--:|--:|--:|
| published tokens.js: one chain map (solanaSupportedTokens) | 91.4 | 26.6 | 22.5 |
| published tokens.js: supportedTokensByChain | 91.4 | 26.6 | 22.5 |
| literal: hub SodaTokens + EVM chain maps | 81.6 | 18.2 | 14.3 |
| literal: solana map alone | 7.1 | 2.9 | 2.7 |
| literal: injective map alone | 1.2 | 0.6 | 0.6 |
| literal: bitcoin map alone | 0.4 | 0.3 | 0.3 |
| literal: stellar map alone | 10.8 | 5.1 | 4.6 |
| literal: sui map alone | 4.1 | 1.8 | 1.6 |
| literal: icon map alone | 1.0 | 0.4 | 0.4 |
| literal: near map alone | 1.4 | 0.7 | 0.6 |
| literal: stacks map alone | 1.1 | 0.6 | 0.6 |

- **bignumber.js → bigint** saves 5–10 KB gzip in money market and bridge (T3: MM EVM-only goes from 166
  to 157 at L3). rlp → viem `toRlp` / `fromRlp` saves 3 KB minified.

---

## 7. Target shape (sketch)

Chain and feature providers are values the consumer imports, so anything not imported is never bundled:

```ts
import { createSodax } from '@sodax/sdk/core';          // hub + EVM spokes, config, backend client
import { solanaChain } from '@sodax/sdk/chains/solana';  // one entry per chain family
import { swaps } from '@sodax/sdk/features/swaps';        // one entry per feature

const sodax = createSodax({ chains: [solanaChain()], features: [swaps()] });
await sodax.swaps.getQuote({ /* ... */ });                // `sodax.moneyMarket` does not exist on this type
```

- **Chain providers** implement one interface: address codec, deposit, `sendMessage`, balances, gas
  estimate, receipt / verify, and simulation encoding.
  - `SpokeService` becomes a registry keyed by chain type instead of a switch.
  - The existing `*SpokeService` classes already take only `ConfigService`, so they are the natural
    providers.
  - `GetSpokeServiceType` becomes a lookup over registered providers.
- **Feature providers** wrap the existing services, which already use constructor injection. Each feature
  owns its backend sub-client.
  - Bitcoin trading-wallet steps become an optional hook the Bitcoin provider contributes.
  - `EvmSolverService` / `HookService` / `IntentDataService` move out of `swap/` into the hub layer.
- **Compatibility.** Keep `@sodax/sdk` (root) and `new Sodax()` as the batteries-included entry built from
  all providers. Existing consumers keep working and benefit from L3 automatically.
  - dapp-kit's `SodaxProvider` would accept a pre-built instance.
  - The `export * from '@sodax/sdk'` in dapp-kit is harmless once the SDK ships per-module ESM.
- **Lazy loading** (optional). A registry also allows `chains: { solana: () => import('@sodax/sdk/chains/solana') }`
  for apps that learn their chains at runtime. That makes chain resolution async, which is a larger API
  change. Keep it opt-in.

---

## 8. Caveats and scope limits

- **Wallet packages ship the same libraries.**
  - `@sodax/wallet-sdk-core` depends on `@solana/web3.js`, `@stellar/stellar-sdk`, `icon-sdk-js`,
    `@injectivelabs/*`, `@mysten/sui`, `near-api-js` and bitcoinjs-lib.
  - It is built the same way: one entry, `splitting: false`, near-api-js and `@sodax/types` inlined.
  - A dapp only realises the chain-library savings for the chains its wallet layer doesn't also pull in.
  - The same evaluation should be run on wallet-sdk-core / wallet-sdk-react before committing to library
    swaps, so the SDK and the wallet layer converge on one library per chain.
- **What the model covers.** It reproduces the import graph after each refactor, not the refactored code.
  - SDK-owned chain and feature code is kept at its current size.
  - Replacement libraries are represented by snippets covering today's used surface, not by production
    ports.
  - Treat L3 per-chain figures as ±20% on the library part. The L2 figures are exact for the modelled
    import graph.
- **Bundler.** esbuild, browser platform, ESM, node built-ins external.
  - Rollup/Vite and webpack were not measured. Expect similar results for ESM. No bundler can shake the
    CJS/UMD libraries (stellar, icon, bitcoinjs).
  - The `Buffer` polyfill browser apps need (the SDK uses the global `Buffer` in shared code) is not
    counted. `@solana/kit` and `@scure/*` don't need it, so full adoption could remove it too.
- **Node consumers.** Bundle size matters less there, but cold start doesn't: importing the published
  dist takes about 2 s (1,954 ms) and 126 MB of heap (median of 5 runs on Node 22,
  `measure/node-import.mjs`), while `new Sodax()` itself takes 21 ms. Loading only the needed providers would
  cut that. Not modelled.
- **Package size:** 980 KB packed, 5.10 MB unpacked (`pnpm --filter @sodax/sdk size:check`). About 1.8 MB
  of the unpacked size is the two 943 KB declaration files (`.d.ts` and `.d.cts`). That doesn't affect
  bundles.

## 9. Roadmap

Ordered by value per effort. Phase A keeps today's API. Phase B is internal apart from the Stellar
provider's public Horizon `server` field. Phase C is the API change, and the 2.0 RC window is the cheapest
moment to make it.

**Phase A — packaging (non-breaking)**
- [ ] Emit per-module ESM, and keep `@sodax/types` (and, after the NEAR swap, `near-api-js`) external. Same
      for `@sodax/swaps-api` / `@sodax/bridge-api`.
- [ ] Vendor `CLPositionManagerAbi` into `shared/abis`, which cuts PancakeSwap and Solana out of the hub
      path.
- [ ] Make `sideEffects: false` true: lazy `initEccLib`, pure annotations.
- [ ] Declare viem as a peer range (consumers then install it themselves) and align duplicated dependency
      versions.
- [ ] Add per-profile size budgets to CI with this harness's `bundle()` (extending `size:check`).

**Phase B — chain library swaps (mostly internal)**
- [ ] ICON fetch client (−144 gz)
- [ ] NEAR fetch client (−33 gz)
- [ ] DEX vendored CL maths with property tests against PancakeSwap (−125 gz)
- [ ] Injective LCD + `cosmjs-types` (−118 gz)
- [ ] Stellar without Horizon (−128 gz, reshapes `spoke.stellar.server`)
- [ ] Solana on `@solana/kit` (−110 gz)
- [ ] Bitcoin on `@scure/btc-signer` (−17 gz)
- [ ] bignumber.js → bigint

Expected result: the full `new Sodax()` bundle goes from 1,252 to about 589 KB gzip.

**Phase C — modular API (breaking; target 2.0)**
- [ ] Split `shared-utils.ts`. The address codec moves per chain, and `sleep` / `retry` go into a generic
      module.
- [ ] Move the solver helpers out of `swap/`, and move sponsoring's Horizon use behind the Stellar
      provider.
- [ ] Turn `SpokeService` into a registry with a chain-provider interface, add per-chain entries, and open
      up the type unions.
- [ ] Add feature-provider entries, give each feature its own backend sub-client, and add `createSodax`,
      keeping `Sodax` as the all-in facade.
- [ ] dapp-kit: `SodaxProvider` accepts an instance, and features are gated by the registered providers.

Expected result: an EVM-only swap integrator goes from 1,252 to about 155 KB gzip.

**Questions for the team**
1. Which consumers matter most: browser widgets and dapps, or Node partners? This decides between
   prioritising Phase B or Phase C.
2. Is a behaviour change to Stellar (Horizon → RPC) and Injective (indexer portfolio → bank balances)
   acceptable, and who owns verifying it?
3. Should the wallet packages be evaluated next, so that the SDK and the wallet layer settle on one library
   per chain?
4. Is shipping without bundled default config (relying on `sodax.initialize()`) on the table?

---

## Appendix — reproduce

See [`packages/sdk/scripts/size-evaluation/README.md`](../scripts/size-evaluation/README.md). `npm run measure` there regenerates
`results/*.json` and `results/tables.md`. The tables in this report are copied from that output.
