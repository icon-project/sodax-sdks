# Aleo — `AleoWalletProvider`

Backed by `@provablehq/sdk` (lazy-loaded) and the `@provablehq/aleo-wallet-standard` adapter interface.

| | |
|---|---|
| Class | `AleoWalletProvider` |
| Interface | `IAleoWalletProvider` (from `@sodax/types`) |
| Discriminant style | **Explicit `type` field** (`'privateKey' \| 'browserExtension'`) |
| Underlying SDK | `@provablehq/sdk` + `@provablehq/aleo-wallet-standard` |

---

## Config

```ts
type AleoWalletConfig = PrivateKeyAleoWalletConfig | BrowserExtensionAleoWalletConfig;

type PrivateKeyAleoWalletConfig = {
  type: 'privateKey';
  rpcUrl: string;
  privateKey: string;
  network: AleoNetworkEnv;             // 'mainnet' | 'testnet' — required for PK
  delegate?: DelegateProvingConfig;    // offload proving to a remote service
  defaults?: AleoWalletDefaults;
};

type BrowserExtensionAleoWalletConfig = {
  type: 'browserExtension';
  rpcUrl: string;
  provableAdapter: WalletAdapter;      // from '@provablehq/aleo-wallet-standard'
  network?: AleoNetworkEnv;            // optional — defaults to 'mainnet'
  defaults?: AleoWalletDefaults;
};

/** Delegated proving service — private-key wallets only. */
type DelegateProvingConfig = {
  apiKey: string;
  consumerId: string;
  url?: string;                        // overrides the network-derived default URL
};
```

| Mode discriminant | How to detect |
|---|---|
| Private-key | `config.type === 'privateKey'` |
| Browser-extension | `config.type === 'browserExtension'` |

> **The discriminant values are camelCase** (`'privateKey'` / `'browserExtension'`) — *not* the uppercase `'PRIVATE_KEY'` / `'BROWSER_EXTENSION'` that Bitcoin and Stellar use. Exported predicates `isPrivateKeyConfig` / `isBrowserExtensionConfig` narrow the union.

---

## `AleoWalletDefaults`

```ts
type AleoWalletDefaults = {
  priorityFee?: number;                       // execute() default; falls back to 0 (PK) / 0.001 (browser)
  privateFee?: boolean;                        // private fees on execute() — default false
  delegateUrl?: string;                        // override delegated-proving URL (PK + delegate only)
  waitForReceipt?: AleoWaitForReceiptOptions;  // { checkInterval?, timeout? } polling defaults
};
```

- `priorityFee` and `privateFee` are read flat by `execute()`; `waitForReceipt` is the per-method slice merged into `waitForTransactionReceipt()`.
- `delegateUrl` only applies to a private-key wallet that also has a `delegate` config. If unset, the URL derives from `network`: `https://api.provable.com/prove/<mainnet|testnet>`.

---

## Methods

| Method | Signature | Returns |
|---|---|---|
| `getWalletAddress` | `() => Promise<string>` | `aleo1…` address |
| `execute` | `(options: AleoExecuteOptions) => Promise<AleoExecutionResult>` | `{ transactionId, outputs? }` (fires, does not wait) |
| `waitForTransactionReceipt` | `(transactionId: string, options?: AleoWaitForReceiptOptions) => Promise<AleoTransactionReceipt>` | confirmed receipt |
| `executeAndWait` | `(options: AleoExecuteOptions, receiptOptions?) => Promise<{ result, receipt }>` | execute + wait in one call |

`AleoExecuteOptions` (from `@sodax/types`): `{ programName, functionName, inputs: string[], priorityFee?, privateFee?, feeRecord? }`.

Default slice merging:
- `defaults.priorityFee` / `defaults.privateFee` → fall back when `execute(options)` omits them.
- `defaults.waitForReceipt` → merged into `waitForTransactionReceipt(_, options)` via `mergePolicy`. Defaults: `checkInterval: 2000`, `timeout: 45000`.

---

## Public fields

| Field | Type | Notes |
|---|---|---|
| `chainType` | `'ALEO'` (literal) | Discriminant. |

The SDK clients (`networkClient` / `programManager`) and `wallet` are private and initialised lazily — call provider methods instead.

---

## Gotchas

- **The `@provablehq/sdk` is lazy-loaded on first method call**, not at construction. It ships a ~43 MB WASM module with top-level `await`, which breaks SSR and OOMs Next.js builds if imported eagerly. The provider imports the network-specific build (`@provablehq/sdk/testnet.js` or `mainnet.js`) only when the first `getWalletAddress` / `execute` / `waitForTransactionReceipt` runs. The first call therefore pays the load cost.
- **`network` is required for private-key configs, optional for browser-extension** (defaults to `'mainnet'`). It selects which network-specific WASM build loads.
- **`priorityFee` defaults differ by mode.** Private-key wallets fall back to `0` (base fee only); browser-extension wallets fall back to `0.001` ALEO to ensure acceptance. Set `defaults.priorityFee` or pass `priorityFee` per call to override.
- **Delegated proving is private-key only.** A `delegate: { apiKey, consumerId }` on a PK config routes proving through the remote service; the browser-extension path ignores it (the extension proves locally).
- **`execute` does not wait.** It returns once broadcast; the receipt fields beyond `transactionId` are not yet final. Use `executeAndWait` or follow with `waitForTransactionReceipt` when you need confirmation.
- **Don't mix `type` variants.** It's a discriminated union — narrow with `isPrivateKeyConfig` / `isBrowserExtensionConfig`, don't `as` across variants.

---

## See also

- [`recipes/setup-private-key.md`](../recipes/setup-private-key.md)
- [`recipes/setup-browser-extension.md`](../recipes/setup-browser-extension.md)
- [`recipes/sign-and-broadcast.md`](../recipes/sign-and-broadcast.md)
