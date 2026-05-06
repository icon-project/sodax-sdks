# Batch Operations

`useBatchConnect` and `useBatchDisconnect` orchestrate multi-chain wallet operations sequentially using **wallet brand identifiers** (e.g. `'hana'`, `'phantom'`) instead of individual connectors. Pass an identifier and the hooks discover every chain that wallet supports across the registry, then connect/disconnect them in order.

Sequential by design — many extensions share popup singletons, so parallel attempts would race a single popup. Errors are collected, not thrown — `run()` always resolves.

The pure helpers ([`resolveBatchTargets`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/src/hooks/useBatchConnect.ts), [`runBatchConnect`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/src/hooks/useBatchConnect.ts), [`resolveDisconnectTargets`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/src/hooks/useBatchDisconnect.ts), [`runBatchDisconnect`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/src/hooks/useBatchDisconnect.ts)) are exported for testability outside React.

## Table of contents

1. [Identifier matching](#identifier-matching)
2. [`useBatchConnect`](#usebatchconnect)
3. [`useBatchDisconnect`](#usebatchdisconnect)
4. [Progress events](#progress-events)
5. [Status lifecycle and concurrency](#status-lifecycle-and-concurrency)
6. [Wallet install detection — `useIsWalletInstalled`](#wallet-install-detection--useiswalletinstalled)
7. [When to use the lower-level hooks instead](#when-to-use-the-lower-level-hooks-instead)

---

## Identifier matching

Both batch hooks (and `useIsWalletInstalled`) take a `connectors: readonly string[]` field. Each entry is a **wallet brand identifier** matched **case-insensitive substring** against `connector.id` and `connector.name`:

| Identifier | Matches connectors |
|------------|--------------------|
| `'hana'` | Hana on EVM (`io.havah.hana`), Hana on ICON (`hana`), Hana on Sui, Hana on Stellar… |
| `'phantom'` | Phantom on Solana (`phantom`), Phantom on EVM (`app.phantom`) |
| `'metamask'` | MetaMask on EVM (`io.metamask`), Injective MetaMask connector |
| `'xverse'` | Xverse on Bitcoin (`xverse`) |

Earlier identifiers in the array win **per chain**. Use this for fallback chains:

```typescript
// Prefer Hana, fall back to Phantom on chains where Hana isn't available
const { run } = useBatchConnect({ connectors: ['hana', 'phantom'] });
```

The matcher is implemented by [`matchesConnectorIdentifier`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/src/utils/matchConnectorIdentifier.ts) — pure, case-insensitive `includes`.

To target a specific connector (not a brand), bypass this API and use `useXConnectors({ xChainType }).find(c => c.id === '...')` + `useXConnect` directly.

---

## `useBatchConnect`

Connect every chain where one of the supplied identifiers matches an installed connector. Sequential, never throws, dedupes concurrent runs.

```tsx
import { useBatchConnect } from '@sodax/wallet-sdk-react';

function ConnectAllHana() {
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
| `onProgress` | `(event) => void` | Per-target progress event — see [Progress events](#progress-events) |

### Result shape

```typescript
type BatchConnectResult = {
  successful: ChainType[];
  failed: Array<{ chainType: ChainType; error: Error }>;
  skipped: ChainType[];
};
```

`run()` returns `Promise<BatchConnectResult>` — never rejects. The same result is also exposed on the hook's `result` field after the batch settles.

---

## `useBatchDisconnect`

Mirror of `useBatchConnect` for disconnect:

```tsx
import { useBatchDisconnect } from '@sodax/wallet-sdk-react';

function DisconnectAll() {
  const { run, status, result } = useBatchDisconnect();
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

### Options

| Field | Type | Effect |
|-------|------|--------|
| `connectors` | `readonly string[]` (optional) | Filter chains whose **active** connector matches one of these identifiers. Omit to disconnect all currently-connected chains |
| `onProgress` | `(event) => void` | Per-target progress event |

### Scope difference vs `useBatchConnect`

`useBatchConnect.connectors` is **mandatory** — it picks **which connector** to use on each chain.

`useBatchDisconnect.connectors` is **optional** — it filters **which chains** to disconnect by checking the **currently active** connector against the identifiers. Chains where the active connector doesn't match are left untouched.

```typescript
// Disconnect every chain (regardless of which wallet is active)
useBatchDisconnect();

// Disconnect only chains where Hana is active
useBatchDisconnect({ connectors: ['hana'] });

// Disconnect chains where either Hana or Xverse is active
useBatchDisconnect({ connectors: ['hana', 'xverse'] });
```

### Result shape

```typescript
type BatchDisconnectResult = {
  successful: ChainType[];
  failed: Array<{ chainType: ChainType; error: Error }>;
};
```

No `skipped` field — disconnect doesn't have a skip semantic.

---

## Progress events

Both hooks accept `onProgress` for live UI updates without waiting for `run()` to resolve:

```typescript
const { run } = useBatchConnect({
  connectors: ['hana'],
  onProgress: event => {
    switch (event.outcome) {
      case 'success':
        toast(`✓ Connected ${event.chainType}`);
        break;
      case 'failure':
        toast.error(`✗ ${event.chainType}: ${event.error.message}`);
        break;
      case 'skipped':
        toast(`⏭ ${event.chainType} already connected`);
        break;
    }
  },
});
```

| Hook | Event variants |
|------|----------------|
| `useBatchConnect` | `{ outcome: 'success' \| 'failure' \| 'skipped', chainType, error? }` |
| `useBatchDisconnect` | `{ outcome: 'success' \| 'failure', chainType, error? }` |

**`onProgress` is isolated from the batch result** — a throwing callback is caught and logged via `console.error`. The batch continues normally. This is intentional: a render-time crash in toast code shouldn't abort a multi-chain disconnect halfway through.

`onProgress` is read from a ref each time, so passing an inline arrow function is safe — `run` won't be rebuilt every render.

---

## Status lifecycle and concurrency

| `status` | Meaning |
|----------|---------|
| `'idle'` | Initial / after `reset()` |
| `'running'` | A `run()` is in flight |
| `'done'` | The last `run()` settled — `result` is populated |

**Concurrent `run()` calls are deduped** — the second call returns the existing in-flight promise. This protects extensions that share popup singletons:

```typescript
const { run } = useBatchConnect({ connectors: ['hana'] });
// Two calls — only one batch executes; both promises resolve to the same result.
const [a, b] = await Promise.all([run(), run()]);
```

**`reset()` does NOT abort an in-flight batch** — there is no cancellation signal. It only clears the observable `status` / `result`. When the in-flight batch eventually resolves, `status` flips back to `'done'` and `result` re-populates. Typical usage: call `reset()` only after `status === 'done'`.

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

The options union enforces at the type level that **at least one** of `connectors` / `chainType` is present — calling with `{}` returns `false` plus a one-time console warning. An empty `connectors: []` is treated as explicit "match nothing".

Use this hook to gate an `useBatchConnect` button:

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

## When to use the lower-level hooks instead

Reach for `useXConnect` / `useXDisconnect` directly when:

- **You need a specific connector**, not a brand. The identifier matcher is intentionally fuzzy; `useXConnectors` lets you pick by exact `id`.
- **Order is user-driven**, not registry-driven. The batch hooks iterate in the chain registry's order; if the user picked an explicit sequence in your UI, drive `useXConnect` from that sequence yourself.
- **You need cancellation**. Batch hooks have no cancel signal — drive `useXConnect` directly inside an `AbortController`-aware controller if you need to bail out.
- **You only have one chain to operate on**. The batch concurrency guard adds no value for single-chain flows.

---

## Related docs

- [Connect Flow](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/CONNECT_FLOW.md) — `useXConnect` / `useXDisconnect` underlying primitives
- [Wallet Modal](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/WALLET_MODAL.md) — multi-chain modal that internally drives `useBatchConnect` for "connect all" flows
- [Chain Detection](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/CHAIN_DETECTION.md) — `useChainGroups`, `useConnectedChains` for surfacing batch results
- [Connectors](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/CONNECTORS.md) — `IXConnector` shape, exact `id` matching for fine-grained control
