---
"@sodax/types": minor
"@sodax/wallet-sdk-core": minor
"@sodax/sdk": minor
"@sodax/skills": patch
---

Add opt-in wrong-chain protection for EVM sends. `IEvmWalletProvider.sendTransaction` accepts a new optional `EvmSendTransactionOptions` argument with `expectedChainId`; `EvmWalletProvider` refuses to send when the wallet's active chain does not match; the SDK's EVM and Sonic spoke services pass the expected chain id on their deposit and send-message paths. Custom `IEvmWalletProvider` implementations should honor the option to keep the protection.
