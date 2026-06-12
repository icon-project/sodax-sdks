# packages/wallet-sdk-react

React wallet state layer over `wallet-sdk-core`. It provides wallet connection, disconnection, signing, account lookup, wallet-provider hydration, and headless wallet-modal primitives.

Consumer-facing AI material lives in `packages/skills`; keep this file focused on maintaining this package.

## Architecture

- `SodaxWalletProvider` is the root provider. It mounts configured chain adapters and initializes services.
- `useXWalletStore.ts` is the central Zustand store for services, connectors, connections, chain actions, and hydrated wallet providers.
- `chainRegistry.ts` is the dispatch table for chain types. Add new chain-type support there instead of scattering switch statements.
- `src/core/` defines the base abstractions:
  - `XService` manages connectors and balance lookups for one chain family.
  - `XConnector` wraps a wallet integration and exposes `connect()` / `disconnect()`.
- `src/xchains/<chain>/` contains concrete service and connector implementations.
- `src/providers/<chain>/` is only for provider-managed chain families that need React context from a native SDK.

## Provider-Managed Pattern

Provider-managed chains use a Provider/Hydrator/Actions trio.

- Provider wraps the native React provider.
- Hydrator reads native hooks and is the only writer for connection state and wallet providers.
- Actions register `ChainActions` and trigger native connect/disconnect/signing calls. Actions should not write connection state directly.

Non-provider chains register actions and create wallet providers through the chain registry and store helpers.

## Configuration

`SodaxWalletProvider` accepts `SodaxWalletConfig`.

- Top-level keys are `ChainType` slots.
- Omit a slot to disable that chain type.
- Pass `{}` to mount with package defaults.
- Per-chain RPC/defaults live under the slot's `chains` map.
- `ChainMeta` in `src/types/config.ts` is the source of truth for config derivation. Update it when adding a new chain type; avoid manually syncing derived config types.

## WalletConnect And Discovery

- EVM defaults to injected-wallet discovery.
- Providing `EVM.walletConnect` adds a WalletConnect connector through wagmi config.
- WalletConnect filtering belongs in `walletConnect.qrModalOptions`; do not add wallet-specific branching to modal primitives.
- Async connector discovery belongs in `discoverConnectors` on the chain registry entry.

## Hooks And Store Rules

All public hooks read through the Zustand store or registered chain actions. Do not call native chain SDK hooks from generic public hooks.

Important hooks:

- `useXConnect`, `useXDisconnect`, `useXSignMessage`
- `useXAccount`, `useXAccounts`, `useXConnection`
- `useXConnectors`, `useXService`, `useWalletProvider`
- `useEvmSwitchChain`
- wallet-modal hooks such as `useWalletModal`, `useConnectionFlow`, `useBatchConnect`, `useBatchDisconnect`, `useChainGroups`, and `useConnectedChains`

Persisted state is intentionally limited. When changing persistence, preserve existing storage compatibility unless the task explicitly includes a migration.

## Subpath Exports

The barrel export is for hooks, public utilities, interfaces, types, and `SodaxWalletProvider`.

Concrete chain classes stay behind deep imports such as `@sodax/wallet-sdk-react/xchains/bitcoin`. Do not add concrete `xchains/<chain>` class exports to `src/index.ts` unless there is a deliberate public API decision.

## Adding A New Chain Type

1. Create `src/xchains/<chain>/` with service, connector, and an `index.ts` barrel.
2. Extend `XService` and `XConnector`; keep connector IDs and install metadata stable.
3. Add a `chainRegistry` entry with service creation, default connectors, provider-management mode, and optional actions/discovery/provider creation.
4. Add the config source-of-truth entry in `src/types/config.ts`.
5. If the native SDK requires React context, add Provider/Hydrator/Actions under `src/providers/<chain>/` and mount it conditionally in `SodaxWalletProvider.tsx`.
6. Add tests for registry behavior, store updates, and connector/provider creation.
7. Update package exports and consumer-facing skills/docs only when the public API changes.

## Wallet Modal Primitives

These primitives are headless and render-agnostic.

- Keep state discriminated by `state.kind`.
- Keep EVM represented as one logical connection group spanning configured EVM networks.
- Use shared identifier matching through the existing utilities.
- Surface raw `Error` objects; do not introduce a wallet-modal-specific error taxonomy without a broader design decision.

Reference implementation: `apps/wallet-modal-example`.

## Build And Tests

```bash
cd packages/wallet-sdk-react
pnpm test
pnpm build
pnpm checkTs
```

The package builds ESM with declaration output and subpath entries for chain implementations. Preserve `instanceof` behavior across barrel/deep import paths.
