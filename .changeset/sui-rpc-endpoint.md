---
'@sodax/types': patch
'@sodax/wallet-sdk-react': patch
---

Point the default Sui JSON-RPC endpoint at a live provider. Mysten's public fullnodes (`fullnode.mainnet.sui.io`, and `getFullnodeUrl()` which resolves to them) stopped serving JSON-RPC in July 2026 and now answer every method with `-32601 Method not found`, so any consumer on the packaged default lost all Sui reads and transaction submission. `SuiSpokeChainConfig.rpc_url` and the `SuiProvider` fallback now default to `https://sui-rpc.publicnode.com` (`https://sui-testnet-rpc.publicnode.com` for testnet), exposed as `SUI_DEFAULT_RPC_URLS`. An explicitly configured `rpcUrl` still wins, and devnet still falls back to `getFullnodeUrl` since no public devnet endpoint serves JSON-RPC either.
