# Recipe: Testing — mocking providers

Patterns for unit-testing code that consumes `IXxxWalletProvider` interfaces. The same approach scales to integration tests against testnets.

**Depends on:** [`bridge-to-sdk.md`](./bridge-to-sdk.md) — your code should already type its functions against the interface, not the class.

---

## Pattern 1 — Type the function signature on the interface

Make the function under test accept the interface, not the concrete class:

```ts
// ✅ Testable — accept the interface
import type { IEvmWalletProvider } from '@sodax/types';

export async function depositFlow(wallet: IEvmWalletProvider, amount: bigint) {
  const addr = await wallet.getWalletAddress();
  // …
}
```

Mock the interface in the test:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { IEvmWalletProvider } from '@sodax/types';
import { depositFlow } from '../depositFlow';

describe('depositFlow', () => {
  it('uses the address from the provider', async () => {
    const mockProvider: IEvmWalletProvider = {
      chainType: 'EVM',
      getWalletAddress: vi.fn(async () => '0xabc' as const),
      sendTransaction:  vi.fn(async () => '0xdeadbeef'),
      waitForTransactionReceipt: vi.fn(async () => ({ /* … */ } as any)),
      publicClient: undefined as never,                           // not used in this test
    };

    await depositFlow(mockProvider, 100n);
    expect(mockProvider.getWalletAddress).toHaveBeenCalled();
  });
});
```

> Test files are the **only** place where `as any` / `as unknown as` casts are allowed in this project — see `../../CLAUDE.md` § "No `as unknown as` double-casts".

---

## Pattern 2 — Use the real provider against a local key

For end-to-end logic tests, construct a real provider with a deterministic key — no mocking, no network calls:

```ts
import { describe, it } from 'vitest';
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';
import { ChainKeys } from '@sodax/types';

const TEST_PK = '0x' + 'ab'.repeat(32) as `0x${string}`;          // dev-only key

describe('EvmWalletProvider', () => {
  it('derives the address from the private key', async () => {
    const provider = new EvmWalletProvider({
      privateKey: TEST_PK,
      chainId: ChainKeys.SONIC_MAINNET,
    });
    const addr = await provider.getWalletAddress();
    expect(addr).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });
});
```

`getWalletAddress` doesn't hit the network — viem derives the EOA from the key in-process.

---

## Pattern 3 — Stub the upstream chain SDK with `vi.mock`

When you can't avoid testing the bits that **do** hit the network (sending, polling), stub the upstream chain SDK:

```ts
import { vi } from 'vitest';

vi.mock('viem', async (importActual) => {
  const actual = await importActual<typeof import('viem')>();
  return {
    ...actual,
    createWalletClient: vi.fn(() => ({
      sendTransaction: vi.fn(async () => '0xfakehash'),
      account: { address: '0xabc' as const },
      // …
    })),
    createPublicClient: vi.fn(() => ({
      waitForTransactionReceipt: vi.fn(async () => mockReceipt),
    })),
  };
});
```

This isolates the test from the network without rewriting the provider. The downside is that you're now testing your mock; reserve this pattern for cases where pattern 1 isn't enough.

---

## Pattern 4 — Run against a testnet (true integration)

For real end-to-end coverage, use a testnet (Sonic Testnet, Solana Devnet, BTC Testnet, etc.) and a CI-managed key:

```ts
// vitest.config.ts — gate behind an env flag so devs don't accidentally run it
test: {
  exclude: process.env.RUN_E2E ? [] : ['**/*.e2e.test.ts'],
},
```

```ts
// foo.e2e.test.ts
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';
import { ChainKeys } from '@sodax/types';

const PK = process.env.E2E_EVM_PK as `0x${string}`;
const RPC = process.env.E2E_EVM_RPC;

describe.skipIf(!PK)('e2e — EVM testnet', () => {
  it('sends a 0-value tx', async () => {
    const provider = new EvmWalletProvider({ privateKey: PK, chainId: ChainKeys.SONIC_MAINNET, rpcUrl: RPC });
    const hash = await provider.sendTransaction({ to: '0x…', value: 0n, data: '0x' });
    expect(hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
  }, 60_000);
});
```

`apps/node/src/tests/` in this repo follows this pattern — see those test files for live examples.

---

## What NOT to test

| Test idea | Why skip | Alternative |
|---|---|---|
| The merge semantics of `defaults` | Already covered by `src/utils/merge.test.ts` in this package | Trust the merge; test your **policy** values are right |
| viem's `sendTransaction` semantics | Not your code | Mock at pattern 3 if you need to assert your provider passes args through |
| Wallet-extension UI flows in unit tests | Browser-only | Use Playwright / Cypress against a real extension build |

---

## Verification

```bash
pnpm test
pnpm checkTs
```

```bash
# Confirm test files use the interface, not the class, for type annotations
grep -rn "IEvmWalletProvider\|ISolanaWalletProvider\|IBitcoinWalletProvider" <user-src>/**/*.test.ts
```

---

## See also

- `src/utils/merge.test.ts` — reference test style for utility-level tests in this package.
- Every `src/wallet-providers/*/`*`WalletProvider.test.ts` file — provider-level test patterns.
- `../../CLAUDE.md` § "No `as unknown as` double-casts in non-test source files".
