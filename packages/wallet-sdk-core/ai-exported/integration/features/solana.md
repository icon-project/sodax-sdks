# Solana — `SolanaWalletProvider`

Backed by `@solana/web3.js` and `@solana/wallet-adapter-base` interfaces.

| | |
|---|---|
| Class | `SolanaWalletProvider` |
| Interface | `ISolanaWalletProvider` (from `@sodax/types`) |
| Discriminant style | **Field presence** (no `type` field) |
| Underlying SDK | `@solana/web3.js` |

---

## Config

```ts
type SolanaWalletConfig = PrivateKeySolanaWalletConfig | BrowserExtensionSolanaWalletConfig;

type PrivateKeySolanaWalletConfig = {
  privateKey: Uint8Array;              // secret key bytes — usually length 64
  endpoint: string;                    // RPC URL
  defaults?: SolanaWalletDefaults;
};

type BrowserExtensionSolanaWalletConfig = {
  wallet: WalletContextState;          // { publicKey, signTransaction }
  endpoint: string;
  defaults?: SolanaWalletDefaults;
};

interface WalletContextState {
  publicKey: PublicKey | null;
  signTransaction: SignerWalletAdapterProps['signTransaction'] | undefined;
}
```

| Mode discriminant | How to detect |
|---|---|
| Private-key | `'privateKey' in config` |
| Browser-extension | `'wallet' in config` |

---

## `SolanaWalletDefaults`

```ts
type SolanaWalletDefaults = {
  connectionCommitment?: Commitment;      // for Connection ctor — default 'confirmed'
  connectionConfig?: ConnectionConfig;    // overrides connectionCommitment if present
  sendOptions?: SendOptions;              // default for sendRawTransaction
  confirmCommitment?: Commitment;         // for confirmation polling — default 'finalized'
};
```

`connectionConfig` is the full ConnectionConfig — if you set it, `connectionCommitment` is ignored.

---

## Methods

| Method | Signature | Returns |
|---|---|---|
| `getWalletAddress` | `() => Promise<string>` | base58 public key |
| `getWalletBase58PublicKey` | `() => SolanaBase58PublicKey` | synchronous public key |
| `sendTransaction` | `(rawTx: SolanaSerializedTransaction, options?: SendOptions) => Promise<string>` | signature |
| `sendTransactionWithConfirmation` | `(rawTx, sendOptions?, confirmCommitment?) => Promise<string>` | signature, after confirmation |
| `waitForConfirmation` | `(signature, commitment?) => Promise<…>` | confirmation status |
| `buildV0Txn` | `(rawInstructions: SolanaRawTransactionInstruction[]) => Promise<SolanaSerializedTransaction>` | serialised v0 transaction |
| `getAssociatedTokenAddress` | `(mint) => Promise<SolanaBase58PublicKey>` | derived ATA |
| `getBalance` | `(publicKey) => Promise<number>` | lamports |
| `getTokenAccountBalance` | `(publicKey) => Promise<RpcResponseAndContext<TokenAmount>>` | SPL balance |

Default slice merging:
- `defaults.sendOptions` → merged into `sendTransaction(_, options)`.
- `defaults.confirmCommitment` → falls back when `sendTransactionWithConfirmation(_, _, commit)` is undefined.
- `defaults.connectionCommitment` / `defaults.connectionConfig` → used at construction time only.

---

## Public fields

| Field | Type | Notes |
|---|---|---|
| `chainType` | `'SOLANA'` (literal) | Discriminant. |
| `connection` | `Connection` | The web3.js Connection, derived from `endpoint` + defaults. |

`wallet` (Keypair or `WalletContextState`) is private — call provider methods instead.

---

## Gotchas

- **`buildV0Txn` is the canonical path for building transactions.** It picks the keypair-vs-adapter signing path internally based on construction mode. Don't construct transactions yourself.
- **`WalletContextState.signTransaction` is allowed to be `undefined`.** This mirrors `@solana/wallet-adapter-base` — the adapter may not implement signing for all flows. The provider throws at signing time if `signTransaction` is missing.
- **`confirmCommitment` defaults to `'finalized'`.** Slow but safe. Lower (`'confirmed'`) for faster UX, with the usual finality caveats.
- **`endpoint` is a required field.** There is no public-RPC fallback like EVM has.

---

## See also

- [`recipes/setup-private-key.md`](../recipes/setup-private-key.md)
- [`recipes/setup-browser-extension.md`](../recipes/setup-browser-extension.md)
- [`recipes/sign-and-broadcast.md`](../recipes/sign-and-broadcast.md)
