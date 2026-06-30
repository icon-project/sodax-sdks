// BridgeCard — merges current BridgeManager + BridgeDialog, API-driven.
//
// TODO(gh-255): implement. Reference: apps/demo/src/components/swaps-api/SwapCard.tsx
//   + current apps/demo/src/components/bridge/{BridgeManager,BridgeDialog}.tsx (for gating parity).
// Flow:
//   allowance via useBridgeApiAllowance; handleApprove -> useBridgeApiApprove -> signAndBroadcastBridgeApiTx -> waitForTxFinality -> refetch.
//   handleBridge -> useBridgeApiCreateBridgeIntent -> { tx, relayData } -> sign+broadcast (Bitcoin via spoke.signAndSubmitRawTransaction)
//     -> useBridgeApiSubmitTx({ request: { txHash, srcChainKey, walletAddress, relayData: relayData.payload }, apiConfig })
//     -> setOrders([...prev, { txHash, srcChainKey, apiBaseURL }]).
// Keep gating: Bitcoin trading addr (loadRadfiSession), parseUnits, EVM useEvmSwitchChain,
//   Stellar trustline, NEAR storage, Bitcoin ready flags + BitcoinSetupPanel.
// Keep UX parity: max-bridgeable + route-availability gate via client-side
//   useGetBridgeableAmount + isBridgeable (NO regression vs BridgeManager).

export {};
