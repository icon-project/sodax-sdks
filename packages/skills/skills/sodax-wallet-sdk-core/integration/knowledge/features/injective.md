# Injective — `InjectiveWalletProvider`

Backed by `@injectivelabs/sdk-ts` (signing / msg construction) and `@injectivelabs/wallet-core` (`MsgBroadcaster` for browser flows).

| | |
|---|---|
| Class | `InjectiveWalletProvider` |
| Interface | `IInjectiveWalletProvider` (from `@sodax/types`) |
| Discriminant style | **Field presence** — but PK variant uses a nested `secret` wrapper |
| Underlying SDK | `@injectivelabs/sdk-ts`, `@injectivelabs/wallet-core`, `@injectivelabs/networks`, `@injectivelabs/ts-types` |

---

## Config

```ts
type InjectiveWalletConfig = BrowserExtensionInjectiveWalletConfig | SecretInjectiveWalletConfig;

type BrowserExtensionInjectiveWalletConfig = {
  msgBroadcaster: MsgBroadcaster;           // pre-configured by consumer
  defaults?: InjectiveWalletDefaults;
};

type SecretInjectiveWalletConfig = {
  secret: { privateKey: string } | { mnemonics: string };
  chainId: ChainId;                          // from @injectivelabs/ts-types
  network: Network;                          // from @injectivelabs/networks
  evmOptions?: { evmChainId: EvmChainId; rpcUrl: `http${string}` };  // reserved — currently unused
  defaults?: InjectiveWalletDefaults;
};
```

| Mode discriminant | How to detect |
|---|---|
| Browser-extension | `'msgBroadcaster' in config` |
| Secret (private-key OR mnemonics) | `'secret' in config` |

> Note the naming: the second variant is `SecretInjectiveWalletConfig` (not `PrivateKey…`) because it accepts **either** a private key **or** a BIP-39 mnemonic at the `secret` slot. The dual credential shape mirrors `PrivateKey.fromPrivateKey` / `PrivateKey.fromMnemonic` in `@injectivelabs/sdk-ts`.

---

## `InjectiveWalletDefaults`

```ts
type InjectiveWalletDefaults = {
  defaultFunds?: InjectiveCoin[];      // attached to getRawTransaction/execute if caller omits
  defaultMemo?: string;                // default tx memo
  sequence?: number;                   // createTransaction override — default 0
  accountNumber?: number;              // createTransaction override — default 0
};
```

> `MsgBroadcaster` options apply at **construction time only** (private-key path). The upstream `MsgBroadcasterWithPk` does not support post-construction reconfig.

---

## Methods

| Method | Signature | Returns |
|---|---|---|
| `getWalletAddress` | `() => Promise<InjectiveEoaAddress>` | `inj1…` address |
| `getWalletPubKey` | `() => Promise<string>` | pubkey string |
| `getRawTransaction` | `(…) => Promise<…>` | unsigned tx — useful for inspection / external signing |
| `execute` | `(…) => Promise<…>` | broadcast result |
| `sendTransaction` | `(signedTxRaw: Uint8Array) => Promise<string>` | tx hash — broadcasts an already-signed proto-encoded Cosmos `TxRaw` |
| `signAndSendTransaction` | `(tx: InjectiveRawTransaction) => Promise<string>` | tx hash — signs + broadcasts an unsigned raw tx (the Swaps-API / SDK-handoff path) |

`getRawTransaction` and `execute` merge `defaults.defaultFunds`, `defaults.defaultMemo`, `defaults.sequence`, `defaults.accountNumber` into the produced tx where the caller omits them.

---

## Public fields

| Field | Type | Notes |
|---|---|---|
| `chainType` | `'INJECTIVE'` (literal) | Discriminant. |
| `wallet` | `InjectiveWallet` | `{ msgBroadcaster: MsgBroadcaster \| MsgBroadcasterWithPk }` — exposed for advanced consumers. |

---

## Gotchas

- **`secret` is mandatory in the PK variant.** A top-level `privateKey` field is **not** accepted — wrap in `{ secret: { privateKey } }`. Same shape in v1 and v2; if you see top-level `privateKey` in user code, it was always wrong.
- **`evmOptions` is reserved.** It is declared in the type but **not currently read** by the provider. It exists to keep the config shape stable while EVM sidecar support on Injective is in development.
- **`chainId` is required by the `SecretInjectiveWalletConfig` type, but only `network` drives endpoint selection.** The constructor reads `config.network` (`getNetworkEndpoints(config.network)`, `MsgBroadcasterWithPk({ network })`) — `config.chainId` is checked by the type guard but never consumed for network/endpoint selection, so a `chainId`/`network` mismatch does not itself produce a runtime RPC failure. Still pass a coherent pair (e.g. `Mainnet` + `injective-1`).
- **`sequence` / `accountNumber` defaults are zero.** Override via `defaults` or per call when the on-chain account state differs (otherwise broadcasting fails with "incorrect account sequence").

---

## See also

- [`recipes/setup-private-key.md`](../recipes/setup-private-key.md)
- [`recipes/setup-browser-extension.md`](../recipes/setup-browser-extension.md)
- [`recipes/sign-and-broadcast.md`](../recipes/sign-and-broadcast.md)
