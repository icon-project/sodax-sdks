# NEAR — `NearWalletProvider`

Backed by `near-api-js` (PK signing) and `@hot-labs/near-connect` (browser-extension `NearConnector`).

| | |
|---|---|
| Class | `NearWalletProvider` |
| Interface | `INearWalletProvider` (from `@sodax/types`) |
| Discriminant style | **Field presence** (no `type` field) |
| Underlying SDK | `near-api-js`, `@hot-labs/near-connect` |

---

## Config

```ts
type NearWalletConfig = PrivateKeyNearWalletConfig | BrowserExtensionNearWalletConfig;

type PrivateKeyNearWalletConfig = {
  rpcUrl: string;
  accountId: string;                   // e.g. 'alice.near'
  privateKey: string;                  // 'ed25519:…' format
  defaults?: NearWalletDefaults;
};

type BrowserExtensionNearWalletConfig = {
  wallet: NearConnector;               // from @hot-labs/near-connect
  defaults?: NearWalletDefaults;
};
```

| Mode discriminant | How to detect |
|---|---|
| Private-key | `'privateKey' in config` (also `accountId`, `rpcUrl`) |
| Browser-extension | `'wallet' in config` |

---

## `NearWalletDefaults`

```ts
type NearWalletDefaults = {
  throwOnFailure?: boolean;            // default true — PK path only
  waitUntil?: NearTxExecutionStatus;   // default 'FINAL'
  gasDefault?: bigint;                 // applied if tx omits gas
  depositDefault?: bigint;             // applied if tx omits deposit
};

type NearTxExecutionStatus =
  | 'NONE' | 'INCLUDED' | 'EXECUTED_OPTIMISTIC' | 'INCLUDED_FINAL' | 'EXECUTED' | 'FINAL';
```

---

## Methods

| Method | Signature | Returns |
|---|---|---|
| `getWalletAddress` | `() => Promise<string>` | accountId (e.g. `alice.near`) |
| `getRawTransaction` | `(params: CallContractParams) => Promise<NearRawTransaction>` | unsigned tx — useful for inspection |
| `signAndSubmitTxn` | `(transaction: NearRawTransaction, options?: NearWalletDefaults) => Promise<string>` | tx hash |

`signAndSubmitTxn` merges `defaults` (flat) over per-call `options`.

---

## Public fields

| Field | Type | Notes |
|---|---|---|
| `chainType` | `'NEAR'` (literal) | Discriminant. |
| `account` | `Account \| undefined` | PK mode only — `near-api-js` `Account`. |
| `rpcProvider` | `JsonRpcProvider \| undefined` | PK mode only. |

`wallet` (`NearConnector`) is private. Browser-extension mode exposes neither `account` nor `rpcProvider`.

---

## Gotchas

- **`privateKey` is the full `ed25519:…` string**, not just the bytes. NEAR stores keys with the algorithm prefix.
- **`accountId` is mandatory in PK mode.** NEAR keys don't determine the account — accounts can hold multiple keys. The provider needs both.
- **`waitUntil` defaults to `'FINAL'`.** Slowest but safest. Lower (`'EXECUTED'`) for faster scripts, with the usual caveats about reverts.
- **Browser-extension mode uses `@hot-labs/near-connect`'s `NearConnector`.** It already abstracts over multiple NEAR wallets (Meteor, MyNearWallet, …) — pass the connector instance, not a lower-level wallet object.

---

## See also

- [`recipes/setup-private-key.md`](../recipes/setup-private-key.md)
- [`recipes/setup-browser-extension.md`](../recipes/setup-browser-extension.md)
- [`recipes/sign-and-broadcast.md`](../recipes/sign-and-broadcast.md)
