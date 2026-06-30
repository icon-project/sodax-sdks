// BridgeApiService — typed HTTP client for the backend Bridge API.
// Reachable as `sodax.api.bridge.*`. Never throws: every method returns Result<T>.
//
// TODO(gh-255): implement. Reference to mirror VERBATIM (only message strings change):
//   packages/sdk/src/backendApi/SwapsApiService.ts
//
// Shape:
//   type ResultifiedBridgeApiV2 = {
//     [K in keyof IBridgeApiV2]: IBridgeApiV2[K] extends (...args: infer A) => Promise<infer R>
//       ? (...args: [...A, config?: RequestOverrideConfig]) => Promise<Result<R>> : never;
//   };
//   export class BridgeApiService implements ResultifiedBridgeApiV2 {
//     private readonly config: BridgeApiConfig;   // already-resolved flat config
//     private readonly headers: Record<string,string>;
//     private readonly logger: SodaxLogger;
//     constructor(config: BridgeApiConfig, logger = consoleLogger) { ... }   // identical to SwapsApiService
//     // private request<S>(): copy SwapsApiService.request<S> verbatim;
//     //   change message -> `Invalid response shape from bridge API for ${endpoint}`.
//     checkAllowance(body, cfg?)     -> POST /bridge/allowance/check  -> BridgeAllowanceCheckResponseSchema (toJsonBody)
//     approve(body, cfg?)            -> POST /bridge/approve          -> makeBridgeApproveResponseSchema(rawTxSchemaForChainKey(body.srcChainKey))
//     createBridgeIntent(body, cfg?) -> POST /bridge/intents          -> makeCreateBridgeIntentResponseSchema(rawTxSchemaForChainKey(body.srcChainKey))
//     submitTx(body, cfg?)           -> POST /bridge/submit-tx        -> BridgeSubmitTxResponseSchema (toJsonBody)
//     getSubmitTxStatus(query, cfg?) -> GET  /bridge/submit-tx/status?txHash=&srcChainKey= -> BridgeSubmitTxStatusResponseSchema
//     setHeaders(headers): void      // copy verbatim
//     getBaseURL(): string           // copy verbatim
//   }
//
// Wiring TODO (in sibling files):
//   - apiConfig.ts: add resolveBridgeApiConfig(config) (mirror resolveSwapsApiConfig; or return resolveBaseApiConfig if shared host).
//   - BackendApiService.ts: add `public readonly bridge: BridgeApiService`, init in ctor, fan out setHeaders.
//   - backendApi/index.ts: `export * from './BridgeApiService.js';`.
//   `sodax.api.bridge.*` then resolves automatically (sodax.api === sodax.backendApi).

export {};
