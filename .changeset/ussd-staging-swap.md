---
'@sodax/types': minor
---

List USSD (Sonic) as a staging swap token. The token was already defined in `sonicSupportedTokens` but was not a member of either swap list, so the SDK would not offer it and `ConfigService.isValidOriginalAssetAddress` had nothing to accept. It now appears in `stagingSwapSupportedTokens[SONIC_MAINNET]` alongside sodaSUSDS, which makes it selectable in the staging solver environment while production stays unchanged until the solver fills it.
