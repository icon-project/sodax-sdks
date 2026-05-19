# ICON — `IconWalletProvider`

Backed by `icon-sdk-js`. Browser-extension mode targets the Hana wallet's `postMessage` JSON-RPC bridge.

| | |
|---|---|
| Class | `IconWalletProvider` |
| Interface | `IIconWalletProvider` (from `@sodax/types`) |
| Discriminant style | **Field presence** (no `type` field) |
| Underlying SDK | `icon-sdk-js` |

---

## Config

```ts
type IconWalletConfig = PrivateKeyIconWalletConfig | BrowserExtensionIconWalletConfig;

type PrivateKeyIconWalletConfig = {
  privateKey: `0x${string}`;
  rpcUrl: `http${string}`;
  defaults?: IconWalletDefaults;
};

type BrowserExtensionIconWalletConfig = {
  walletAddress?: IconEoaAddress;      // `hx…` — optional; resolved at first sign call if omitted
  rpcUrl: `http${string}`;
  defaults?: IconWalletDefaults;
};
```

| Mode discriminant | How to detect |
|---|---|
| Private-key | `'privateKey' in config` |
| Browser-extension | `'walletAddress' in config` OR `!('privateKey' in config)` (defaults to browser-extension when key absent) |

> `rpcUrl` is **required in both modes** — ICON has no public-RPC fallback in the provider.

---

## `IconWalletDefaults`

```ts
type IconWalletDefaults = {
  stepLimit?: number;                  // default 3_000_000
  version?: string;                    // default '0x3'
  timestampProvider?: () => number;    // default Date.now() * 1000 (microseconds)
  jsonRpcId?: number;                  // default 99999 (browser-extension event ID)
};
```

---

## Methods

| Method | Signature | Returns | Default slice merged |
|---|---|---|---|
| `getWalletAddress` | `() => Promise<IconEoaAddress>` | `hx…` address | — |
| `sendTransaction` | `(tx: IcxCallTransaction, options?: IconWalletDefaults) => Promise<Hash>` | tx hash | `defaults` (flat merge via `mergeDefaults`) |
| `waitForTransactionReceipt` | `(txHash: Hash) => Promise<IconTransactionResult>` | tx result | — |

---

## Public fields

| Field | Type | Notes |
|---|---|---|
| `chainType` | `'ICON'` (literal) | Discriminant. |
| `iconService` | `IconService` | Underlying SDK service — exposed for advanced use. |

`wallet` is private.

---

## Gotchas

- **Browser-extension mode talks to Hana via `window.postMessage`.** Events use a request-ID — collisions can occur if you fire many parallel calls; tune `defaults.jsonRpcId` if you control the consumer.
- **`walletAddress` is optional in browser-extension mode.** When omitted, the provider issues a `REQUEST_ADDRESS` event on first use to resolve it. For deterministic behavior in scripts, pass it explicitly.
- **Address type is branded — `IconEoaAddress` (`hx…`) vs `IconAddress` (`hx… | cx…`).** EOA only at the wallet level; contracts (`cx…`) appear inside tx params, not as the signer.
- **Timestamps are microseconds.** `timestampProvider` returns microseconds, not milliseconds — the default is `Date.now() * 1000`.

---

## See also

- [`recipes/setup-private-key.md`](../recipes/setup-private-key.md)
- [`recipes/setup-browser-extension.md`](../recipes/setup-browser-extension.md)
- [`recipes/sign-and-broadcast.md`](../recipes/sign-and-broadcast.md)
