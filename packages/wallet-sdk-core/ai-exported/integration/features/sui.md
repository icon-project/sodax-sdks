# Sui — `SuiWalletProvider`

Backed by `@mysten/sui` and `@mysten/wallet-standard`.

| | |
|---|---|
| Class | `SuiWalletProvider` |
| Interface | `ISuiWalletProvider` (from `@sodax/types`) |
| Discriminant style | **Field presence** (no `type` field) — but uses `mnemonics`, not `privateKey` |
| Underlying SDK | `@mysten/sui`, `@mysten/wallet-standard` |

---

## Config

```ts
type SuiWalletConfig = PrivateKeySuiWalletConfig | BrowserExtensionSuiWalletConfig;

type PrivateKeySuiWalletConfig = {
  rpcUrl: string;
  mnemonics: string;                   // BIP-39 mnemonic — NOT a raw private key
  defaults?: SuiWalletDefaults;
};

type BrowserExtensionSuiWalletConfig = {
  client: SuiClient;                                    // pre-built by consumer
  wallet: WalletWithFeatures<Partial<SuiWalletFeatures>>;
  account: WalletAccount;                               // active account from wallet
  defaults?: SuiWalletDefaults;
};
```

| Mode discriminant | How to detect |
|---|---|
| Private-key | `'mnemonics' in config` |
| Browser-extension | `'client' in config` (also requires `wallet` + `account`) |

Note the name — `PrivateKeySuiWalletConfig` is still called "PrivateKey" for consistency, even though the credential is a mnemonic. The library derives an Ed25519 keypair from the mnemonic phrase.

---

## `SuiWalletDefaults`

```ts
type SuiWalletDefaults = {
  signAndExecuteTxn?: {
    dryRun?: { enabled?: boolean };           // default: enabled = true
    response?: SuiTransactionBlockResponseOptions;
  };
  getCoins?: { limit?: number };
};
```

---

## Methods

| Method | Signature | Returns | Default slice merged |
|---|---|---|---|
| `getWalletAddress` | `() => Promise<string>` | Sui address | — |
| `signAndExecuteTxn` | `(txn: SuiTransaction, options?: SuiSignAndExecutePolicy) => Promise<string>` | digest | `defaults.signAndExecuteTxn` |
| `viewContract` | `(txn: SuiTransaction, …) => Promise<…>` | dry-run result | — |
| `getCoins` | `(address: string, token: string, options?: SuiGetCoinsPolicy) => Promise<SuiPaginatedCoins>` | coin pagination | `defaults.getCoins` |

`signAndExecuteTxn` runs a **pre-flight dry-run by default**. Disable only when paying gas for a doomed tx is acceptable:

```ts
await provider.signAndExecuteTxn(tx, { dryRun: { enabled: false } });
```

---

## Public fields

| Field | Type | Notes |
|---|---|---|
| `chainType` | `'SUI'` (literal) | Discriminant. |

The internal `client: SuiClient` and `wallet: SuiWallet` are private.

---

## Gotchas

- **Browser-extension mode requires THREE objects.** Many wallet adapters expose `client` + `wallet` but not the active `account`. Fetch it via `wallet.accounts[0]` or your adapter's "current account" API before constructing the provider.
- **Mnemonic is the only private-key option.** There is no raw-secret-key constructor. If you have a 32-byte key bytes you must convert it to a mnemonic upstream (or fork the provider).
- **Dry-run is on by default for safety.** Production scripts almost never want to disable it.
- **`response` options forward to the underlying SuiClient call.** In PK mode that's `signAndExecuteTransaction`; in browser-extension mode it's `executeTransactionBlock`. Same option shape (`SuiTransactionBlockResponseOptions`).

---

## See also

- [`recipes/setup-private-key.md`](../recipes/setup-private-key.md)
- [`recipes/setup-browser-extension.md`](../recipes/setup-browser-extension.md)
- [`recipes/sign-and-broadcast.md`](../recipes/sign-and-broadcast.md)
