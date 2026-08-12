---
'@sodax/types': major
'@sodax/sdk': major
'@sodax/wallet-sdk-core': major
'@sodax/wallet-sdk-react': major
'@sodax/libs': major
'@sodax/swaps-api': major
'@sodax/dapp-kit': major
'@sodax/skills': major
---

Move every Sui code path onto gRPC. Sui disabled JSON-RPC on its public fullnodes in July 2026 and removes it from `sui-node` entirely in October 2026, so the third-party JSON-RPC endpoint the previous release fell back to has no future either. Reads, gas estimation, signing and submission now all speak gRPC-web against Sui Foundation's own fullnodes, which serve it free, without an API key, and with CORS open for browsers. Like any public fullnode it is rate-limited per IP (measured: bursts above roughly 150 concurrent calls, or sustained load past roughly 20-25 req/s, start returning `RESOURCE_EXHAUSTED`; it recovers within seconds). That is fine for a browser session, so it stays the packaged default — but a backend or indexer should point `grpc_url` at its own node or a paid provider. `@mysten/sui` moves to 2.x, `@mysten/wallet-standard` to 0.21, and the JSON-RPC-only `@mysten/dapp-kit` is replaced by `@mysten/dapp-kit-react` — collapsing three duplicate `@mysten/sui` copies into one and removing the version-skew casts that came with them. `@mysten/sui` 2.x is ESM-only and declares Node >= 22, and `require()` of an ES module is only unflagged from Node 22.12 in that line, so every `@sodax/*` package now declares `engines.node >= 22.12.0` — one floor across the workspace rather than a mix. Sui receipt timeouts are also now classified by error name rather than message text, which fixes browser timeouts being reported as failures.

Migration:

- `SuiSpokeChainConfig.rpc_url` is renamed to `grpc_url` (default `https://fullnode.mainnet.sui.io`). `rpc_url` still works as a deprecated alias and wins when set, so existing `new Sodax({ chains: { [ChainKeys.SUI_MAINNET]: { rpc_url } } })` overrides keep working — but the endpoint must speak gRPC-web. A `sui-node` serves gRPC on the same origin it served JSON-RPC on, so self-hosted and full-service endpoints need no change; a JSON-RPC-only provider must be repointed.
- `sodax.spoke.sui.publicClient` is no longer a `@mysten/sui` client. It is now a `SuiTransport` — `getCoins(owner, coinType, limit?)`, `simulate(tx, sender)`, `estimateGas(tx, sender)`, `fetchLatestPackageId(objectId)`, `waitForTransaction({ digest, timeoutMs, pollingIntervalMs })` — and is aliased as `sodax.spoke.sui.transport`. `publicClient` is deprecated and will be removed next major.
- `SuiWalletProvider` takes `grpcUrl`, with `rpcUrl` kept as a deprecated alias. The two are mutually exclusive — the config type rejects both, and the constructor throws if an untyped caller passes both, rather than silently picking one. Browser-extension mode is a hard break: `{ client, wallet, account }` becomes `{ grpcUrl, address, signTransaction }`, where `signTransaction` takes the transaction positionally and returns `{ bytes, signature }`. There is no alias for it; the old shape took a `SuiClient` type that no longer exists. `dAppKit.signTransaction` from `@mysten/dapp-kit-react` is options-shaped, so wrap it rather than assigning it, and name the account — dApp Kit otherwise signs with whichever account is connected, which need not be the `address` you passed:

  ```ts
  signTransaction: async txn => dAppKit.signTransaction({ transaction: await txn.toJSON(), account }),
  ```
- `SuiSignAndExecutePolicy.response` is gone. It only ever tuned a response the provider discarded, and its `SuiTransactionBlockResponseOptions` type is JSON-RPC-specific. `dryRun` is unchanged.
- `@sodax/wallet-sdk-core` no longer re-exports `SuiTransactionBlockResponseOptions`, `SuiWalletFeatures`, `WalletAccount` or `WalletWithFeatures`. Import the wallet-standard types directly if you still need them.
- `SodaxWalletConfig.SUI.chains[…].rpcUrl` is renamed to `grpcUrl`, with `rpcUrl` kept as a deprecated alias. Same rule: one or the other, never both.
- `SodaxWalletConfig.SUI.network` drops `'devnet'`, leaving `'mainnet' | 'testnet'`. No devnet endpoint was ever packaged, so the value threw at render; and there is one Sui chain key, on mainnet, so it only ever pointed the wallet adapter at a network the rest of the SDK has no config for. It is now a compile error rather than a runtime one.
- `SuiCoinStruct.previousTransaction` is optional: Sui's gRPC `Coin` message does not carry it.
- The object-change fields on a receipt's `SuiTransactionEffects` — `created`, `mutated`, `deleted`, `wrapped`, `unwrapped`, `unwrappedThenDeleted`, `sharedObjects`, `modifiedAtVersions` — are always `undefined`. They were already optional, so this is silent rather than a compile error. gRPC replaces the per-bucket arrays with one flat `changedObjects` list carrying `inputState` / `outputState` / `idOperation`, from which the buckets would have to be re-derived rather than read; `status`, `gasUsed`, `gasObject`, `dependencies` and `eventsDigest` are unaffected. Read `waitForTransaction`'s effects for those, and the transaction's object changes from `changedObjects` directly if you need them.
- `SuiXService.createWalletProvider()` (from `@sodax/wallet-sdk-react/xchains/sui`) is removed — it built the deleted `{ client, wallet, account }` config. Read the provider from the store instead: `useWalletProvider({ xChainId: ChainKeys.SUI_MAINNET })`, which `SuiHydrator` populates. Its public `suiClient` field also follows the gRPC client's shape now: `client.core.getBalance(…)` returning `{ balance: { balance } }`, not `client.getBalance(…)` returning `{ totalBalance }`.
- Apps that use `@sodax/wallet-sdk-react` *and* import `@mysten/dapp-kit` directly must migrate to `@mysten/dapp-kit-core` / `@mysten/dapp-kit-react` themselves — the legacy package is JSON-RPC-only and stops working in October 2026.
