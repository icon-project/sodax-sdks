---
"@sodax/types": minor
"@sodax/wallet-sdk-core": minor
"@sodax/sdk": minor
"@sodax/dapp-kit": patch
"@sodax/skills": patch
---

Add opt-in wrong-chain protection for EVM sends. `IEvmWalletProvider.sendTransaction` accepts a new optional `EvmSendTransactionOptions` argument with `expectedChainId`; `EvmWalletProvider` refuses to send when the wallet's active chain does not match; the SDK's EVM and Sonic spoke services pass the expected chain id on their deposit and send-message paths, and signed ERC-20 approvals (including allowance resets) pass it too. Custom `IEvmWalletProvider` implementations should honor the option to keep the protection. A custom provider that already declares its own second options parameter must widen it to `YourOptions & EvmSendTransactionOptions` to keep satisfying the interface. `@sodax/dapp-kit` also chain-binds the backend-built approval broadcasts it sends.
