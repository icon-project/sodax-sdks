# Reference: Hooks

Full hook surface of `@sodax/wallet-sdk-react` v2. All hooks accept an options object — never positional args. Pair this with [`connectors.md`](./connectors.md) for connector shape and [`chain-support.md`](./chain-support.md) for chain identifiers.

> **All hooks are client-only.** They depend on `<SodaxWalletProvider>` and `<QueryClientProvider>`, which only mount on the client. Next.js App Router consumers must mark every file calling these hooks with `'use client'`. Server Components cannot read connection state directly — pass it down from a client boundary.

---

## Behavior when the chain slot is not in `walletConfig`

Hooks do **not** throw when their chain isn't enabled — each picks its own no-op fallback. UI code can call them unconditionally and branch on the return value.

| Hook | Behavior when chain absent |
|---|---|
| `useXAccount`, `useXAccounts` | Returns shape with `address: undefined` |
| `useXConnection`, `useXConnections` | Returns `undefined` / empty record |
| `useXConnectors` | Returns `[]`. **One-time `console.warn`** per chain type to surface config mistakes. |
| `useXConnectorsByChain` | Returns empty record. No warning. |
| `useWalletProvider` | Returns `undefined` |
| `useXService`, `useXServices` | Returns `undefined` / empty record |
| `useEvmSwitchChain` | Returns `{ isWrongChain: false, handleSwitchChain: () => {} }` (no-op) |
| `useEnabledChains` | Returns the list of slots actually present (does not include the disabled one) |
| `useChainGroups`, `useConnectedChains` | Excludes the chain from output |
| `useXConnect`, `useXDisconnect`, `useXSignMessage` | Mutation rejects when invoked with an unsupported `xChainType` |

Rule of thumb: read-hooks degrade silently to "empty"; mutation-hooks reject. Both cases are safe to call unconditionally.

---

## Connect / disconnect

| Hook | Signature | Returns |
|---|---|---|
| `useXConnect` | `useXConnect(): UseMutationResult<XAccount \| undefined, Error, IXConnector>` | React Query mutation. **Resolves to `undefined` for provider-managed chains** (EVM/Solana/Sui) — read the connected account via `useXAccount` after the mutation lands. |
| `useXDisconnect` | `useXDisconnect(): (args: UseXDisconnectArgs) => Promise<void>` where `UseXDisconnectArgs = { xChainType: ChainType }` | Async function — never throws |
| `useConnectionFlow` | `useConnectionFlow(): { status, error, connect, retry, activeConnector }` | Status object |
| `useBatchConnect` | `useBatchConnect({ connectors, skipConnected?, onProgress? })` | `{ run, status, result, reset }` |
| `useBatchDisconnect` | `useBatchDisconnect({ connectors?, onProgress? })` | `{ run, status, result, reset }` |

```ts
// @ai-snippets-skip
const { mutateAsync: connect } = useXConnect();
await connect(connector);

const disconnect = useXDisconnect();
await disconnect({ xChainType: 'EVM' });
```

---

## Read account / connection state

| Hook | Signature | Returns |
|---|---|---|
| `useXAccount` | `useXAccount({ xChainType }) \| useXAccount({ xChainId })` | `XAccount` (always populated; `address` undefined when disconnected) |
| `useXAccounts` | `useXAccounts()` | `Partial<Record<ChainType, XAccount>>` (only enabled chains; entries are populated, `address` undefined when disconnected) |
| `useXConnection` | `useXConnection({ xChainType })` | `XConnection \| undefined` |
| `useXConnections` | `useXConnections()` | `Partial<Record<ChainType, XConnection>>` |
| `useConnectedChains` | `useConnectedChains({ order? })` | `{ status: 'loading' \| 'ready', chains: ConnectedChain[], total: number }` |

```ts
// @ai-snippets-skip
import { ChainKeys } from '@sodax/types';

const { address } = useXAccount({ xChainType: 'EVM' });
const { address } = useXAccount({ xChainId: ChainKeys.BSC_MAINNET });
```

---

## Connector discovery

