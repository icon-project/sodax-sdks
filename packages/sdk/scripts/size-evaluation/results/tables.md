## T1 — Import shapes: published flat dist vs module graph (KB)
| Import | dist min | dist gzip | dist brotli | module-graph gzip | module-graph brotli |
|---|--:|--:|--:|--:|--:|
| `new Sodax()` | 4736.9 | 1251.9 | 835.2 | 1256.2 | 836.4 |
| `isSodaxError only` | 2951.4 | 823.4 | 587.3 | 0.7 | 0.6 |
| `encodeAddress only` | 3071.6 | 865.5 | 614.5 | 491.4 | 375.0 |
| `SpokeService only` | 4126.7 | 1111.7 | 782.4 | 1110.3 | 780.4 |
| `sodaxConfig only` | 2955.6 | 824.9 | 588.3 | 37.9 | 30.0 |

@sodax/types inlined into swaps-api + bridge-api: 238.5 KB min, 73.5 KB gzip, 4.2 KB brotli.

## T2 — Where the bytes go today (`new Sodax()`, minified KB, top 30)
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

## T3 — Consumer profiles (gzip KB, brotli in parentheses)
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

## T4 — Consumer profiles (minified KB)
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

## T5 — Chain provider marginal cost on top of "Swaps, EVM only" (gzip KB, brotli in parentheses)
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

## T6 — Feature provider marginal cost on top of core (L2)
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

## T7 — Chain library surface: today vs alternatives (standalone bundles, KB)
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

## T8 — Packages bundled in more than one version (full bundle, minified KB)
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

## T9 — Token config: per-chain split potential (KB)
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

## T10 — Library levers: saving where the chain / feature is included (L2 cost − L3 cost, KB)
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
