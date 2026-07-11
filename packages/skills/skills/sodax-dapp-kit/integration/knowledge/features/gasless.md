# Gasless — `@sodax/dapp-kit`

Gasless (EIP-7702 sponsored) ERC20 spoke deposits. Batches `approve` + `assetManager.transfer` into
one atomic, paymaster-sponsored operation so a user with zero native balance can deposit. v2-only —
no v1 equivalent.

## When to use

The wrapped feature is a **spoke deposit** — the same on-chain action that powers `bridge` /
money-market `supply`. `useGaslessDeposit` is a feature-agnostic primitive: you supply the hub
recipient (`to`) and hub payload (`data`), typically built from a raw feature intent (e.g.
`sodax.bridge.createBridgeIntent({ raw: true })`), and it runs the sponsored batch + relay.

Two modes, selected by the signer in the mutation vars:

- **Mode A** — external EIP-5792 wallet (MetaMask/Rabby/Coinbase): pass `walletProvider`. The wallet
  executes `wallet_sendCalls` with an ERC-7677 paymaster.
- **Mode B** — SDK-managed key: pass `owner` (a viem `PrivateKeyAccount`). Backend/bot use.

## Configuration

Gasless is off unless configured on `new Sodax(...)` / `SodaxProvider` via the `gasless` option
(client-side secret, never fetched from the backend):

```ts
// @ai-snippets-skip
// SodaxOptions.gasless
{
  pimlicoApiKey: '<PIMLICO_KEY>',            // synthesizes per-chain paymaster + bundler URLs
  chains: {
    '0x2105.base': { supports7702: true },   // or per-chain { paymasterUrl, bundlerUrl, sponsorshipPolicyId }
  },
}
```

## Hook surface

```ts
// @ai-snippets-skip
// Mutation
useGaslessDeposit({ mutationOptions });                               // mutationKey ['gasless', 'deposit']

// Query — capability detection (gate the gasless option in your UI)
useGaslessCapabilities({ params: { chainKey, walletProvider? , owner? }, queryOptions }); // ['gasless', 'capabilities', ...]
```

## Mutation params

```ts
// @ai-snippets-skip
type GaslessDepositParams = {
  srcChainKey: EvmSpokeOnlyChainKey;
  srcAddress: Address;                 // user EOA (== the signer's address)
  token: Address;                      // ERC20 only (native rejected)
  amount: bigint;
  to: HubAddress;                      // hub recipient — from the feature intent's relayData.address
  data: Hex;                           // hub payload — from the feature intent's relayData.payload
  owner?: PrivateKeyAccount;           // Mode B signer  ─┐ provide exactly one
  walletProvider?: IGaslessCapableEvmWalletProvider; // Mode A signer ─┘
  allowGasFallback?: boolean;          // degrade to the normal user-paid approve+deposit when unavailable
  timeout?: number;
};

const { mutateAsyncSafe: gaslessDeposit } = useGaslessDeposit();
const result = await gaslessDeposit({ srcChainKey, srcAddress, token, amount, to, data, walletProvider });
if (!result.ok) return;
const { srcChainTxHash, dstChainTxHash } = result.value;   // TxHashPair
```

## Query params

```ts
// @ai-snippets-skip
type UseGaslessCapabilitiesParams = ReadHookParams<GaslessCapabilities, {
  chainKey: EvmSpokeOnlyChainKey;
  walletProvider?: IGaslessCapableEvmWalletProvider;   // Mode A probe
  owner?: PrivateKeyAccount;                            // Mode B
}>;
// GaslessCapabilities = {
//   chainKey; configured; atomicSupported; paymasterSupported;
//   resolvedMode: 'walletCalls' | 'smartAccount' | 'unsupported';
// }
```

## Return shapes

| Hook | Returns |
|---|---|
| `useGaslessDeposit` | `SafeUseMutationResult<TxHashPair, Error, UseGaslessDepositVars>` (`{ srcChainTxHash, dstChainTxHash }`) |
| `useGaslessCapabilities` | `UseQueryResult<GaslessCapabilities, Error>` — `resolvedMode` tells you which mode (or `unsupported`) applies |

## Gotchas

1. **Provide exactly one signer.** `walletProvider` (Mode A) XOR `owner` (Mode B) — passing both or neither rejects with `VALIDATION_FAILED`.
2. **Narrow the wallet before Mode A.** `useWalletProvider` returns the base provider; use `isGaslessCapableEvmWalletProviderType(wp)` to get an `IGaslessCapableEvmWalletProvider`. A non-5792 wallet resolves to `unsupported`.
3. **Not all wallets/chains support it.** Gate the UI with `useGaslessCapabilities` (or `sodax.gasless.isGaslessSupported(chainKey)`). Without `allowGasFallback`, an unsupported deposit returns a typed error; with it, the flow degrades to a normal **user-paid** approve+deposit.
4. **You build `to` + `data`, not the hook.** Derive them from a feature intent (e.g. a raw bridge intent's `relayData`). `to` must be the EOA-derived hub wallet — EIP-7702 preserves the EOA address.
5. **ERC20 only.** The native token has no `approve` step and is rejected.

## Cross-references

- [`bridge.md`](bridge.md) — the deposit action gasless most commonly wraps (source of `to` + `data`).
- [`../architecture.md`](../architecture.md) — `useSafeMutation`, `mutateAsyncSafe`, `unwrapResult`, queryKey conventions.
- `sodax-sdk`: the underlying `sodax.gasless` service surface.
