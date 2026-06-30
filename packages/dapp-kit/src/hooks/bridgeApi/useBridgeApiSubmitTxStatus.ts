// useBridgeApiSubmitTxStatus — QUERY (polling). Calls sodax.api.bridge.getSubmitTxStatus.
//
// TODO(gh-255): implement. Reference: packages/dapp-kit/src/hooks/swapsApi/useSwapsApiSubmitTxStatus.ts
// Params: { txHash: string | undefined; srcChainKey?: string; apiConfig?: RequestOverrideConfig }
// queryKey: ['bridgeApi','submitTx','status', txHash, srcChainKey]
// enabled: !!txHash && txHash.length > 0 && !!srcChainKey
// refetchInterval: q => { const s = q.state.data?.data?.status; return (s === 'executed' || s === 'failed') ? false : 1000; }
// Returns BridgeSubmitTxStatusResponseV2 | undefined. NOTE nested data.data.status shape.
// No isTerminalBridgeStatus module needed (string enum -> inline check).

export {};
