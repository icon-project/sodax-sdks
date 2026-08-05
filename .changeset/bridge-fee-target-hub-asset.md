---
'@sodax/sdk': patch
---

Fix the bridge partner-fee transfer target on the no-deposit path. `buildBridgeData` initialised the hub-side fee asset from the caller-supplied spoke token address, which is only correct when the source token needs a vault deposit (or the source is the hub itself). For source tokens whose hub asset already is a vault asset, a fee-bearing bridge either encoded the fee transfer against an address with no code on Sonic (EVM spoke sources) or failed intent creation outright with `Address … is invalid` (non-EVM sources such as Solana). The fee is now always transferred in the asset the hub wallet actually holds: the hub asset on the no-deposit path, the vault after a deposit. Payloads without a partner fee, and all deposit-path payloads, are byte-identical to before; fee-bearing bridges of vault-asset tokens from non-EVM sources now build instead of erroring.
