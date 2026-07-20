# Gasless — `@sodax/dapp-kit`

Gasless (EIP-7702 + ERC-4337, Pimlico-sponsored) ERC20 spoke deposits. Batches `approve` +
`assetManager.transfer` into one atomic, paymaster-sponsored operation so a user with zero native
balance can deposit. v2-only — no v1 equivalent.

**Depositors are EOA wallets only.** EIP-7702 delegates the EOA to a smart-account implementation
only for the batch (its address stays the EOA); deployed smart-contract accounts (Safe / native
ERC-4337) are not supported as depositors.

## When to use

The wrapped feature is a **spoke deposit** — the same on-chain action that powers `swap` / `bridge` /
money-market `supply`. It's a feature-agnostic primitive: you supply the hub recipient (`to`) and hub
payload (`data`), typically built from a raw feature intent (e.g.
`sodax.swaps.createIntent({ raw: true })` for a cross-chain swap, or
`sodax.bridge.createBridgeIntent({ raw: true })` for a same-asset bridge).

Two flows:

- **Stateless prepare → submit** (EIP-7702 + ERC-4337, external signer). `useGaslessPrepare` builds
  the sponsored UserOperation and returns the artifacts the EOA must sign (UserOp hash + an EIP-7702
  authorization tuple when delegation is needed). The EOA signs **off-hook** (a key-holder, or the
  backend); `useGaslessSubmit` attaches the signature(s) and broadcasts. The SDK never holds a key.
  Drive either the in-process brain (`source: 'brain'`, needs a Pimlico key on the SDK) or the
  backend HTTP client (`source: 'api'`, no key) — same shapes.
- **Mode A** — external EIP-5792 wallet (MetaMask/Rabby/Coinbase). `useGaslessSendCalls` executes the
  atomic batch via `wallet_sendCalls` with an ERC-7677 paymaster. For browsers that can't sign a raw
  UserOp hash.

Both are **execution-only** — they return an on-chain tx hash; complete the hub delivery with
`useGaslessRelay`.

## Gasless swaps without manual orchestration

For **swaps specifically**, you don't have to wire the three calls above by hand. Set
`swapsOptions: { gasless: true }` on `new Sodax(...)` / `SodaxProvider` (alongside the `gasless`
option below), and a normal `sodax.swaps.swap({ params, walletProvider })` — including dapp-kit's
`useSwap`, **unchanged** — runs gasless (Mode A) when eligible, and the normal swap otherwise.

Eligible = the connected wallet is EIP-5792-capable, the source is an EVM spoke, the input token is an
ERC20, and the chain is gasless-configured. When not eligible, `swap()` transparently runs the normal
client-side flow. Once the gasless path has committed (the sponsored deposit is broadcast) it does
**not** fall back — a second broadcast would double-deposit; retry the relay out-of-band instead.

```ts
// @ai-snippets-skip
new Sodax({
  swapsOptions: { gasless: true }, // opt-in Mode-A gasless swaps
  gasless: { pimlicoApiKey: '<PIMLICO_KEY>', chains: { '0x2105.base': { supports7702: true } } },
});
// then `sodax.swaps.swap({ params, walletProvider })` — or `useSwap(...)` — is gasless when eligible
```

## Configuration

Gasless is off unless configured on `new Sodax(...)` / `SodaxProvider` via the `gasless` option
(client-side, never fetched from the backend). Only needed for `source: 'brain'` / Mode A; the backend
holds the key for `source: 'api'`. To keep the Pimlico key server-side while still running Mode A, set
`paymasterProxyUrl` (your ERC-7677 backend proxy) instead of `pimlicoApiKey`.

```ts
// @ai-snippets-skip
// SodaxOptions.gasless — direct (URLs synthesized in the browser from the key):
{
  pimlicoApiKey: '<PIMLICO_KEY>',            // synthesizes per-chain paymaster + bundler URLs
  chains: {
    '0x2105.base': { supports7702: true },   // or per-chain { paymasterUrl, bundlerUrl, sponsorshipPolicyId }
  },
}
// …or proxy (Mode A, key stays on your backend): drop pimlicoApiKey and set
//   paymasterProxyUrl: 'https://gasless.my-backend.com'  // wallet → <url>/<chainId> → your proxy → Pimlico
```

## Hook surface

```ts
// @ai-snippets-skip
// Queries
useGaslessCapabilities({ params: { srcChainKey, srcAddress, source? }, queryOptions }); // ['gasless', 'capabilities', ...]
useGaslessWalletCapabilities({ params: { chainKey, walletProvider }, queryOptions });    // ['gasless', 'walletCapabilities', chainKey]

// Mutations
useGaslessPrepare({ mutationOptions });    // mutationKey ['gasless', 'prepare']
useGaslessSubmit({ mutationOptions });     // mutationKey ['gasless', 'submit']
useGaslessSendCalls({ mutationOptions });  // mutationKey ['gasless', 'sendCalls']  (Mode A)
useGaslessRelay({ mutationOptions });      // mutationKey ['gasless', 'relay']
```

## prepare → sign → submit

