---
"@sodax/types": minor
---

Enable money market support for Robinhood Chain. `ETH`, `bnUSD`, `SODA`, and `USDG` are added to `moneyMarketSupportedTokens[ChainKeys.ROBINHOOD_MAINNET]`, which was previously empty pending launch. Each token's `vault` already resolves to an existing hub reserve asset (`sodaETH`, `bnUSD`, `sodaSODA`, `sodaUSDC`), so no hub-side reserve changes were needed.
