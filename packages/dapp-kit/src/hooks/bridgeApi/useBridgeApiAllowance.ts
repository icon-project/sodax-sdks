// useBridgeApiAllowance — QUERY. Calls sodax.api.bridge.checkAllowance(body, apiConfig).
//
// TODO(gh-255): implement. Reference: packages/dapp-kit/src/hooks/swapsApi/useSwapsApiAllowance.ts
// Params: { body: CreateBridgeIntentParamsV2 | undefined; apiConfig?: RequestOverrideConfig }
// queryKey: ['bridgeApi','allowance', body?.srcChainKey, body?.srcToken, body?.amount, body?.srcAddress]
// enabled: !!body. retry: 3. unwrapResult from ../shared/unwrapResult.js. Returns BridgeAllowanceCheckResponseV2 | undefined.

export {};
