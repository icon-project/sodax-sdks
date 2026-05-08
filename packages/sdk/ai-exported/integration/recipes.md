# Recipes — `@sodax/sdk` v2

Copy-pasteable patterns for the most common consumer tasks. Each recipe is self-contained — drop the snippet into your code, swap in your specifics, done.

## Section index

1. [Initialize Sodax](#1-initialize-sodax)
2. [Result handling and error discrimination](#2-result-handling-and-error-discrimination)
3. [Signed-tx flow](#3-signed-tx-flow)
4. [Raw-tx flow](#4-raw-tx-flow)
5. [Chain-key narrowing (cast-at-boundary)](#5-chain-key-narrowing-cast-at-boundary)
6. [Testing (mocks and stubs)](#6-testing-mocks-and-stubs)
7. [Gas estimation](#7-gas-estimation)
8. [Backend-server initialization (private-key)](#8-backend-server-initialization-private-key)

---

## 1. Initialize Sodax

The minimal init — packaged defaults, no config override:

```ts
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax();
await sodax.config.initialize();   // load fresh config from backend; falls back to packaged defaults

// All feature services are wired and ready:
const result = await sodax.config.isSupportedChain(ChainKeys.ARBITRUM_MAINNET);
```

### With config override

```ts
import { Sodax, ChainKeys, type SodaxConfig, type DeepPartial } from '@sodax/sdk';

const config: DeepPartial<SodaxConfig> = {
  rpcConfig: {
    [ChainKeys.SONIC_MAINNET]: process.env.SONIC_RPC_URL,
    [ChainKeys.ARBITRUM_MAINNET]: process.env.ARBITRUM_RPC_URL,
    [ChainKeys.BITCOIN_MAINNET]: {
      mempoolUrl: 'https://mempool.space/api',
      // …BitcoinRpcConfig
    },
  },
  solver: {
    intentsContract: '0x…',
    solverApiEndpoint: 'https://…',
  },
  backendApi: {
    url: 'https://my-sandbox-backend.example.com',
  },
};

const sodax = new Sodax(config);
await sodax.config.initialize();
```

### Lazy initialization

`config.initialize()` is idempotent — calling it twice is a no-op. The first call fetches; subsequent calls return cached data. Treat it as "make sure config is loaded before any feature method".

### Pitfall

`initialize()` is the only initialization step. Don't `await` it inside every feature call — call it once at app startup. If you skip it entirely, feature services fall back to packaged defaults, which may be stale relative to the latest backend config (new tokens, new chains, fee parameter changes).

---

## 2. Result handling and error discrimination

Every async public method on every feature service returns `Promise<Result<T, SodaxError<C>>>`.

### Branching pattern

```ts
import { isSodaxError } from '@sodax/sdk';

const result = await sodax.swaps.createIntent({ params, raw: false, walletProvider });

if (!result.ok) {
  // Always isSodaxError-narrow before reading .feature / .code
  if (isSodaxError(result.error)) {
    if (result.error.code === 'RELAY_TIMEOUT') {
      // retry strategy
    } else if (result.error.feature === 'swap' && result.error.code === 'INTENT_CREATION_FAILED') {
      // input-error UX
    } else if (result.error.code === 'EXTERNAL_API_ERROR' && result.error.context?.api === 'solver') {
      // solver-side problem; surface error.context.solverDetail to the user
    }
  }
  return;
}

const { tx, intent, relayData } = result.value;
```

### Switch-style with narrow code unions

When you know the method, the narrow code union from its declaration enables an exhaustive switch:

```ts
type CreateSupplyIntentErrorCode = 'VALIDATION_FAILED' | 'INTENT_CREATION_FAILED' | 'UNKNOWN';

const result = await sodax.moneyMarket.createSupplyIntent({ params, raw: true });
if (!result.ok) {
  switch (result.error.code as CreateSupplyIntentErrorCode) {
    case 'VALIDATION_FAILED':      return setError('Invalid input');
    case 'INTENT_CREATION_FAILED': return setError('Could not build supply');
    case 'UNKNOWN':                return setError('Unexpected error');
  }
}
```

### Per-feature guard factory

```ts
import { isFeatureError } from '@sodax/sdk';

const isSwapError = isFeatureError('swap');
const isMmError = isFeatureError('moneyMarket');

if (!result.ok) {
  if (isSwapError(result.error)) /* … */;
  else if (isMmError(result.error)) /* … */;
}
```

### Sub-Result propagation

For wrapper methods you write yourself:

```ts
async function myWorkflow(): Promise<Result<MyOutput, SodaxError>> {
  const sub = await sodax.swaps.createIntent({ params, raw: false, walletProvider });
  if (!sub.ok) return sub;   // forward as-is

  const { tx, intent } = sub.value;
  return { ok: true, value: { tx, intent, ts: Date.now() } };
}
```

### Logging

```ts
import { isSodaxError } from '@sodax/sdk';

if (!result.ok) {
  if (isSodaxError(result.error)) {
    Sentry.captureException(result.error, {
      tags: {
        feature: result.error.feature,
        code: result.error.code,
        action: result.error.context?.action ?? null,
        relayCode: result.error.context?.relayCode ?? null,
      },
    });
  } else {
    Sentry.captureException(result.error);
  }
}
```

`SodaxError.toJSON()` is invoked automatically by `JSON.stringify(error)` — Pino, Datadog, and Winston pick it up without configuration.

---

## 3. Signed-tx flow

`raw: false` + a chain-narrowed `walletProvider`. The SDK signs and broadcasts; returns a tx hash (or tx-pair for cross-chain methods).

```ts
const result = await sodax.swaps.createIntent({
  params: {
    srcChainKey: ChainKeys.ARBITRUM_MAINNET,
    dstChainKey: ChainKeys.STELLAR_MAINNET,
    srcAddress: '0x…',
    dstAddress: 'G…',
    inputToken,    // XToken
    outputToken,   // XToken
    inputAmount: 1_000_000n,
    minOutputAmount: 998_000n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
    allowPartialFill: false,
    solver: '0x0000000000000000000000000000000000000000',
    data: '0x',
  },
  raw: false,
  walletProvider: evmWallet,    // IEvmWalletProvider — narrowed by srcChainKey
});

if (!result.ok) return;
const { tx, intent, relayData } = result.value;
// tx: the spoke tx hash (string for EVM, base58 for Solana, …)
```

For cross-chain mutations (`bridge`, `stake`, etc.), the value is `[SpokeTxHash, HubTxHash]`:

```ts
const result = await sodax.bridge.bridge({ params, raw: false, walletProvider });
if (!result.ok) return;
const [spokeHash, hubHash] = result.value;
```

For money-market mutations, the value is an object:

```ts
const result = await sodax.moneyMarket.supply({ params, raw: false, walletProvider });
if (!result.ok) return;
const { srcChainTxHash, dstChainTxHash } = result.value;
```

---

## 4. Raw-tx flow

`raw: true`. The SDK builds the unsigned payload; you sign it elsewhere (gnosis safe, hardware wallet, multi-sig, etc.).

```ts
const result = await sodax.swaps.createIntent({
  params: { /* same as signed flow */ },
  raw: true,
  // walletProvider is FORBIDDEN — TypeScript rejects it.
});

if (!result.ok) return;
const { tx, intent, relayData } = result.value;
// tx is now a chain-specific raw-tx payload:
//   - EVM: EvmRawTransaction { to, data, value, chainId }
//   - Solana: SolanaRawTransaction
//   - Stellar: StellarRawTransaction
//   - …
```

Submit the raw tx via your own signing infrastructure. Once you have the spoke tx hash, you'll typically need to manually call the relay to complete the cross-chain flow:

```ts
import { IntentRelayApiService, type RelayExtraData } from '@sodax/sdk';

// After your custom signer broadcasts and you have the spoke tx hash:
const spokeTxHash = await mySigningInfra.signAndBroadcast(tx);

// IntentRelayApiService isn't on the Sodax instance — instantiate it directly
// with your relayer endpoint (same one you'd pass via SodaxConfig.relayerApiEndpoint).
const relayApi = new IntentRelayApiService(relayerApiEndpoint);

const relayResult = await relayApi.relayTxAndWaitPacket({
  srcChainKey: params.srcChainKey,
  dstChainKey: params.dstChainKey,
  txHash: spokeTxHash,
  payload: relayData.payload,
  timeout: 60_000,
});
```

This pattern is rare. Prefer signed flow unless you have a specific reason to defer signing.

### Type narrowing

```ts
// Discriminate raw return shapes by chain family at runtime:
if (getChainType(srcChainKey) === 'EVM') {
  const evmTx = result.value.tx as EvmRawTransaction;
  // …
}
```

Or use the chain-key generic to narrow at the type level (most useful when `srcChainKey` is a literal):

```ts
const result = await sodax.swaps.createIntent({
  params: { ...params, srcChainKey: ChainKeys.ETHEREUM_MAINNET as const },
  raw: true,
});
// result.value.tx is statically narrowed to EvmRawTransaction
```

---

## 5. Chain-key narrowing (cast-at-boundary)

When you have a runtime chain key (e.g. user-selected from a UI) and need a chain-narrowed wallet provider, narrow once at the boundary and let the narrowed binding flow downstream.

### Narrowing inside a feature flow

```ts
import { ChainKeys, type GetWalletProviderType } from '@sodax/sdk';

function isStellar(chainKey: SpokeChainKey): chainKey is typeof ChainKeys.STELLAR_MAINNET {
  return chainKey === ChainKeys.STELLAR_MAINNET;
}

const stellarWp = isStellar(srcChainKey)
  ? (walletProvider as GetWalletProviderType<typeof ChainKeys.STELLAR_MAINNET> | undefined)
  : undefined;

if (stellarWp) {
  await checkStellarTrustline({ token, amount, walletProvider: stellarWp });
}
```

The cast is local — the `isStellar` guard proves correctness at runtime. **Don't propagate the cast** beyond the narrowed binding; downstream code reads `stellarWp` as the chain-specific type without further casts.

### The `chainType` runtime alternative

Every `I*WalletProvider` has a `readonly chainType: '<CHAIN>'` literal. Use it when you don't have the chain key in scope but do have a wallet provider:

```ts
if (walletProvider.chainType === 'BITCOIN') {
  // walletProvider: IBitcoinWalletProvider
  await checkBitcoinPSBT(walletProvider);
}
```

No `as` cast needed — `chainType` is part of the interface.

### Pitfall

Do **not** chain a cast through every helper. The cast belongs at the chain-key guard. Anywhere downstream of the guard, the binding is already typed correctly:

```ts
// Bad — chained casts:
async function approveSomething(wp: IWalletProvider) {
  await sodax.swaps.approve({
    params,
    walletProvider: wp as GetWalletProviderType<typeof ChainKeys.BITCOIN_MAINNET>,
    raw: false,
  });
}

// Good — one cast at the boundary, narrowed binding flows:
const btcWp = isBitcoin(srcChainKey)
  ? (walletProvider as GetWalletProviderType<typeof ChainKeys.BITCOIN_MAINNET>)
  : null;
if (btcWp) await sodax.swaps.approve({ params, walletProvider: btcWp, raw: false });
```

---

## 6. Testing (mocks and stubs)

### Mock the entire `Sodax` instance

For unit tests where you want to verify your code calls the SDK correctly without hitting network:

```ts
import type { Sodax } from '@sodax/sdk';
import { vi } from 'vitest';

const mockSodax = {
  swaps: {
    createIntent: vi.fn(),
    swap: vi.fn(),
  },
  config: {
    initialize: vi.fn().mockResolvedValue(undefined),
    isSupportedChain: vi.fn().mockReturnValue(true),
  },
} as unknown as Sodax;

mockSodax.swaps.createIntent.mockResolvedValue({
  ok: true,
  value: {
    tx: '0xabc' as `0x${string}`,
    intent: { /* … */ },
    relayData: { payload: '0x…' },
  },
});

// Use mockSodax in your code under test
```

The cast `as unknown as Sodax` is the **only** place where `as unknown as` is acceptable per the project conventions — test mocks intentionally defeat types.

### Stub `IntentRelayApiService` for E2E tests

When you want real spoke txs but stubbed relay coordination, mock at the **feature service** boundary — `IntentRelayApiService` is internal to the SDK and not exposed via the `Sodax` instance.

```ts
import { Sodax } from '@sodax/sdk';
import { vi } from 'vitest';

const sodax = new Sodax({ /* … */ });

// Stub the full feature method (it wraps relay coordination internally):
vi.spyOn(sodax.swaps, 'swap').mockResolvedValue({
  ok: true,
  value: {
    solverExecutionResponse: { /* … */ },
    intent: { /* … */ },
    intentDeliveryInfo: { /* … */ },
  },
});

// Or stub just the relay portion of an end-to-end flow by mocking
// `sodax.swaps.postExecution` after `createIntent` returns.
```

### Result-style assertions

```ts
const result = await sodax.swaps.createIntent({ params, raw: false, walletProvider });
expect(result.ok).toBe(true);
if (result.ok) {
  expect(result.value.tx).toMatch(/^0x[0-9a-f]{64}$/);
}
// or for failures:
expect(result.ok).toBe(false);
if (!result.ok) {
  expect(result.error).toBeInstanceOf(Error);
  expect(result.error.code).toBe('VALIDATION_FAILED');
}
```

### Custom `IConfigApi` for sandbox

```ts
import { Sodax, type IConfigApi } from '@sodax/sdk';

const sandboxApi: IConfigApi = {
  async getChains() { return { ok: true, value: [/* fixture */] }; },
  async getSwapTokens() { return { ok: true, value: { /* … */ } }; },
  async getSwapTokensByChainId(chainKey) { return { ok: true, value: [/* … */] }; },
  async getMoneyMarketTokens() { return { ok: true, value: { /* … */ } }; },
  async getMoneyMarketTokensByChainId(chainKey) { return { ok: true, value: [/* … */] }; },
};

const sodax = new Sodax({
  backendApi: { url: 'unused', api: sandboxApi },
});
await sodax.config.initialize();
```

---

## 7. Gas estimation

Pre-flight gas estimation for raw-tx flows. Most signed flows include gas estimation internally; you only need this when building unsigned payloads.

```ts
const result = await sodax.swaps.estimateGas({
  params: { /* same as createIntent params */ },
});

if (!result.ok) {
  // result.error: SodaxError<'VALIDATION_FAILED' | 'GAS_ESTIMATION_FAILED' | 'UNKNOWN'>
  if (result.error.code === 'GAS_ESTIMATION_FAILED') {
    // Retry — gas estimation failures are usually transient.
  }
  return;
}

const { gasLimit, gasPrice } = result.value;
```

`estimateGas` returns chain-family-specific shapes — EVM gas params, Solana compute units, etc. See per-feature docs in [`features/`](features/) for specifics.

### Distinct from `LOOKUP_FAILED`

The SDK keeps `GAS_ESTIMATION_FAILED` as its own code (rather than folding into `LOOKUP_FAILED`) because retry semantics differ. Re-estimation is cheap and almost always the right move on transient failure. Generic `LOOKUP_FAILED` errors typically need user intervention.

---

## 8. Backend-server initialization (private-key)

Node script / bot / partner backend pattern. No browser extension; the wallet is a private key in environment.

```ts
import { Sodax, ChainKeys } from '@sodax/sdk';
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';

const evmWallet = new EvmWalletProvider({
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
  rpcUrl: process.env.ARBITRUM_RPC_URL!,
});

const sodax = new Sodax({
  rpcConfig: {
    [ChainKeys.ARBITRUM_MAINNET]: process.env.ARBITRUM_RPC_URL!,
    [ChainKeys.SONIC_MAINNET]: process.env.SONIC_RPC_URL!,
    // …
  },
});
await sodax.config.initialize();

// Now use evmWallet wherever the chain key is ARBITRUM_MAINNET:
const result = await sodax.swaps.createIntent({
  params: {
    srcChainKey: ChainKeys.ARBITRUM_MAINNET,
    dstChainKey: ChainKeys.STELLAR_MAINNET,
    srcAddress: await evmWallet.getWalletAddress(),
    /* … */
  },
  raw: false,
  walletProvider: evmWallet,
});
```

### Multi-chain bots

If your bot operates on multiple source chains, construct one wallet provider per chain family and pick the right one at call time:

```ts
const wallets = {
  [ChainKeys.ARBITRUM_MAINNET]: new EvmWalletProvider({ privateKey, rpcUrl: arbRpc }),
  [ChainKeys.SONIC_MAINNET]:    new EvmWalletProvider({ privateKey, rpcUrl: sonicRpc }),
  [ChainKeys.SOLANA_MAINNET]:   new SolanaWalletProvider({ privateKey: solanaPk, rpcUrl: solanaRpc }),
} as const;

function getWallet(chainKey: SpokeChainKey) {
  const wp = wallets[chainKey as keyof typeof wallets];
  if (!wp) throw new Error(`No wallet configured for ${chainKey}`);
  return wp;
}

await sodax.swaps.createIntent({
  params: { srcChainKey: ChainKeys.ARBITRUM_MAINNET, /* … */ },
  raw: false,
  walletProvider: getWallet(ChainKeys.ARBITRUM_MAINNET),
});
```

### Pitfall

Don't construct a fresh `EvmWalletProvider` on every call — instantiate once at startup and reuse. The wallet provider holds an RPC client connection.

---

## Cross-references

- The architectural concepts that motivate these recipes: [`architecture.md`](architecture.md).
- Lookup tables for chain keys, error codes, public API surface: [`reference.md`](reference.md).
- Feature-specific recipes (swap, MM, staking, bridge, dex, migration): [`features/`](features/).
- Non-EVM chain quirks (Stellar trustline, BTC PSBT, Solana PDA, ICON, NEAR): [`chain-specifics.md`](chain-specifics.md).
- v1 → v2 migration: [`../migration/recipes.md`](../migration/recipes.md) for codemods + adapters.
