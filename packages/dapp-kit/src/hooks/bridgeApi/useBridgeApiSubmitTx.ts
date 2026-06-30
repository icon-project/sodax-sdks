// useBridgeApiSubmitTx — MUTATION (central submit-tx-to-API mechanism).
// Called by the FE AFTER signing+broadcasting the raw tx, to hand it to the relay.
//
// TODO(gh-255): implement. Reference: packages/dapp-kit/src/hooks/swapsApi/useSwapsApiSubmitTx.ts
// export type UseBridgeApiSubmitTxVars = { request: BridgeSubmitTxRequestV2; apiConfig?: RequestOverrideConfig }
// useSafeMutation({ mutationKey: ['bridgeApi','submitTx'], retry: 3, ...mutationOptions,
//   mutationFn: async ({ request, apiConfig }) => unwrapResult(await sodax.api.bridge.submitTx(request, apiConfig)) });
// request shape: { txHash, srcChainKey, walletAddress, relayData } (NO intent).

export {};
