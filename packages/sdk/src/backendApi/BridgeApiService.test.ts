// Tests for BridgeApiService.
//
// TODO(gh-255): implement. Reference to mirror:
//   packages/sdk/src/backendApi/SwapsApiService.test.ts
// Pattern: module-scope `const sodax = new Sodax()` + `vi.stubGlobal('fetch', mockFetch)`.
// Coverage groups:
//   1. endpoint routing — assert exact `${BASE}/bridge/...` URL + verb per method
//      (checkAllowance, approve, createBridgeIntent, submitTx, getSubmitTxStatus).
//   2. happy paths -> { ok: true, value }.
//   3. bigint body serialization (if any POST body carries bigint).
//   4. valibot validation failure -> { ok:false }, code 'EXTERNAL_API_ERROR',
//      context.reason === 'invalid_response_shape'.
//   5. transport error (HTTP/timeout/network) propagation.
//   6. RequestOverrideConfig baseURL/timeout/headers override.
//
// NOTE: vitest requires at least one test per file. This placeholder keeps the
// suite green until the real cases land; replace it.
import { describe, it, expect } from 'vitest';

describe.skip('BridgeApiService (gh-255 scaffold)', () => {
  it('TODO: mirror SwapsApiService.test.ts', () => {
    expect(true).toBe(true);
  });
});
