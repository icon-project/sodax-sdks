---
'@sodax/types': patch
'@sodax/wallet-sdk-react': patch
---

Replace the default NEAR RPC URL (`https://1rpc.io/near`), which does not support the JSON-RPC
`query` method that `near-api-js`'s `JsonRpcProvider` uses for account/contract view calls
(`ft_balance_of`, `get_balance`, `storage_balance_of`, …). Any NEAR balance read against the
packaged default silently returned nothing. The new default, `https://free.rpc.fastnear.com`, was
already used as the RPC override in `apps/demo`. Consumers who already pass a custom `rpcUrl` (via
`SodaxOptions.chains[NEAR_MAINNET].rpcUrl` in `@sodax/sdk` or
`SodaxWalletConfig.NEAR.chains[NEAR_MAINNET].rpcUrl` in `@sodax/wallet-sdk-react`) are unaffected.
