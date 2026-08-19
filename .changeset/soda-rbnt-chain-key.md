---
"@sodax/types": patch
---

Fix `SodaTokens.sodaRBNT.chainKey`, which declared `redbelly` instead of `sonic`. The vault token lives on the Sonic hub (its address only has code on Sonic), and it is listed under Sonic in `supportedTokensByChain`, `swapSupportedTokens` and `moneyMarketSupportedTokens`, so consumers routing on `token.chainKey` — wagmi/RPC chain id, spoke provider selection, hub-asset lookup — were pointed at Redbelly and read zero balances for it.
