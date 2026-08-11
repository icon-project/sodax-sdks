# Sui — `SuiWalletProvider`

Backed by `@mysten/sui` and `@mysten/wallet-standard`.

| | |
|---|---|
| Class | `SuiWalletProvider` |
| Interface | `ISuiWalletProvider` (from `@sodax/types`) |
| Discriminant style | **Field presence** (no `type` field) — but uses `mnemonics`, not `privateKey` |
| Underlying SDK | `@mysten/sui` (gRPC transport) |

---

## Config

```ts
type SuiWalletConfig = PrivateKeySuiWalletConfig | BrowserExtensionSuiWalletConfig;

type PrivateKeySuiWalletConfig = {
  grpcUrl?: string;                    // gRPC-web endpoint, e.g. https://fullnode.mainnet.sui.io
  rpcUrl?: string;                     // deprecated alias for grpcUrl; wins when set
  mnemonics: string;                   // BIP-39 mnemonic — NOT a raw private key
  defaults?: SuiWalletDefaults;
};

type BrowserExtensionSuiWalletConfig = {
  grpcUrl: string;
  address: string;                                      // active account address
  signTransaction: (txn: SuiTransaction) => Promise<{ bytes: string; signature: string }>;
  defaults?: SuiWalletDefaults;
};
```

| Mode discriminant | How to detect |
|---|---|
| Private-key | `'mnemonics' in config` |
| Browser-extension | `'signTransaction' in config && 'address' in config` |

Note the name — `PrivateKeySuiWalletConfig` is still called "PrivateKey" for consistency, even though the credential is a mnemonic. The library derives an Ed25519 keypair from the mnemonic phrase.

---

## `SuiWalletDefaults`

```ts
type SuiWalletDefaults = {
  signAndExecuteTxn?: {
    dryRun?: { enabled?: boolean };           // default: enabled = true
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

The internal `client: SuiGrpcClient` and `wallet: SuiWallet` are private.

---

## Gotchas

- **Browser-extension mode takes a signer callback, not a wallet object.** The provider builds its own gRPC client and only asks you to sign — pass `dAppKit.signTransaction` from `@mysten/dapp-kit-react`, or any wallet-standard signer that returns `{ bytes, signature }`.
- **Mnemonic is the only private-key option.** There is no raw-secret-key constructor. If you have a 32-byte key bytes you must convert it to a mnemonic upstream (or fork the provider).
- **Dry-run is on by default for safety.** Production scripts almost never want to disable it.
- **Sui speaks gRPC only.** Mysten removed JSON-RPC from their fullnodes in October 2026, so the endpoint must serve gRPC-web. `https://fullnode.mainnet.sui.io` does, free, without an API key, and with CORS open for browsers. The old `rpcUrl` name still resolves, but one of the two must be set or the constructor throws.

---

## See also

- [`recipes/setup-private-key.md`](../recipes/setup-private-key.md)
- [`recipes/setup-browser-extension.md`](../recipes/setup-browser-extension.md)
- [`recipes/sign-and-broadcast.md`](../recipes/sign-and-broadcast.md)
