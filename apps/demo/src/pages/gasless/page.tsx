import React, { useMemo, useState } from 'react';
import {
  useSodaxContext,
  useGaslessDeposit,
  useGaslessCapabilities,
  isGaslessCapableEvmWalletProviderType,
  ChainKeys,
  spokeChainConfig,
  type Address,
  type EvmSpokeOnlyChainKey,
  type SpokeChainKey,
  type TxHashPair,
  type XToken,
} from '@sodax/dapp-kit';
import { useEvmSwitchChain, useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';
import { parseUnits } from 'viem';
import { Button } from '@/components/ui/button';

// EIP-7702 + Pimlico confirmed EVM spokes. Endpoints are synthesized from VITE_PIMLICO_API_KEY.
const GASLESS_CHAINS: EvmSpokeOnlyChainKey[] = [
  ChainKeys.BASE_MAINNET,
  ChainKeys.ARBITRUM_MAINNET,
  ChainKeys.OPTIMISM_MAINNET,
  ChainKeys.POLYGON_MAINNET,
  ChainKeys.BSC_MAINNET,
  ChainKeys.ETHEREUM_MAINNET,
];

/**
 * Gasless (EIP-7702 sponsored) deposit demo — Mode A (external wallet, EIP-5792).
 *
 * Composes a raw bridge intent for the hub payload (`to` + `data`), shows the connected wallet's
 * gasless capabilities, and runs `useGaslessDeposit`. `allowGasFallback` degrades to the normal
 * user-paid flow when the wallet/chain can't do gasless.
 */
export default function GaslessPage() {
  const { sodax } = useSodaxContext();

  const [srcChainKey, setSrcChainKey] = useState<EvmSpokeOnlyChainKey>(ChainKeys.BASE_MAINNET);
  const [dstChainKey, setDstChainKey] = useState<SpokeChainKey>(ChainKeys.ARBITRUM_MAINNET);
  const [tokenSymbol, setTokenSymbol] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [allowGasFallback, setAllowGasFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TxHashPair | null>(null);

  const tokens = useMemo<XToken[]>(
    () => Object.values(spokeChainConfig[srcChainKey].supportedTokens) as XToken[],
    [srcChainKey],
  );
  const token = tokens.find(t => t.symbol === tokenSymbol) ?? tokens[0];

  const account = useXAccount({ xChainId: srcChainKey });
  const walletProvider = useWalletProvider({ xChainId: srcChainKey });
  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: srcChainKey });

  const capableWallet =
    walletProvider && isGaslessCapableEvmWalletProviderType(walletProvider) ? walletProvider : undefined;

  const { data: capabilities } = useGaslessCapabilities({
    params: { chainKey: srcChainKey, walletProvider: capableWallet },
  });

  const { mutateAsyncSafe: deposit, isPending } = useGaslessDeposit();

  const handleDeposit = async () => {
    setError(null);
    setResult(null);

    if (!account.address) return setError('Connect an EVM wallet on the source chain.');
    if (!capableWallet) return setError('Connected wallet is not EIP-5792 capable.');
    if (!token) return setError('Select a token.');
    if (!amount) return setError('Enter an amount.');

    const srcAddress = account.address as Address;
    const rawAmount = parseUnits(amount, token.decimals);

    // Resolve a bridgeable destination token that shares a hub vault with the source token.
    const bridgeable = sodax.bridge.getBridgeableTokens(srcChainKey, dstChainKey, token.address as Address);
    if (!bridgeable.ok || bridgeable.value.length === 0) {
      return setError(`No bridgeable ${token.symbol} on ${dstChainKey}.`);
    }
    const dstToken = bridgeable.value[0];

    // Build the hub payload + recipient from a raw bridge intent (no broadcast).
    const intent = await sodax.bridge.createBridgeIntent({
      raw: true,
      params: {
        srcAddress,
        srcChainKey,
        srcToken: token.address,
        amount: rawAmount,
        dstChainKey,
        dstToken: dstToken.address,
        recipient: srcAddress,
      },
    });
    if (!intent.ok) return setError(intent.error.message);
    const { address: to, payload: data } = intent.value.relayData;

    const res = await deposit({
      srcChainKey,
      srcAddress,
      token: token.address as Address,
      amount: rawAmount,
      to,
      data,
      walletProvider: capableWallet,
      allowGasFallback,
    });
    if (!res.ok) return setError(res.error instanceof Error ? res.error.message : String(res.error));
    setResult(res.value);
  };

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Gasless Deposit (EIP-7702)</h1>
      <p className="text-sm text-muted-foreground">
        Batches <code>approve</code> + <code>transfer</code> into one sponsored operation. Requires an EIP-5792 wallet
        and <code>VITE_PIMLICO_API_KEY</code>.
      </p>

      <label className="flex flex-col gap-1 text-sm">
        Source chain
        <select
          className="rounded border p-2"
          value={srcChainKey}
          onChange={e => setSrcChainKey(e.target.value as EvmSpokeOnlyChainKey)}
        >
          {GASLESS_CHAINS.map(chain => (
            <option key={chain} value={chain}>
              {chain}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Token
        <select
          className="rounded border p-2"
          value={token?.symbol ?? ''}
          onChange={e => setTokenSymbol(e.target.value)}
        >
          {tokens.map(t => (
            <option key={t.address} value={t.symbol}>
              {t.symbol}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Amount
        <input
          className="rounded border p-2"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="0.0"
          inputMode="decimal"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Destination chain
        <select
          className="rounded border p-2"
          value={dstChainKey}
          onChange={e => setDstChainKey(e.target.value as SpokeChainKey)}
        >
          {GASLESS_CHAINS.filter(c => c !== srcChainKey).map(chain => (
            <option key={chain} value={chain}>
              {chain}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={allowGasFallback} onChange={e => setAllowGasFallback(e.target.checked)} />
        Allow gas fallback (user-paid) when gasless is unavailable
      </label>

      <div className="rounded border p-3 text-sm">
        <div>
          Gasless supported (config): <b>{String(sodax.gasless.isGaslessSupported(srcChainKey))}</b>
        </div>
        <div>
          Resolved mode: <b>{capabilities?.resolvedMode ?? '—'}</b>
        </div>
      </div>

      {isWrongChain ? (
        <Button onClick={handleSwitchChain}>Switch to {srcChainKey}</Button>
      ) : (
        <Button onClick={handleDeposit} disabled={isPending}>
          {isPending ? 'Depositing…' : 'Gasless deposit'}
        </Button>
      )}

      {error && <div className="rounded border border-red-400 p-3 text-sm text-red-600">{error}</div>}
      {result && (
        <div className="rounded border border-green-400 p-3 text-sm break-all">
          <div>src: {result.srcChainTxHash}</div>
          <div>dst: {result.dstChainTxHash}</div>
        </div>
      )}
    </div>
  );
}
