---
name: add-wallet-provider
description: 'Use when adding a WALLET to the SODAX SDK for a chain that is ALREADY integrated — a new wallet connector (another Bitcoin/Stellar/Icon/Injective/NEAR/Stacks browser wallet, or a hardware wallet) in wallet-sdk-react, or a new signing-config variant on an existing wallet-sdk-core provider. NOT for integrating a brand-new chain (use the add-chain skill). Triggers on "add a wallet", "support <wallet> wallet", "add a connector", "new XConnector", "add Ledger/Phantom/Unisat/Leather", "hardware wallet", "add mnemonic/private-key mode to <chain> provider". The wallet layer is two slices: wallet-sdk-core signer providers and wallet-sdk-react connectors.'
---

# Adding a Wallet to the SODAX SDK

> Verify every class, base, and registry slot against current `src/` before copying — the wallet
> layer refactors. This skill adds a wallet to an **already-integrated chain**. A brand-new chain
> (new `ChainType` + its own SpokeService) is the **add-chain** skill instead.

## First: which case?

| You are adding… | Where | Section |
| --- | --- | --- |
| A new **wallet connector** for an existing chain (another browser wallet, a hardware wallet) | `wallet-sdk-react` only | **Case A** |
| A new **signing-config variant** on an existing core provider (e.g. add a mnemonic mode) | `wallet-sdk-core` only | **Case B** |
| A whole **new chain** (its first provider + connector) | all packages | **STOP → `add-chain`** |

The wallet layer is two independent slices: **wallet-sdk-core** signs/broadcasts (`I<Chain>WalletProvider` over `BaseWalletProvider`); **wallet-sdk-react** connects the browser wallet (`XConnector`) and exposes it to React via `chainRegistry.ts`. Most "add a wallet" tasks are Case A.

## Case A — a new connector for an existing chain (the common path)

`wallet-sdk-react` only. Applies to **non-provider-managed** chains (Bitcoin, Stellar, Icon, Injective, NEAR, Stacks). EVM/Solana/Sui are provider-managed — see the caveat.

1. **Connector class** — `src/xchains/<chain>/<Wallet>XConnector.ts`, extending the chain's connector base (e.g. `BitcoinXConnector`, itself extending `XConnector`). Start from a sibling (`UnisatXConnector` / `XverseXConnector` / `OKXXConnector` for Bitcoin). Implement the base's abstract methods — for Bitcoin: `connect()`, `disconnect()`, `getWalletProvider()`, `recreateWalletProvider(xAccount)` — plus `isInstalled` / `installUrl` overrides. The connector builds the matching `I<Chain>WalletProvider` from `wallet-sdk-core`, forwarding `this.defaults`.
2. **Register** — in `chainRegistry.ts`: import the class and add `new <Wallet>XConnector(defaults)` to that chain's `defaultConnectors(...)` array. Keep the connector `id` and install metadata **stable** — they key persisted connections and the modal.
3. **Runtime-detected wallets** — if the wallet is only discoverable at runtime (browser scan, manifest), surface it via the entry's `discoverConnectors` (like Stellar/NEAR), not `defaultConnectors`.
4. **Tests** — `<Wallet>XConnector.test.ts` covering `connect` / `disconnect` / `isInstalled` / `installUrl`; extend `chainRegistry.test.ts` only if registry behavior changed.

**Provider-managed caveat (EVM / Solana / Sui):** their connectors come from the native SDK (wagmi / wallet-adapter) through the `providers/<chain>/` Hydrator, **not** hand-written `XConnector`s — `defaultConnectors` is ignored for these. To support another EVM wallet, add it through the native connector config (a wagmi connector, or `EVM.walletConnect`), not a new `XConnector`.

## Case B — a new signing variant on an existing core provider

`wallet-sdk-core` only, when the chain already works but you need another credential mode (e.g. add a mnemonic alongside the private key).

1. `src/wallet-providers/<chain>/types.ts` — extend the config discriminated union with the new variant. When the credential is not a plain private key, follow the `SecretInjectiveWalletConfig` nested-credential pattern, not a new `PrivateKey*` literal.
2. `<Chain>WalletProvider.ts` — handle the new config branch in the constructor (`super(walletConfig.defaults)`); keep `getWalletAddress()` and signing methods intact.
3. `<Chain>WalletProvider.test.ts` — add the new constructor-variant case.

See `wallet-sdk-core/AGENTS.md` → "Adding a New Chain Provider" / "Config variants" for the full provider shape.

## Verify
- Case A: `cd packages/wallet-sdk-react && pnpm test && pnpm checkTs`. Case B: `cd packages/wallet-sdk-core && pnpm test && pnpm checkTs`.
- Confirm the connector base's abstract method set in `src/xchains/<chain>/<Chain>XConnector.ts` before implementing — it differs by family.
- `instanceof` must survive barrel/deep imports — import the connector base from the same path the registry uses.

> Worked example: a new Bitcoin connector — [`references/example-bitcoin-connector.md`](references/example-bitcoin-connector.md).
