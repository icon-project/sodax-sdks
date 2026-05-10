# Testing (mocks and stubs)

### Mock the entire `Sodax` instance

For unit tests where you want to verify your code calls the SDK correctly without hitting network:

```ts
import type { Sodax } from '@sodax/sdk';
import { vi } from 'vitest';

const mockSodax = {
  swaps: {
    createIntent: vi.fn(),
    swap: vi.fn(),
  },
  config: {
    initialize: vi.fn().mockResolvedValue(undefined),
    isValidSpokeChainKey: vi.fn().mockReturnValue(true),
  },
} as unknown as Sodax;

mockSodax.swaps.createIntent.mockResolvedValue({
  ok: true,
  value: {
    tx: '0xabc' as `0x${string}`,
    intent: { /* … */ },
    relayData: { payload: '0x…' },
  },
});

// Use mockSodax in your code under test
```

The cast `as unknown as Sodax` is the **only** place where `as unknown as` is acceptable per the project conventions — test mocks intentionally defeat types.

### Stub the relay layer for E2E tests

When you want real spoke txs but stubbed relay coordination, mock at the **feature service** boundary — `relayTxAndWaitPacket` is consumed by feature-service implementations internally, and is not exposed on the `Sodax` instance.

```ts
import { Sodax } from '@sodax/sdk';
import { vi } from 'vitest';

const sodax = new Sodax({ /* … */ });

// Stub the full feature method (it wraps relay coordination internally):
vi.spyOn(sodax.swaps, 'swap').mockResolvedValue({
  ok: true,
  value: {
    solverExecutionResponse: { /* … */ },
    intent: { /* … */ },
    intentDeliveryInfo: { /* … */ },
  },
});

// Or stub just the relay portion of an end-to-end flow by mocking
// `sodax.swaps.postExecution` after `createIntent` returns.
```

### Result-style assertions

```ts
const result = await sodax.swaps.createIntent({ params, raw: false, walletProvider });
expect(result.ok).toBe(true);
if (result.ok) {
  expect(result.value.tx).toMatch(/^0x[0-9a-f]{64}$/);
}
// or for failures:
expect(result.ok).toBe(false);
if (!result.ok) {
  expect(result.error).toBeInstanceOf(Error);
  expect(result.error.code).toBe('VALIDATION_FAILED');
}
```

### Custom `IConfigApi` for sandbox

```ts
import { Sodax, type IConfigApi } from '@sodax/sdk';

const sandboxApi: IConfigApi = {
  async getChains() { return { ok: true, value: [/* fixture */] }; },
  async getSwapTokens() { return { ok: true, value: { /* … */ } }; },
  async getSwapTokensByChainId(chainKey) { return { ok: true, value: [/* … */] }; },
  async getMoneyMarketTokens() { return { ok: true, value: { /* … */ } }; },
  async getMoneyMarketTokensByChainId(chainKey) { return { ok: true, value: [/* … */] }; },
};

const sodax = new Sodax({
  backendApi: { url: 'unused', api: sandboxApi },
});
await sodax.config.initialize();
```

---

## Cross-references

- [`README.md`](README.md) — recipe index.
- [`../architecture.md`](../architecture.md) — concepts behind these patterns.
- [`../reference/`](../reference/) — chain keys, error codes, public API surface.
