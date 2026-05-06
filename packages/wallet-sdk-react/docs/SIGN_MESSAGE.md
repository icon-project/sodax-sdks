# Sign Message

`useXSignMessage` is a single React Query mutation that delegates message signing to the connected wallet's `ChainActions.signMessage` implementation. The signature shape and encoding rules differ per chain — Bitcoin in particular auto-selects between BIP-322 and ECDSA based on the connected address type.

The hook source is [`useXSignMessage.ts`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/src/hooks/useXSignMessage.ts); the per-chain wiring lives in [`chainRegistry.ts`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/src/chainRegistry.ts) and the provider-managed `<Chain>Actions.tsx` files.

## Table of contents

1. [Hook API](#hook-api)
2. [Per-chain support matrix](#per-chain-support-matrix)
3. [Bitcoin — BIP-322 vs ECDSA auto-detect](#bitcoin--bip-322-vs-ecdsa-auto-detect)
4. [ICON not supported](#icon-not-supported)
5. [Provider-managed chains (EVM / Solana / Sui)](#provider-managed-chains-evm--solana--sui)
6. [Stellar / Injective / NEAR / Stacks](#stellar--injective--near--stacks)
7. [Error handling](#error-handling)

---

## Hook API

```typescript
import { useXSignMessage } from '@sodax/wallet-sdk-react';

const sign = useXSignMessage();

const signature = await sign.mutateAsync({
  xChainType: 'EVM',
  message: 'Sign in to MyDApp\nNonce: abc123',
});
// signature: `0x${string}` | Uint8Array | string | undefined
```

Variables:

| Field | Type | Notes |
|-------|------|-------|
| `xChainType` | `ChainType` | Which chain to sign with (`'EVM'`, `'BITCOIN'`, …) |
| `message` | `string` | Plain UTF-8; per-chain wrappers handle encoding |

Return type is the discriminated union `\`0x${string}\` | Uint8Array | string | undefined` because each chain returns its native signature shape (hex for EVM, base64 for Stellar, base58 for Solana, etc.). Cast or branch on `xChainType` when consuming.

`undefined` is returned (not thrown) when the chain doesn't implement `signMessage` — currently only ICON. A one-time `console.warn` accompanies the `undefined`.

---

## Per-chain support matrix

| Chain | Implementation | Signature shape |
|-------|----------------|-----------------|
| EVM | `signMessageAsync` from wagmi → personal_sign | `\`0x${string}\`` |
| Solana | `signMessage` from `@solana/wallet-adapter` | `Uint8Array` |
| Sui | `signPersonalMessage` from `@mysten/dapp-kit` | `string` (base64 signature + bytes) |
| Bitcoin | Auto-detect: BIP-322 (P2WPKH/P2TR) or ECDSA (P2SH/P2PKH) | `string` |
| Stellar | `walletsKit.signMessage` from `@creit.tech/stellar-wallets-kit` | `string` (base64) |
| Injective | `walletStrategy.signArbitrary` from `@injectivelabs/wallet-base` | `string` |
| NEAR | NEAR connector's `signMessage` | `string` |
| Stacks | `signMessage` from `@stacks/connect` | `string` |
| **ICON** | **Not supported** — Hana wallet does not expose a signing API | `undefined` |

---

## Bitcoin — BIP-322 vs ECDSA auto-detect

Bitcoin's signing flow inspects the connected address and picks the right method automatically:

| Address type | Signing method | Connectors that support it |
|--------------|----------------|----------------------------|
| P2WPKH (native segwit, `bc1q…`) | BIP-322 | Unisat, Xverse, OKX |
| P2TR (taproot, `bc1p…`) | BIP-322 | Unisat, Xverse, OKX |
| P2SH (legacy multi-sig, `3…`) | ECDSA | Unisat, Xverse, OKX |
| P2PKH (legacy, `1…`) | ECDSA | Unisat, Xverse, OKX |

The dispatch happens inside [`chainRegistry.ts`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/src/chainRegistry.ts) using `detectBitcoinAddressType(address)` + the `hasSignBip322` / `hasSignEcdsa` type guards from [`bitcoinSignGuards.ts`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/src/xchains/bitcoin/bitcoinSignGuards.ts):

```typescript
switch (addressType) {
  case 'P2WPKH':
  case 'P2TR':
    if (!hasSignBip322(connector)) {
      throw new Error(`${connector.id} does not support BIP-322 signing`);
    }
    return connector.signBip322Message(message);

  case 'P2SH':
  case 'P2PKH':
    if (!hasSignEcdsa(connector)) {
      throw new Error(`${connector.id} does not support ECDSA signing`);
    }
    return connector.signEcdsaMessage(message);
}
```

The same logic mirrors the SDK's `BitcoinSpokeProvider.authenticateWithWallet` — the React layer doesn't reinvent the dispatch. If a custom connector implements only one of the two methods, calling `signMessage` from a wrongly-typed address surfaces the error inline.

**Why BIP-322 for segwit/taproot?** Legacy ECDSA message signing (`signEcdsaMessage`) doesn't have a standard for non-P2PKH addresses. BIP-322 added a generic verification framework that works across address types — most modern Bitcoin wallets implement it for segwit/taproot specifically.

---

## ICON not supported

Hana wallet on ICON exposes account / transaction APIs but no general-purpose `signMessage` endpoint. `useXSignMessage({ xChainType: 'ICON' })` returns `undefined` and logs:

```
[useXSignMessage] signMessage not supported for chain "ICON"
```

If you need a signature on ICON for SIWE-style auth, fall back to a transaction-based proof or skip ICON in your auth flow. The chainRegistry comment explicitly documents this: `// ICON: signMessage not implemented — Hana wallet does not expose a signing API.`

---

## Provider-managed chains (EVM / Solana / Sui)

For EVM, Solana, and Sui, `signMessage` is registered by the chain's `<Chain>Actions.tsx` component using a **ref to the native SDK hook**. The ref is updated on each render so the registered closure always calls the latest function:

```typescript
// EvmActions.tsx — pattern shared with SolanaActions, SuiActions
const { signMessageAsync } = useSignMessage(); // wagmi
const signMessageRef = useRef(signMessageAsync);
useEffect(() => { signMessageRef.current = signMessageAsync; }, [signMessageAsync]);

useEffect(() => {
  registerActions({
    signMessage: async (message) => signMessageRef.current({ message }),
  });
}, []);
```

This pattern keeps the registered action stable (registered once on mount) while still calling the current native SDK function — important because re-registering on every render would trigger downstream re-subscribes.

Consumer perspective is the same — call `useXSignMessage` and let the layer handle the routing.

---

## Stellar / Injective / NEAR / Stacks

Non-provider chains register `signMessage` directly in `chainRegistry`:

```typescript
// Stellar
signMessage: async (message: string) => {
  const res = await service.walletsKit.signMessage(message);
  return res.signedMessage;
}

// Injective — auto-converts injective1… address to 0x… for MetaMask wallet
signMessage: async (message: string) => {
  const ethereumAddress = getEthereumAddress(address);
  return await service.walletStrategy.signArbitrary(
    service.walletStrategy.getWallet() === Wallet.Metamask ? ethereumAddress : address,
    message,
  );
}
```

Each delegates to the chain's native signing API. Errors propagate as-is — you'll see `Wallet.signMessage rejected by user`, `Address mismatch`, etc., depending on the chain's SDK.

---

## Error handling

```tsx
import { useXSignMessage } from '@sodax/wallet-sdk-react';

function SignButton() {
  const sign = useXSignMessage();

  const handleSign = async () => {
    try {
      const signature = await sign.mutateAsync({
        xChainType: 'EVM',
        message: 'Sign in',
      });
      if (!signature) {
        // ICON or other unsupported chain
        return;
      }
      submitSignature(signature);
    } catch (error) {
      // User rejection, wallet disconnect mid-sign, address mismatch, etc.
      console.error('sign failed:', error);
    }
  };

  return (
    <button onClick={handleSign} disabled={sign.isPending}>
      {sign.isPending ? 'Waiting for wallet…' : 'Sign'}
    </button>
  );
}
```

Common error messages by chain:

| Chain | Typical error |
|-------|---------------|
| EVM | `User rejected the request` (MetaMask), `User denied message signature` (Rabby) |
| Solana | `WalletSignMessageError: User rejected the request` |
| Sui | `User rejected the signature request` |
| Bitcoin | `<connector.id> does not support BIP-322 signing` (mismatch with address type), `User canceled the request` |
| Stellar | `Stellar signature not found` |
| Injective | `Injective signature not found`, `Injective address not found` |

`mutation.error` reflects the latest failure; `mutation.isError` / `mutation.isPending` follow standard React Query semantics.

---

## Related docs

- [Connect Flow](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/CONNECT_FLOW.md) — must connect a wallet before signing
- [Configure SodaxWalletProvider](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/CONFIGURE_PROVIDER.md) — chain must be enabled in config to dispatch
- [Connectors](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/CONNECTORS.md) — Bitcoin connector classes for `instanceof` checks
- [SDK Wallet Providers Reference](https://github.com/icon-project/sodax-frontend/blob/main/packages/sdk/docs/WALLET_PROVIDERS.md) — Bitcoin's lower-level `signTransaction` / `signEcdsaMessage` / `signBip322Message` interface
- [BIP-322 specification](https://github.com/bitcoin/bips/blob/master/bip-0322.mediawiki) — generic signed-message format for all Bitcoin address types
