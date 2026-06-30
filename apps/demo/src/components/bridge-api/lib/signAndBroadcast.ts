// Per-chain sign & broadcast of a raw Bridge API tx (RawTxReturnType).
//
// TODO(gh-255): implement. Reference: apps/demo/src/components/swaps-api/lib/signAndBroadcast.ts
// Port the dispatcher; rename symbols (signAndBroadcastBridgeApiTx, isSignableBridgeApiChain,
// waitForTxFinality). Keep the per-chain switch identical:
//   EVM/ICON sendTransaction; SUI signAndExecuteTxn; NEAR signAndSubmitTxn;
//   SOLANA/STELLAR/STACKS/INJECTIVE signAndSendTransaction (guarded);
//   BITCOIN -> route via sodax.spoke.getSpokeService(BITCOIN).signAndSubmitRawTransaction (Bound).
// Feature-agnostic over RawTxReturnType + IWalletProvider (same as swaps).

export {};
