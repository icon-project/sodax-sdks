# Stellar — `StellarWalletProvider`

Backed by `@stellar/stellar-sdk` (`Horizon.Server` + Soroban primitives).

| | |
|---|---|
| Class | `StellarWalletProvider` |
| Interface | `IStellarWalletProvider` (from `@sodax/types`) |
| Discriminant style | **Explicit uppercase `type`** (`'PRIVATE_KEY' \| 'BROWSER_EXTENSION'`) |
| Underlying SDK | `@stellar/stellar-sdk` |

---

## Config

```ts
type StellarWalletConfig = PrivateKeyStellarWalletConfig | BrowserExtensionStellarWalletConfig;

type PrivateKeyStellarWalletConfig = {
  type: 'PRIVATE_KEY';
  privateKey: Hex;                     // `0x…`
  network: 'TESTNET' | 'PUBLIC';
  rpcUrl?: string;                     // defaults to a public Horizon URL per network
  defaults?: StellarWalletDefaults;
};

type BrowserExtensionStellarWalletConfig = {
  type: 'BROWSER_EXTENSION';
  walletsKit: StellarWalletsKit;       // Freighter / xBull / Lobstr adapter
  network: 'TESTNET' | 'PUBLIC';
  rpcUrl?: string;
  defaults?: StellarWalletDefaults;
};

interface StellarWalletsKit {
  getAddress(): Promise<{ address: string }>;
  signTransaction(tx: XDR, options: { networkPassphrase: string }): Promise<{ signedTxXdr: XDR }>;
}
```

| Mode discriminant | How to detect |
|---|---|
| Private-key | `config.type === 'PRIVATE_KEY'` |
| Browser-extension | `config.type === 'BROWSER_EXTENSION'` |

---

## `StellarWalletDefaults`

```ts
type StellarWalletDefaults = {
  pollInterval?: number;               // ms — default 2_000
  pollTimeout?: number;                // ms — default 60_000 (≥ 30_000 recommended on mainnet)
  networkPassphrase?: string;          // override for FUTURENET / private networks
};
```

Merge strategy: flat (`mergeDefaults`).

---

## Methods

| Method | Signature | Returns |
|---|---|---|
| `getWalletAddress` | `() => Promise<string>` | Stellar address |
| `signTransaction` | `(tx: XDR) => Promise<XDR>` | signed XDR |
| `waitForTransactionReceipt` | `(hash: string, options?: Partial<StellarWalletDefaults>) => Promise<…>` | tx result; respects `pollInterval` / `pollTimeout` |

---

## Public fields

| Field | Type | Notes |
|---|---|---|
| `chainType` | `'STELLAR'` (literal) | Discriminant. |

`wallet`, `server` (`Horizon.Server`), and `networkPassphrase` are private. Pass overrides via `defaults` instead of mutating fields.

---

## Gotchas

- **`networkPassphrase` is derived from `network`.** Override via `defaults.networkPassphrase` only for FUTURENET or private networks.
- **`rpcUrl` defaults to a public Horizon endpoint.** Replace with a private RPC for production.
- **`pollTimeout` floor of 30_000 ms is a strong recommendation, not enforced.** Mainnet confirmation typically takes 5–30 s. Setting it too low surfaces false negatives.
- **Stellar uses XDR strings** for both transaction input and signed output — the type alias `XDR` is from `@sodax/types`.

---

## See also

- [`recipes/setup-private-key.md`](../recipes/setup-private-key.md)
- [`recipes/setup-browser-extension.md`](../recipes/setup-browser-extension.md)
- [`recipes/sign-and-broadcast.md`](../recipes/sign-and-broadcast.md)
