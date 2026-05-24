# Stacks — `StacksWalletProvider`

Backed by `@stacks/transactions` and `@stacks/connect` (browser-extension `StacksProvider`).

| | |
|---|---|
| Class | `StacksWalletProvider` |
| Interface | `IStacksWalletProvider` (from `@sodax/types`) |
| Discriminant style | **Field presence** (no `type` field) |
| Underlying SDK | `@stacks/transactions`, `@stacks/connect`, `@stacks/network` |

---

## Config

```ts
type StacksWalletConfig = PrivateKeyStacksWalletConfig | BrowserExtensionStacksWalletConfig;

type PrivateKeyStacksWalletConfig = {
  privateKey: string;
  endpoint?: string;                   // Stacks API endpoint
  defaults?: StacksWalletDefaults;
};

type BrowserExtensionStacksWalletConfig = {
  address: string;                     // 'SP…' (mainnet) or 'ST…' (testnet)
  endpoint?: string;
  provider?: StacksProvider;           // from @stacks/connect — optional
  defaults?: StacksWalletDefaults;
};
```

| Mode discriminant | How to detect |
|---|---|
| Private-key | `'privateKey' in config` |
| Browser-extension | `'address' in config` (no `privateKey`) |

---

## `StacksWalletDefaults`

```ts
type StacksWalletDefaults = {
  network?: 'mainnet' | 'testnet';     // default 'mainnet'
  postConditionMode?: PostConditionMode;
};
```

`PostConditionMode` is re-exported as a runtime value from this package — see [`recipes/library-exports.md`](../recipes/library-exports.md).

---

## Methods

| Method | Signature | Returns |
|---|---|---|
| `getWalletAddress` | `() => Promise<string>` | Stacks address (`SP…` / `ST…`) |
| `getPublicKey` | `() => Promise<string>` | hex pubkey |
| `sendTransaction` | `(params: StacksTransactionParams) => Promise<…>` | tx response |
| `readContract` | `(txParams: StacksTransactionParams) => Promise<ClarityValue>` | read-only call result |
| `getBalance` | `(address: string) => Promise<bigint>` | STX micro-balance |

Internally `sendTransaction` dispatches to `sendTransactionWithPrivateKey` or `sendTransactionWithAdapter` based on construction mode.

---

## Public fields

| Field | Type | Notes |
|---|---|---|
| `chainType` | `'STACKS'` (literal) | Discriminant. |

`network` (`StacksNetwork`) and `wallet` are private.

---

## Gotchas

- **`endpoint` is optional.** Defaults to the Hiro mainnet/testnet API URL depending on `network`. Override for private RPCs.
- **`provider` (StacksProvider) is optional in browser-extension mode.** When omitted, the provider falls back to the globally-injected `window`-level provider (Leather, Xverse, Asigna). Pass it explicitly for tests or non-injected environments.
- **`postConditionMode` is a runtime enum.** Import from `@sodax/wallet-sdk-core` (re-exported via `library-exports`) — no need to add `@stacks/transactions` as a direct dep.
- **Mainnet vs testnet split.** `network: 'mainnet'` resolves to `STACKS_MAINNET`; `'testnet'` to `STACKS_TESTNET`. Cross-environment addresses will reject.

---

## See also

- [`recipes/setup-private-key.md`](../recipes/setup-private-key.md)
- [`recipes/setup-browser-extension.md`](../recipes/setup-browser-extension.md)
- [`recipes/sign-and-broadcast.md`](../recipes/sign-and-broadcast.md)
- [`recipes/library-exports.md`](../recipes/library-exports.md) — `PostConditionMode` enum
