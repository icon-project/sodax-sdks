// bridgeApi/ — React Query hooks over the HTTP Bridge API (`sodax.api.bridge.*`).
// Distinct from the on-chain `bridge/` hooks (which call `sodax.bridge.*` directly).
//
// TODO(gh-255): implement. Reference to mirror:
//   packages/dapp-kit/src/hooks/swapsApi/index.ts  (+ useSwapsApi*.ts)
// Barrel (once hooks exist):
//   export * from './useBridgeApiAllowance.js';        // query
//   export * from './useBridgeApiApprove.js';          // mutation
//   export * from './useBridgeApiCreateBridgeIntent.js'; // mutation
//   export * from './useBridgeApiSubmitTx.js';         // mutation
//   export * from './useBridgeApiSubmitTxStatus.js';   // query (poll)
// Then add `export * from './bridgeApi/index.js';` to ../index.ts and register the
// 3 mutation hooks in ../_mutationContract.test.ts (manual manifest).

export {};