| Hook | Signature | Returns |
|---|---|---|
| `useXConnectors` | `useXConnectors({ xChainType })` | `IXConnector[]` (returns `[]` and logs a one-time warning if `xChainType` isn't enabled in `walletConfig`) |
| `useXConnectorsByChain` | `useXConnectorsByChain()` | `Partial<Record<ChainType, IXConnector[]>>` (no per-chain warnings) |
| `useIsWalletInstalled` | `useIsWalletInstalled({ connectors?, chainType? })` | `boolean` (at least one of `connectors`/`chainType` required) |
| `sortConnectors` | `sortConnectors(list, { preferred }): IXConnector[]` | Pure utility — installed first |

```ts
// @ai-snippets-skip
const connectors = useXConnectors({ xChainType: 'EVM' });
const sorted = sortConnectors(connectors, { preferred: ['hana', 'metamask'] });

const isInstalled = useIsWalletInstalled({ connectors: ['hana'] });
```

---

## Wallet provider bridge (for `@sodax/sdk` calls)

| Hook | Signature | Returns |
|---|---|---|
| `useWalletProvider` | `useWalletProvider({ xChainId })` | Chain-narrowed `IXxxWalletProvider \| undefined` |
| `useWalletProvider` | `useWalletProvider({ xChainType })` | Family-level `IXxxWalletProvider \| undefined` |
| `useWalletProvider` | `useWalletProvider()` | `IWalletProvider \| undefined` |

```ts
// @ai-snippets-skip
import { ChainKeys } from '@sodax/types';

const evm = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });
// evm: IEvmWalletProvider | undefined
```

See [`bridge-to-sdk.md`](../recipes/bridge-to-sdk.md) for usage with SDK calls.

---

## Modal / multi-chain UI

| Hook | Signature | Returns |
|---|---|---|
| `useWalletModal` | `useWalletModal({ onConnected? })` | `{ state, open, close, back, selectChain, selectWallet, retry }` |
| `useChainGroups` | `useChainGroups({ order? })` | `ChainGroup[]` (one per enabled chain family) |

State machine kinds: `closed`, `chainSelect`, `walletSelect`, `connecting`, `success`, `error`.

See [`multi-chain-modal.md`](../recipes/multi-chain-modal.md).

---

## Sign message

| Hook | Signature | Returns |
|---|---|---|
| `useXSignMessage` | `useXSignMessage()` | React Query mutation — `{ xChainType, message }` → `` `0x${string}` \| Uint8Array \| string \| undefined `` |

```ts
// @ai-snippets-skip
const sign = useXSignMessage();
const sig = await sign.mutateAsync({ xChainType: 'EVM', message: 'hello' });
```

See [`sign-message.md`](../recipes/sign-message.md) for per-chain matrix.

---

## EVM-specific

| Hook | Signature | Returns |
|---|---|---|
| `useEvmSwitchChain` | `useEvmSwitchChain({ xChainId }: { xChainId: SpokeChainKey })` | `{ isWrongChain: boolean, handleSwitchChain: () => void }`. Compares the connected EVM chain to `xChainId` and exposes wrong-network state. Also handles Injective + MetaMask (auto-switches to Ethereum mainnet). Returns no-op values when `EVM` is not in `walletConfig`. |

```ts
// @ai-snippets-skip
import { ChainKeys } from '@sodax/types';

const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({
  xChainId: ChainKeys.BSC_MAINNET,
});

if (isWrongChain) handleSwitchChain();
```

> **No top-level `useEthereumChainId` in v2.** The raw EVM chain ID is internal — read it via wagmi's `useAccount().chainId` instead. v2 folds the Injective+MetaMask "wrong network" UX into `useEvmSwitchChain` above.

---

## Service-level (advanced)

| Hook | Signature | Returns |
|---|---|---|
| `useXService` | `useXService({ xChainType })` | `IXService \| undefined` |
| `useXServices` | `useXServices()` | `Partial<Record<ChainType, IXService>>` |
| `useEnabledChains` | `useEnabledChains()` | `ChainType[]` |
| `useInitChainServices` | (internal — handled by `SodaxWalletProvider`) | — |

---

## Hook return-shape glossary

```ts
// @ai-snippets-skip
type XAccount = {
  address: string | undefined;
  xChainType: ChainType | undefined;
  publicKey?: string;
};

type XConnection = {
  xAccount: XAccount;
  xConnectorId: string;
};

type IXConnector = {
  readonly xChainType: ChainType;
  readonly name: string;
  readonly id: string;
  readonly icon: string | undefined;
  readonly isInstalled: boolean;
  readonly installUrl: string | undefined;
  connect(): Promise<XAccount | undefined>;
  disconnect(): Promise<void>;
};
```

---

## "Exactly one of" rule for chain identifiers

Hooks that accept both `xChainId` and `xChainType` enforce **exactly one** — passing both, neither, or `undefined` for both throws at runtime (and is a type error):

```ts
// @ai-snippets-skip
useXAccount({ xChainType: 'EVM' });                           // ✅
useXAccount({ xChainId: ChainKeys.BSC_MAINNET });             // ✅
useXAccount({ xChainType: 'EVM', xChainId: ChainKeys.BSC_MAINNET }); // ❌ throws
useXAccount({});                                              // ❌ throws
```

The chain-id form gives narrowest TypeScript inference (e.g. `xChainId: ChainKeys.BSC_MAINNET` → `IEvmWalletProvider`); the chain-type form is family-level.
