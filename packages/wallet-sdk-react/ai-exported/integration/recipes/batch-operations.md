# Recipe: Batch Connect / Disconnect

`useBatchConnect` and `useBatchDisconnect` orchestrate multi-chain wallet operations sequentially using **wallet brand identifiers** (e.g. `'hana'`, `'phantom'`) instead of individual connectors. Pass an identifier and the hooks discover every chain that wallet supports across the registry, then connect/disconnect them in order.

Sequential by design — many extensions share popup singletons, so parallel attempts would race a single popup. Errors are collected, not thrown — `run()` always resolves.

**Depends on:** [`setup.md`](./setup.md)

---

## Identifier matching

Both batch hooks (and `useIsWalletInstalled`) take a `connectors: readonly string[]` field. Each entry is a **wallet brand identifier** matched **case-insensitive substring** against `connector.id` and `connector.name`:

| Identifier | Matches connectors |
|------------|--------------------|
| `'hana'` | Hana on EVM (`io.havah.hana`), Hana on ICON (`hana`), Hana on Sui, Hana on Stellar… |
| `'phantom'` | Phantom on Solana (`phantom`), Phantom on EVM (`app.phantom`) |
| `'metamask'` | MetaMask on EVM (`io.metamask`), Injective MetaMask connector |
| `'xverse'` | Xverse on Bitcoin (`xverse`) |

Earlier identifiers in the array are **higher-priority per chain**. The runner uses **fallback-on-failure**:

- If a chain matches `'hana'` but the Hana popup is denied / errors out, the runner tries the next identifier's connector on that same chain (e.g. Phantom).
- If a chain succeeds on the first identifier, later identifiers for that chain are **silently skipped** — only one popup per chain on the happy path.
- A chain ends up in `result.failed` only when **every** matched identifier's connector has failed.

```typescript
// Prefer Hana on every chain it covers; fall back to Phantom either
// because Hana isn't available (e.g. Solana) OR because its popup failed.
const { run } = useBatchConnect({ connectors: ['hana', 'phantom'] });
```

`onProgress` fires per attempt — a chain can emit a `failure` event followed by a `success` event when fallback kicks in. The final outcome lives in `result`.

To target a specific connector (not a brand), bypass this API and use `useXConnectors({ xChainType }).find(c => c.id === '...')` + `useXConnect` directly.

---

## `useBatchConnect`

Connect every chain where one of the supplied identifiers matches an installed connector. Sequential, never throws, dedupes concurrent runs.

```tsx
'use client';

import { useBatchConnect } from '@sodax/wallet-sdk-react';

export function ConnectAllHana() {
  const { run, status, result, reset } = useBatchConnect({
    connectors: ['hana'],
    skipConnected: true, // skip chains already connected at run() time
    onProgress: event => {
      console.log(`[batch] ${event.chainType}: ${event.outcome}`);
    },
  });

  return (
    <div>
      <button onClick={run} disabled={status === 'running'}>
        {status === 'running' ? 'Connecting all Hana chains…' : 'Connect with Hana'}
      </button>
      {status === 'done' && result && (
        <div>
          <p>{result.successful.length} connected</p>
          <p>{result.failed.length} failed</p>
          <p>{result.skipped.length} skipped</p>
          <button onClick={reset}>Reset</button>
        </div>
      )}
    </div>
  );
}
```

### Options

| Field | Type | Effect |
|-------|------|--------|
| `connectors` | `readonly string[]` | Identifiers (required, non-empty) |
| `skipConnected` | `boolean` | Skip chains already holding an account at `run()` time. Default `false` |
| `onProgress` | `(event) => void` | Per-target progress event |

### Result shape

```typescript
type BatchConnectResult = {
  successful: ChainType[];
  failed: Array<{ chainType: ChainType; error: Error }>;
  skipped: ChainType[];
};
```

`run()` returns `Promise<BatchConnectResult>` — never rejects.

---

## `useBatchDisconnect`

Mirror of `useBatchConnect` for disconnect:

