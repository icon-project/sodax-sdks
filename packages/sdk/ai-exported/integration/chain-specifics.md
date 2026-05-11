# Chain specifics — Non-EVM quirks

EVM chains (12 of them) work uniformly through `IEvmWalletProvider`. Non-EVM chains have particularities you need to handle. This file documents each chain family's quirks.

## Section index

1. [Stellar trustline](#1-stellar-trustline) — `STELLAR_MAINNET`. Required before receiving any non-XLM asset.
2. [Bitcoin PSBT and Radfi](#2-bitcoin-psbt-and-radfi) — `BITCOIN_MAINNET`. PSBT signing; trading wallet; Radfi auth/session.
3. [Solana PDA derivation](#3-solana-pda-derivation) — `SOLANA_MAINNET`. Deterministic addresses; one-time setup utilities.
4. [ICON Hana wallet](#4-icon-hana-wallet) — `ICON_MAINNET`. Low-level Hana-extension helpers; chain key string vs numeric ID.
5. [NEAR connector discovery](#5-near-connector-discovery) — `NEAR_MAINNET`. Account-id semantics; multiple wallet variants.

---

## 1. Stellar trustline

**Requirement:** before a Stellar account can hold or receive a non-XLM asset, it must establish a trustline to the asset issuer. SODAX's bridge / swap / money-market deliver stablecoin assets to Stellar — the destination Stellar account must have an active trustline for the asset, or the operation fails.

### How v2 handles it

`BridgeService` and other feature services delegate Stellar trustline / allowance handling to the Stellar spoke service internally — there is **no** public `checkStellarTrustline` / `requestStellarTrustline` method on `BridgeService`. When you call `sodax.bridge.approve({ params, raw: false, walletProvider })` with a Stellar `walletProvider`, the spoke service handles the trustline operation for you.

For direct trustline interaction outside the standard `approve` flow, reach for the Stellar spoke service:

```ts
import { ChainKeys, type StellarSpokeService } from '@sodax/sdk';

const stellarSpoke = sodax.spoke.getSpokeService(ChainKeys.STELLAR_MAINNET) as StellarSpokeService;
// Use the spoke service's typed methods for Stellar-specific operations.
```

### When to gate

Before any swap / bridge / money-market operation that **delivers** a non-XLM asset to a Stellar destination, the destination wallet must already trust the asset. Failed trustline checks surface as `VALIDATION_FAILED` errors; use `error.context.reason` to disambiguate. The standard pattern for app code is to call `sodax.bridge.approve(...)` (or the matching feature's approve) on the Stellar wallet first, which establishes the trustline as a side effect.

### Pitfall

Stellar accounts that have never held the asset have **no** trustline — receiving will fail. The error surfaces as `VALIDATION_FAILED` with `context.reason: 'trustlineMissing'` (or similar). Treat the missing-trustline state as a one-time setup step gated by the standard `approve` flow.

---

## 2. Bitcoin PSBT and Radfi

Bitcoin support uses Partially Signed Bitcoin Transactions (PSBT) — a different model than EVM tx signing. The wallet provider (`BTCWalletProvider`) handles PSBT construction and signing internally.

### Address types

```ts
type BtcAddressType = 'P2PKH' | 'P2SH' | 'P2WPKH' | 'P2TR';
```

`BTCWalletProvider` config takes an `addressType`. `'P2WPKH'` (native SegWit) is the modern default; `'P2TR'` (Taproot) is supported but may have lower compatibility with some on-chain logic.

### Radfi (auth + trading wallet)

SODAX uses the Radfi infrastructure for Bitcoin. Each user gets a derived "trading wallet" funded from their main BTC address. Operations consume UTXOs from the trading wallet rather than directly from the user's main address.

The Radfi provider is owned by `BitcoinSpokeService`. Reach it via the spoke router:

```ts
import { ChainKeys, type BitcoinSpokeService } from '@sodax/sdk';

const btcSpoke = sodax.spoke.getSpokeService(ChainKeys.BITCOIN_MAINNET) as BitcoinSpokeService;
const radfi = btcSpoke.radfi;   // RadfiProvider instance
```

Most consumer flows don't need to touch `radfi` directly — `sodax.bridge.bridge(...)`, `sodax.swaps.createIntent(...)`, etc. handle the Radfi auth + trading-wallet routing internally on the Bitcoin path. For explicit lifecycle management:

```ts
// Authenticate against Radfi (the wallet signs an auth message):
await radfi.authenticateWithWallet(/* args per RadfiProvider source */);

// Fetch the trading wallet for an address (creating it if needed):
const tradingWallet = await radfi.getTradingWallet(personalAddress);

// Read the trading wallet's BTC + token balances:
const balance = await radfi.getBalance(tradingWallet.address);

// Check whether a trading wallet exists without provisioning one:
const exists = await radfi.checkIfTradingWalletExists(personalAddress);
```

Other public methods on `RadfiProvider` you may need: `setRadfiAccessToken`, `refreshAccessToken`, `createTradingWallet`, `createWithdrawTransaction`, `requestRadfiSignature`, `getExpiredUtxos`, `buildRenewUtxoTransaction`, `signAndBroadcastRenewUtxo`, `withdrawToUser`, `signAndBroadcastWithdraw`, `getMaxWithdrawable`. Read `RadfiProvider` source for argument shapes — the API surface is broader than typical chain providers.

### Pitfall

`BitcoinSpokeService.radfi` is what feature services use under the hood. Bypassing the feature services and driving Radfi yourself works but is rarely needed — and you have to wire token balances + UTXO state manually. Prefer the standard feature flows unless you specifically need lifecycle control.

---

## 3. Solana PDA derivation

Program Derived Addresses (PDAs) are deterministic Solana addresses derived from a program ID + seeds. SODAX uses PDAs for the user's spoke-side state on Solana.

The SDK derives PDAs internally — consumers don't usually need to do this manually. For advanced use cases (preflight, off-chain state lookups), reach into the Solana spoke service via the router:

```ts
import { ChainKeys, type SolanaSpokeService } from '@sodax/sdk';

const solanaSpoke = sodax.spoke.getSpokeService(ChainKeys.SOLANA_MAINNET) as SolanaSpokeService;
// Use the spoke service's typed methods for any PDA-related read or write.
```

### `SolanaSpokeService` specifics

- Solana txs are different shape from EVM (multiple instructions per tx; signed once globally).
- `TxReturnType<typeof ChainKeys.SOLANA_MAINNET, false>` is the base58-encoded signature string (not `0x…`).
- `SolanaRawTransaction` is the raw-tx return for `raw: true` — base64-encoded message for downstream signing.

### Pitfall

Solana addresses are base58 PublicKey strings, not `0x…` hex. `GetAddressType<typeof ChainKeys.SOLANA_MAINNET>` resolves to a base58-typed string brand; passing a hex address is a TypeScript error.

---

## 4. ICON Hana wallet

ICON uses the Hana browser-extension wallet for dApp signing. The SDK ships low-level helper functions (file: `HanaWalletConnector.ts`) that wrap the Hana extension's JSON-RPC interface; consumers compose them into an `IIconWalletProvider` implementation.

```ts
import { requestAddress, requestSigning, requestJsonRpc } from '@sodax/sdk';

const result = await requestAddress();   // returns Result<IconAddress>
if (result.ok) {
  const address = result.value;          // 'hx…'
}
```

ICON spoke calls require an `IIconWalletProvider`. Implementations either compose the helper functions above into a class your app owns, or use the reference implementation that ships in `@sodax/wallet-sdk-core` (separate package, install separately).

### `ChainKeys.ICON_MAINNET` is a string `'0x1.icon'`

The ICON chain key is the **string** `'0x1.icon'`, not the legacy numeric chain id `0x1`. This trips up code that did `Number(chainId)` to coerce — that returns `NaN` for `'0x1.icon'`.

```ts
ChainKeys.ICON_MAINNET === '0x1.icon';            // true
Number(ChainKeys.ICON_MAINNET);                   // NaN
chainKey === ChainKeys.ICON_MAINNET;              // works
```

### Address types

- `hx…` — externally-owned account (user wallet).
- `cx…` — contract account.

`GetAddressType<typeof ChainKeys.ICON_MAINNET>` accepts both via a string brand.

### Injective (similar pattern)

Injective is a separate chain family but uses a similar wallet-extension model. Wallet helper: `Injective20Token` (in `@sodax/sdk`'s injective utilities). `IInjectiveWalletProvider` implementations can use Keplr, Leap, or other Cosmos-ecosystem wallets.

---

## 5. NEAR connector discovery

NEAR has multiple wallet variants (NEAR Wallet, MyNearWallet, Meteor, Sender, …). NEAR spoke calls require an `INearWalletProvider`. The interface is exported from `@sodax/sdk`; consumers supply an object satisfying it. A reference implementation ships in `@sodax/wallet-sdk-core` (separate package — install separately); browser-side connector discovery for the multiple NEAR wallet variants happens there, not in `@sodax/sdk` itself.

### Account ID semantics

NEAR addresses come in two forms:

- **Named accounts** — `alice.near`, `mybiz.near`. Human-readable.
- **Implicit accounts** — 64-character hex strings.

Both are valid. `GetAddressType<typeof ChainKeys.NEAR_MAINNET>` accepts both via a string type.

### Pitfall

`NearWalletProvider` requires the `accountId` field at construction (alongside `privateKey`). Unlike EVM, NEAR can't derive an account from a key alone — keys are scoped to accounts.

---

## Other non-EVM chains

| Chain | Notes |
|---|---|
| **Sui** (`SUI_MAINNET`) | Address: 32-byte `0x…` (different from EVM addresses despite the prefix). Wallet provider `ISuiWalletProvider` uses `@mysten/sui` under the hood. |
| **Stacks** (`STACKS_MAINNET`) | Address: `SP…` (mainnet) / `ST…` (testnet). Uses `@stacks/transactions` for tx construction. |
| **Injective** (`INJECTIVE_MAINNET`) | Cosmos-ecosystem chain. Address: `inj1…`. Wallet provider uses `@injectivelabs/sdk-ts`. |

Each has its own `I*WalletProvider` interface with chain-specific signing methods. The `chainType` discriminant on every `I*WalletProvider` instance lets you narrow at runtime without `instanceof`.

---

## Cross-references

- `WalletProviderSlot` and chain narrowing: [`architecture.md`](architecture.md) §§ 5, 6.
- Per-chain wallet provider interfaces: [`reference/`](reference/) § 2.
- Cast-at-boundary pattern for chain-narrowed providers: [`recipes/`](recipes/) § 5.
