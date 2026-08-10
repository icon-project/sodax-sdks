---
"@sodax/types": patch
"@sodax/sdk": patch
---

Register the deployed `FlintDepositHook` (`0xDf376dE34e9f1474A025Dfe411b7EB5541793C5d`, Ethereum
mainnet) in the `spokeHooks` registry, activating `HookKind.FLINT_DEPOSIT` end to end: intents whose
delivery names the Flint hook now resolve their `dstAddress` to the live contract instead of
throwing. USDC only, matching the hook's on-chain behaviour.
