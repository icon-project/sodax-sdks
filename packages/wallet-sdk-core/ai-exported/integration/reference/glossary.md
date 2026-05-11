# Glossary

Terms used across the `wallet-sdk-core` docs.

| Term | Meaning |
|---|---|
| **`BaseWalletProvider`** | Abstract base class every provider extends. Holds `defaults` and exposes `mergePolicy` / `mergeDefaults`. |
| **Browser-extension mode** | Construction mode where the caller supplies pre-built chain clients / wallet kits from a wallet extension (MetaMask, Phantom, Xverse, Hana, Freighter, Leather, …). |
| **`chainType`** | Literal string identifier on each provider class (`'EVM'`, `'SOLANA'`, …). Mirrors `ChainType` in `@sodax/types`. |
| **Discriminant style** | How the union narrows. Either **field presence** (most chains) or an explicit **`type` field** (Bitcoin, Stellar). |
| **`defaults`** | Optional config slice merged into every method call. Shape per chain is `*WalletDefaults`. |
| **EOA** | Externally Owned Account — a wallet derived from a key, as opposed to a contract account. Some chains brand it (`IconEoaAddress`, `InjectiveEoaAddress`). |
| **Field presence** | A discriminated union narrowed by which fields exist (`'privateKey' in config` vs `'walletClient' in config`). |
| **Flat merge** (`mergeDefaults`) | Defaults are a flat object; per-call options shallow-merge over the entire object. |
| **Hub / Spoke** | SODAX architecture term. Sonic is the hub; all other 19 chains are spokes. `wallet-sdk-core` provides spoke-side wallet primitives. |
| **`IXxxWalletProvider`** | Chain-specific interface from `@sodax/types`. The class implements it; the SDK consumes it. |
| **`library-exports`** | `src/types/library-exports.ts` — curated re-exports of upstream chain-SDK types (and 2 runtime enums). |
| **Mnemonics** | BIP-39 phrase. Used as the private-key credential on Sui (no raw-key option) and as one option on Injective via the `secret` wrapper. |
| **Per-method merge** (`mergePolicy`) | Defaults are grouped per method (`defaults.sendTransaction`, …); per-call options shallow-merge over the matching slice. |
| **Private-key mode** | Construction mode where the caller supplies a raw secret (or mnemonic / nested `secret` for some chains). Server / script / CI flows only. |
| **PSBT** | Partially Signed Bitcoin Transaction. Bitcoin `signTransaction` accepts a base64-encoded PSBT. |
| **`secret`** (Injective only) | Nested credential wrapper accepting `{ privateKey }` or `{ mnemonics }` in `SecretInjectiveWalletConfig`. |
| **Shallow merge** | Top-level keys are merged; nested objects are replaced wholesale. See `src/utils/merge.ts`. |
| **Spoke chain key** | Branded string from `@sodax/types` identifying a chain (`ChainKeys.SONIC_MAINNET`, `ChainKeys.BSC_MAINNET`, …). |
| **`type` discriminant** | Explicit uppercase `type: 'PRIVATE_KEY' \| 'BROWSER_EXTENSION'` field. Used by Bitcoin and Stellar only. |
| **`WalletAddressProvider`** | Base interface in `@sodax/types` — exposes `getWalletAddress(): Promise<string>`. Every `IXxxWalletProvider` extends it. |
| **`walletsKit`** | Consumer-supplied adapter in Bitcoin / Stellar browser-extension mode. Conforms to `BitcoinWalletsKit` / `StellarWalletsKit`. |
| **XDR** | Stellar's binary transaction format, encoded as a string. Type alias `XDR` from `@sodax/types`. |
