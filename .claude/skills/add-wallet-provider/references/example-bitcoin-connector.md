# Worked example — a new Bitcoin wallet connector

Adding another Bitcoin browser wallet (call it "Leather") to the already-integrated Bitcoin chain.
This is **Case A** — `wallet-sdk-react` only: no new chain, and no `wallet-sdk-core` change because the
wallet exposes a window API the existing `BitcoinWalletProvider` / `IBitcoinWalletProvider` already
covers. Verify class names and the base's abstract methods against current `src/`.

## 1. Connector class
`src/xchains/bitcoin/LeatherXConnector.ts`, extending `BitcoinXConnector` (which extends `XConnector`
via `super('BITCOIN', name, id)`). Mirror `UnisatXConnector`:
- `connect()` → call the wallet's `window` API and return an `XAccount` `{ address, xChainType: 'BITCOIN' }`.
- `disconnect()`.
- `getWalletProvider()` / `recreateWalletProvider(xAccount)` → return the `IBitcoinWalletProvider` the
  connector wraps (built from `wallet-sdk-core`), forwarding `this.defaults`. `recreateWalletProvider`
  rebuilds it from the window object + stored `xAccount` with no popup (page-reload restore).
- override `isInstalled` (probe `window.<wallet>`) and `installUrl`.

## 2. Register in chainRegistry.ts
Import the class and append it to the Bitcoin entry's `defaultConnectors`:
```ts
import { LeatherXConnector } from './xchains/bitcoin/LeatherXConnector.js';
// …
BITCOIN: defineChain({
  // …
  defaultConnectors: (walletConfig) => {
    const defaults = getEntryDefaults(walletConfig?.BITCOIN?.chains?.[ChainKeys.BITCOIN_MAINNET]);
    return [
      new UnisatXConnector(defaults),
      new XverseXConnector(defaults),
      new OKXXConnector(defaults),
      new LeatherXConnector(defaults),
    ];
  },
  // …
}),
```
Keep the connector `id` stable — it keys persisted connections and the wallet modal.

## 3. Test
`src/xchains/bitcoin/LeatherXConnector.test.ts` — `connect` (mock the window API), `disconnect`,
`isInstalled` true/false on `window.<wallet>` presence, and `installUrl`. Bitcoin message-signing
capability is selected at runtime by the `hasSignBip322` / `hasSignEcdsa` guards in the registry's
`signMessage` action; if the wallet supports only one, the existing guard path handles it.

## Not needed
- **No** `wallet-sdk-core` change — the existing `BitcoinWalletProvider` covers it.
- **No** `chainRegistry` shape change, no `types/config.ts` change (no new chain type).
- **No** new `XService` — `BitcoinXService` is shared across all Bitcoin connectors.