```ts
// @ai-snippets-skip
// 1) prepare — build the sponsored op + get the sign-requests (JSON-safe, string amounts)
const { mutateAsyncSafe: prepare } = useGaslessPrepare();
const prep = await prepare({ srcChainKey, srcAddress, token, amount: rawAmount.toString(), to, data /*, source: 'api'*/ });
if (!prep.ok) return;
const { userOpHash, authorization } = prep.value;   // GaslessPrepareResponse

// 2) sign OFF-HOOK with the EOA (key-holder / backend). e.g. a viem account:
//    const userOp = await account.sign({ hash: userOpHash });
//    const auth = authorization && (await account.signAuthorization(authorization)); // { r, s, yParity }

// 3) submit — the brain verifies the signature recovers to srcAddress, then broadcasts
const { mutateAsyncSafe: submit } = useGaslessSubmit();
const sub = await submit({ prepared: prep.value, signatures: { userOp, authorization: auth } });
if (!sub.ok) return;
const { txHash } = sub.value;   // GaslessSubmitResponse { txHash, alreadyKnown? } — execution-only

// 4) relay the returned hash to the hub
const { mutateAsyncSafe: relay } = useGaslessRelay();
const relayed = await relay({ srcChainKey, srcChainTxHash: txHash, relayData: { address: to, payload: data } });
// relayed.value → { srcChainTxHash, dstChainTxHash }  (TxHashPair)
```

## Mode A (external EIP-5792 wallet)

```ts
// @ai-snippets-skip
const { mutateAsyncSafe: sendCalls } = useGaslessSendCalls();
const sent = await sendCalls({ srcChainKey, srcAddress, token, amount: rawAmount, to, data, walletProvider });
if (!sent.ok) return;
// then relay: useGaslessRelay → { srcChainTxHash: sent.value.srcChainTxHash, relayData: sent.value.relayData }
```

## Types

```ts
// @ai-snippets-skip
type GaslessPrepareRequest  = { srcChainKey; srcAddress; token; amount: string; to; data };        // string amount (wire DTO)
type GaslessPrepareResponse = { srcChainKey; chainId; sender; entryPoint; userOp; userOpHash; authorization? };
type GaslessSubmitRequest   = { prepared: GaslessPrepareResponse; signatures: { userOp: string; authorization? } };
type GaslessSendCallsParams = { srcChainKey; srcAddress; token; amount: bigint; to; data; walletProvider }; // bigint amount (brain-only)
type GaslessCapabilitiesResponse = { configured; senderIsEoa; sponsorshipAvailable; eligible; reason? };
type GaslessWalletCapabilities   = { configured; atomicSupported; paymasterSupported; resolvedMode: 'walletCalls' | 'unsupported' };
```

## Return shapes

| Hook | Returns |
|---|---|
| `useGaslessCapabilities` | `UseQueryResult<GaslessCapabilitiesResponse, Error>` — `eligible` gates the prepare/submit flow |
| `useGaslessWalletCapabilities` | `UseQueryResult<GaslessWalletCapabilities, Error>` — `resolvedMode` gates Mode A |
| `useGaslessPrepare` | `SafeUseMutationResult<GaslessPrepareResponse, Error, …>` |
| `useGaslessSubmit` | `SafeUseMutationResult<GaslessSubmitResponse, Error, …>` (`{ txHash, alreadyKnown? }`) |
| `useGaslessSendCalls` | `SafeUseMutationResult<GaslessSendCallsResult, Error, …>` (`{ srcChainTxHash, relayData }`) |
| `useGaslessRelay` | `SafeUseMutationResult<TxHashPair, Error, …>` (`{ srcChainTxHash, dstChainTxHash }`) |

## Gotchas

1. **EOA sender only.** `srcAddress` must be an EOA (or an EIP-7702-delegated EOA); a deployed contract is rejected. `submit` also rejects a signature that does not recover to `srcAddress` (`VALIDATION_FAILED`, `context.reason: 'SIGNATURE_MISMATCH'`).
2. **The SDK never signs.** `prepare` is keyless and returns sign-requests; the EOA signs off-hook and you pass the signatures to `submit`. Provide the authorization signature **iff** `prepare` returned an `authorization` tuple.
3. **Execution-only.** `submit` / `sendCalls` return a spoke tx hash; call `useGaslessRelay` to complete the hub delivery. You already have `to`/`data`, so `relayData` is `{ address: to, payload: data }`.
4. **Amount type differs by surface.** The wire DTO (`prepare`/`submit`, shared with `sodax.api.gasless`) uses a **string** amount; Mode A `sendCalls` (brain-only) uses a **bigint**.
5. **`source: 'brain' | 'api'`.** `useGaslessCapabilities` / `useGaslessPrepare` / `useGaslessSubmit` accept it — `'brain'` (default) drives `sodax.gasless`, `'api'` drives `sodax.api.gasless` (backend, no Pimlico key). Mode A + relay + wallet-capabilities are brain-only.
6. **Narrow the wallet for Mode A.** `useWalletProvider` returns the base provider; use `isGaslessCapableEvmWalletProviderType(wp)` to get an `IGaslessCapableEvmWalletProvider`. A non-5792 wallet resolves to `unsupported`.
7. **ERC20 only.** The native token has no `approve` step and is rejected.
8. **Idempotent submit.** `submit` dedups on `userOpHash`: a re-broadcast of an already-known / already-included op (e.g. a client network retry of a submit that already succeeded) returns the same `txHash` with `alreadyKnown: true` instead of failing. A reverted op — or a nonce consumed by a *different* tx (no receipt for that `userOpHash`) — is still a genuine failure; re-prepare.

## Cross-references

- [`swap.md`](swap.md) — the intent-based swap gasless most commonly wraps (source of `to` + `data`).
- [`bridge.md`](bridge.md) — an alternative payload source (same-asset cross-chain deposit).
- [`../architecture.md`](../architecture.md) — `useSafeMutation`, `mutateAsyncSafe`, `unwrapResult`, queryKey conventions.
- `sodax-sdk`: the underlying `sodax.gasless` brain + `sodax.api.gasless` HTTP client (both implement the shared `IGaslessApi`).