```tsx
import { useBatchDisconnect } from '@sodax/wallet-sdk-react';

function DisconnectAll() {
  const { run, status } = useBatchDisconnect();
  // No `connectors` → disconnect every currently-connected chain regardless of wallet

  return (
    <button onClick={run} disabled={status === 'running'}>
      {status === 'running' ? 'Disconnecting…' : 'Disconnect all chains'}
    </button>
  );
}

function DisconnectHanaOnly() {
  const { run } = useBatchDisconnect({ connectors: ['hana'] });
  // Only disconnect chains whose CURRENTLY ACTIVE connector matches 'hana'
  return <button onClick={run}>Disconnect Hana</button>;
}
```

### Scope difference vs `useBatchConnect`

`useBatchConnect.connectors` is **mandatory** — it picks **which connector** to use on each chain.

`useBatchDisconnect.connectors` is **optional** — it filters **which chains** to disconnect by checking the **currently active** connector against the identifiers. Chains where the active connector doesn't match are left untouched.

```typescript
useBatchDisconnect();                                // Disconnect every chain
useBatchDisconnect({ connectors: ['hana'] });        // Disconnect chains where Hana is active
useBatchDisconnect({ connectors: ['hana', 'xverse'] }); // Hana OR Xverse
```

---

## Wallet install detection — `useIsWalletInstalled`

Companion read hook that uses the same identifier matching to detect whether a wallet brand is installed for any (or specific) chain.

```typescript
import { useIsWalletInstalled } from '@sodax/wallet-sdk-react';

// True if any Hana variant is installed across any enabled chain
const isHanaInstalled = useIsWalletInstalled({ connectors: ['hana'] });

// True if any wallet is installed for the given chain
const hasBitcoinWallet = useIsWalletInstalled({ chainType: 'BITCOIN' });

// AND filter — Hana specifically on EVM
const hanaOnEvm = useIsWalletInstalled({ connectors: ['hana'], chainType: 'EVM' });
```

The options union enforces at the type level that **at least one** of `connectors` / `chainType` is present. Use this hook to gate an `useBatchConnect` button:

```tsx
const isInstalled = useIsWalletInstalled({ connectors: ['hana'] });
const { run } = useBatchConnect({ connectors: ['hana'] });

return isInstalled ? (
  <button onClick={run}>Connect Hana</button>
) : (
  <a href="https://hana-wallet.com">Install Hana</a>
);
```

---

## Status lifecycle and concurrency

| `status` | Meaning |
|----------|---------|
| `'idle'` | Initial / after `reset()` |
| `'running'` | A `run()` is in flight |
| `'done'` | The last `run()` settled — `result` is populated |

**Concurrent `run()` calls are deduped** — the second call returns the existing in-flight promise.

**`reset()` does NOT abort an in-flight batch** — there is no cancellation signal. It only clears the observable `status` / `result`. Typical usage: call `reset()` only after `status === 'done'`.

---

## Progress events

```typescript
const { run } = useBatchConnect({
  connectors: ['hana'],
  onProgress: event => {
    switch (event.outcome) {
      case 'success': toast(`✓ Connected ${event.chainType}`); break;
      case 'failure': toast.error(`✗ ${event.chainType}: ${event.error.message}`); break;
      case 'skipped': toast(`⏭ ${event.chainType} already connected`); break;
    }
  },
});
```

`onProgress` is read from a ref each time, so passing an inline arrow function is safe.

---

## When to use the lower-level hooks instead

Reach for `useXConnect` / `useXDisconnect` directly when:

- **You need a specific connector**, not a brand.
- **Order is user-driven**, not registry-driven.
- **You need cancellation** — batch hooks have no cancel signal.
- **You only have one chain to operate on**.

---

## Verification

```bash
# 1. Type check
pnpm checkTs

# 2. Manual — install Hana, click batch connect button, confirm sequential popups across chains
# 3. Manual — confirm result.failed contains chains where Hana isn't available
```
