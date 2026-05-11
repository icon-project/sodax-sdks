# Bitcoin — `BitcoinWalletProvider`

Backed by `bitcoinjs-lib` (PSBT signing), `ecpair`, and `@bitcoinerlab/secp256k1`.

| | |
|---|---|
| Class | `BitcoinWalletProvider` |
| Interface | `IBitcoinWalletProvider` (from `@sodax/types`) |
| Discriminant style | **Explicit uppercase `type`** (`'PRIVATE_KEY' \| 'BROWSER_EXTENSION'`) |
| Underlying SDK | `bitcoinjs-lib`, `ecpair`, `bip322-js` |

---

## Config

```ts
type BitcoinWalletConfig = PrivateKeyBitcoinWalletConfig | BrowserExtensionBitcoinWalletConfig;

type PrivateKeyBitcoinWalletConfig = {
  type: 'PRIVATE_KEY';
  privateKey: Hex;                     // `0x…` from @sodax/types
  network: 'TESTNET' | 'MAINNET';
  addressType?: BtcAddressType;        // P2WPKH / P2TR / P2SH / P2PKH — default chosen by lib
  defaults?: BitcoinWalletDefaults;
};

type BrowserExtensionBitcoinWalletConfig = {
  type: 'BROWSER_EXTENSION';
  walletsKit: BitcoinWalletsKit;       // consumer-provided adapter
  network: 'TESTNET' | 'MAINNET';
  defaults?: BitcoinWalletDefaults;
};

interface BitcoinWalletsKit {
  getAccounts(): Promise<string[]>;
  signPsbt(psbtHex: string): Promise<{ psbtHex: string }>;
  signMessage(message: string): Promise<string>;
  signEcdsaMessage(message: string): Promise<string>;
  signBip322Message(message: string): Promise<string>;
  getPublicKey(): Promise<string>;
  sendBitcoin?(toAddress: string, satoshis: number): Promise<string>;
}
```

| Mode discriminant | How to detect |
|---|---|
| Private-key | `config.type === 'PRIVATE_KEY'` |
| Browser-extension | `config.type === 'BROWSER_EXTENSION'` |

---

## `BitcoinWalletDefaults`

```ts
type BitcoinWalletDefaults = {
  defaultFinalize?: boolean;           // default true — finalise after signing
};
```

Merge strategy: flat (`mergeDefaults`). Per-call `finalize` argument on `signTransaction` overrides the default.

---

## Methods

| Method | Signature | Returns |
|---|---|---|
| `getWalletAddress` | `() => Promise<string>` | BTC address (per address type) |
| `getPublicKey` | `() => Promise<string>` | hex public key |
| `getAddressType` | `(address: string) => Promise<BtcAddressType>` | inferred type |
| `signTransaction` | `(psbtBase64: string, finalize?: boolean) => Promise<string>` | signed PSBT (or finalised tx hex) |
| `signEcdsaMessage` | `(message: string) => Promise<string>` | ECDSA signature |
| `signBip322Message` | `(message: string) => Promise<string>` | BIP-322 signature |
| `getPayment` | `(keyPair, addressType) => bitcoin.Payment` | bitcoinjs `Payment` (PK mode helper) |
| `sendBitcoin` | `(toAddress: string, satoshis: bigint) => Promise<string>` | tx hash — only available in browser-extension mode if `walletsKit.sendBitcoin` is implemented |

---

## Public fields

| Field | Type | Notes |
|---|---|---|
| `chainType` | `'BITCOIN'` (literal) | Discriminant. |

`wallet`, `network` are private. Read the network via the constructor argument.

---

## Gotchas

- **The discriminant is `type`, uppercase.** Bitcoin and Stellar use this style — every other chain uses field presence. Easy to confuse.
- **`addressType` is optional in PK mode.** If you omit it, bitcoinjs picks a default (typically P2WPKH on mainnet). Browser-extension mode infers it from the wallet kit.
- **PSBT inputs are base64-encoded** when passed to `signTransaction`. The browser-extension kit may use hex internally; the provider handles the conversion.
- **`sendBitcoin` is optional on the wallet kit.** Some browser-extension wallets (Xverse / Unisat) implement it; others don't. Guard on its presence.
- **`signEcdsaMessage` vs `signBip322Message`** — choose based on what your verifier expects. BIP-322 is the more modern, structured signature spec; ECDSA is the legacy `signmessage` RPC behavior.

---

## See also

- [`recipes/setup-private-key.md`](../recipes/setup-private-key.md)
- [`recipes/setup-browser-extension.md`](../recipes/setup-browser-extension.md)
- [`recipes/sign-and-broadcast.md`](../recipes/sign-and-broadcast.md)
