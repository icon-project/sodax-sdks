import React, { useMemo, useState } from 'react';
import {
  useSodaxContext,
  useGaslessCapabilities,
  useGaslessWalletCapabilities,
  useCapabilities,
  useGaslessSendCalls,
  useGaslessRelay,
  useGaslessPrepare,
  useQuote,
  isGaslessCapableEvmWalletProviderType,
  isNativeToken,
  getSupportedSolverTokens,
  getStagingSolverTokens,
  ChainKeys,
  type Address,
  type EvmSpokeOnlyChainKey,
  type GaslessPrepareResponse,
  type SolverIntentQuoteRequest,
  type TxHashPair,
  type XToken,
} from '@sodax/dapp-kit';
import { useEvmSwitchChain, useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';
import { parseUnits, formatUnits } from 'viem';
import BigNumber from 'bignumber.js';
import { Button } from '@/components/ui/button';
import { SolverEnv, useAppStore } from '@/zustand/useAppStore';
import { GaslessSpikeModeC } from './spike-mode-c';
import { GaslessSpikeHybrid4337 } from './spike-hybrid-4337';

// EIP-7702 + Pimlico confirmed EVM spokes. Endpoints are synthesized from VITE_PIMLICO_API_KEY.
// Both source and destination are constrained to these EVM spokes so `dstAddress` can reuse the
// source EOA (a 0x address is valid on any EVM chain).
const GASLESS_CHAINS: EvmSpokeOnlyChainKey[] = [
  ChainKeys.BASE_MAINNET,
  ChainKeys.ARBITRUM_MAINNET,
  ChainKeys.OPTIMISM_MAINNET,
  ChainKeys.POLYGON_MAINNET,
  ChainKeys.BSC_MAINNET,
  ChainKeys.ETHEREUM_MAINNET,
];

const ANY_SOLVER = '0x0000000000000000000000000000000000000000' as Address;

type ValidatedSwap = {
  srcAddress: Address;
  rawAmount: bigint;
  minOut: bigint;
  inputToken: XToken;
  outputToken: XToken;
};

/**
 * Gasless (EIP-7702 + ERC-4337, Pimlico-sponsored) swap demo.
 *
 * Composes a raw solver swap intent for the hub payload (`to` + `data`), then shows two flows:
 * - **Mode A** (interactive): an external EIP-5792 wallet executes the sponsored `[approve, transfer]`
 *   batch via `useGaslessSendCalls`, then `useGaslessRelay` completes the hub delivery.
 * - **prepare** (stateless brain): `useGaslessPrepare` returns the artifacts the EOA must sign
 *   (UserOp hash + optional EIP-7702 authorization tuple). Submitting requires an *external* signer,
 *   so it is driven by a key-holder / the backend gasless API — see the `apps/node` smoke script.
 */
export default function GaslessPage() {
  const { sodax } = useSodaxContext();
  const { solverEnvironment } = useAppStore();

  const [srcChainKey, setSrcChainKey] = useState<EvmSpokeOnlyChainKey>(ChainKeys.BASE_MAINNET);
  const [dstChainKey, setDstChainKey] = useState<EvmSpokeOnlyChainKey>(ChainKeys.ARBITRUM_MAINNET);
  const [inputTokenSymbol, setInputTokenSymbol] = useState<string>('');
  const [outputTokenSymbol, setOutputTokenSymbol] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [slippage, setSlippage] = useState<string>('0.5');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TxHashPair | null>(null);
  const [prepared, setPrepared] = useState<GaslessPrepareResponse | null>(null);

  // Staging solver supports the production tokens PLUS the staging-only ones; production/dev expose
  // only the production set. Drive the token dropdowns off the selected solver-env tab (mirrors SwapCard).
  const getSolverTokens = useMemo(
    () => (solverEnvironment === SolverEnv.Staging ? getStagingSolverTokens : getSupportedSolverTokens),
    [solverEnvironment],
  );

  // Gasless batches an ERC20 `approve`, so the input token must be an ERC20 (the native token is rejected).
  const inputTokens = useMemo<XToken[]>(
    () => getSolverTokens(srcChainKey).filter(t => !isNativeToken(srcChainKey, t)),
    [getSolverTokens, srcChainKey],
  );
  const outputTokens = useMemo<XToken[]>(() => [...getSolverTokens(dstChainKey)], [getSolverTokens, dstChainKey]);

  const inputToken = inputTokens.find(t => t.symbol === inputTokenSymbol) ?? inputTokens[0];
  const outputToken = outputTokens.find(t => t.symbol === outputTokenSymbol) ?? outputTokens[0];

  const account = useXAccount({ xChainId: srcChainKey });
  const walletProvider = useWalletProvider({ xChainId: srcChainKey });
  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: srcChainKey });

  const capableWallet =
    walletProvider && isGaslessCapableEvmWalletProviderType(walletProvider) ? walletProvider : undefined;

  // EOA eligibility for the stateless prepare/submit brain (chain configured + EOA + sponsorship).
  const { data: capabilities } = useGaslessCapabilities({
    params: account.address ? { srcChainKey, srcAddress: account.address as Address } : undefined,
  });
  // Mode A wallet probe (EIP-5792 atomic + paymaster). `srcAddress` scopes the cache to this wallet.
  const { data: walletCapabilities } = useGaslessWalletCapabilities({
    params: capableWallet
      ? { chainKey: srcChainKey, walletProvider: capableWallet, srcAddress: account.address as Address }
      : undefined,
  });

  // Numeric chain id for the selected source chain — EIP-5792 capability probes key on it.
  const srcChainId = useMemo(
    () => Number(sodax.config.getChainConfig(srcChainKey).chain.chainId),
    [sodax, srcChainKey],
  );

  // Raw EIP-5792 capabilities of the currently connected address on the source chain — reactive
  // `wallet_getCapabilities`, so a paymaster/atomic gap is visible without the console.
  const { data: walletCaps } = useCapabilities({
    params: capableWallet
      ? { walletProvider: capableWallet, chainId: srcChainId, account: account.address }
      : undefined,
  });

  const { mutateAsyncSafe: sendCalls, isPending: isSending } = useGaslessSendCalls();
  const { mutateAsyncSafe: relay, isPending: isRelaying } = useGaslessRelay();
  const { mutateAsyncSafe: prepare, isPending: isPreparing } = useGaslessPrepare();

  // Live solver quote for the selected pair + amount; drives minOutputAmount. Refetches every 3s.
  const quotePayload = useMemo<SolverIntentQuoteRequest | undefined>(() => {
    if (!inputToken || !outputToken || Number(amount) <= 0) return undefined;
    let inputAmount: bigint;
    try {
      inputAmount = parseUnits(amount, inputToken.decimals);
    } catch {
      return undefined;
    }
    return {
      token_src: inputToken.address,
      token_src_blockchain_id: srcChainKey,
      token_dst: outputToken.address,
      token_dst_blockchain_id: dstChainKey,
      amount: inputAmount,
      quote_type: 'exact_input',
    };
  }, [inputToken, outputToken, srcChainKey, dstChainKey, amount]);

  const quoteQuery = useQuote({ params: { payload: quotePayload } });
  const quote = quoteQuery.data?.ok ? quoteQuery.data.value : undefined;
  const quoteError = quoteQuery.data && !quoteQuery.data.ok ? quoteQuery.data.error.detail.message : undefined;

  // Parse the free-text slippage once: a finite percent in [0, 100). `null` when the field is empty or
  // out of range, so downstream stays `undefined` rather than producing a NaN/negative BigNumber.
  const slippagePct = useMemo(() => {
    const trimmed = slippage.trim();
    if (trimmed === '') return null; // `Number('')` is 0, so guard empty/blank explicitly (don't read it as 0%).
    const n = Number(trimmed);
    return Number.isFinite(n) && n >= 0 && n < 100 ? n : null;
  }, [slippage]);

  // minOutputAmount = quoted × (100 − slippage) / 100. `undefined` until both a quote and a valid
  // slippage exist (a 0n quote is a real value, so presence is `!== undefined`, not truthiness).
  const minOutputAmount = useMemo(
    () =>
      quote?.quoted_amount !== undefined && slippagePct !== null
        ? new BigNumber(quote.quoted_amount.toString()).multipliedBy(100 - slippagePct).div(100)
        : undefined,
    [quote, slippagePct],
  );

  // Build the hub payload (`to` + `data`) from a raw solver swap intent (no broadcast).
  const buildIntent = async (v: ValidatedSwap) => {
    const intent = await sodax.swaps.createIntent({
      raw: true,
      params: {
        inputToken: v.inputToken.address,
        outputToken: v.outputToken.address,
        inputAmount: v.rawAmount,
        minOutputAmount: v.minOut,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 60 * 5),
        allowPartialFill: false,
        srcChainKey,
        dstChainKey,
        srcAddress: v.srcAddress,
        dstAddress: v.srcAddress, // same EOA on the destination EVM chain
        solver: ANY_SOLVER,
        data: '0x',
      },
    });
    if (!intent.ok) throw intent.error;
    return intent.value.relayData; // { address: to, payload: data }
  };

  const validate = (): ValidatedSwap | null => {
    setError(null);
    setResult(null);
    setPrepared(null);
    if (!account.address) {
      setError('Connect an EVM wallet on the source chain.');
      return null;
    }
    if (!inputToken || !outputToken) {
      setError('Select input and output tokens.');
      return null;
    }
    if (srcChainKey === dstChainKey && inputToken.address.toLowerCase() === outputToken.address.toLowerCase()) {
      setError('Input and output tokens must differ for a swap.');
      return null;
    }
    if (!amount) {
      setError('Enter an amount.');
      return null;
    }
    let rawAmount: bigint;
    // parseUnits throws on a malformed decimal string — guard it so the click handler shows a friendly error.
    try {
      rawAmount = parseUnits(amount, inputToken.decimals);
    } catch {
      setError('Enter a valid amount.');
      return null;
    }
    if (slippagePct === null) {
      setError('Enter a valid slippage between 0 and 100.');
      return null;
    }
    if (!minOutputAmount) {
      setError('Waiting for a solver quote — try again in a moment.');
      return null;
    }
    return {
      srcAddress: account.address as Address,
      rawAmount,
      minOut: BigInt(minOutputAmount.toFixed(0)),
      inputToken,
      outputToken,
    };
  };

  // Mode A: sendCalls (external EIP-5792 wallet) → relay.
  const handleSendCalls = async () => {
    const v = validate();
    if (!v) return;
    if (!capableWallet) return setError('Connected wallet is not EIP-5792 capable.');
    try {
      const { address: to, payload: data } = await buildIntent(v);
      const sent = await sendCalls({
        srcChainKey,
        srcAddress: v.srcAddress,
        token: v.inputToken.address as Address,
        amount: v.rawAmount,
        to,
        data,
        walletProvider: capableWallet,
      });
      if (!sent.ok) return setError(sent.error instanceof Error ? sent.error.message : String(sent.error));
      const relayed = await relay({
        srcChainKey,
        srcChainTxHash: sent.value.srcChainTxHash,
        relayData: sent.value.relayData,
      });
      if (!relayed.ok) return setError(relayed.error instanceof Error ? relayed.error.message : String(relayed.error));
      setResult(relayed.value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Stateless brain: prepare → (external signer signs off-page) → submit.
  const handlePrepare = async () => {
    const v = validate();
    if (!v) return;
    try {
      const { address: to, payload: data } = await buildIntent(v);
      const res = await prepare({
        srcChainKey,
        srcAddress: v.srcAddress,
        token: v.inputToken.address,
        amount: v.rawAmount.toString(),
        to,
        data,
      });
      if (!res.ok) return setError(res.error instanceof Error ? res.error.message : String(res.error));
      setPrepared(res.value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="mx-auto flex max-w-xl flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold">Gasless Swap (EIP-7702)</h1>
        <p className="text-sm text-muted-foreground">
          Swaps one token for another (cross-chain), batching <code>approve</code> + <code>transfer</code> into one
          sponsored operation. Requires <code>VITE_PIMLICO_API_KEY</code>. Mode A needs an EIP-5792 wallet;
          prepare/submit needs an external EOA signer.
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
          Input token
          <select
            className="rounded border p-2"
            value={inputToken?.symbol ?? ''}
            onChange={e => setInputTokenSymbol(e.target.value)}
          >
            {inputTokens.map(t => (
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
            onChange={e => setDstChainKey(e.target.value as EvmSpokeOnlyChainKey)}
          >
            {GASLESS_CHAINS.map(chain => (
              <option key={chain} value={chain}>
                {chain}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Output token
          <select
            className="rounded border p-2"
            value={outputToken?.symbol ?? ''}
            onChange={e => setOutputTokenSymbol(e.target.value)}
          >
            {outputTokens.map(t => (
              <option key={t.address} value={t.symbol}>
                {t.symbol}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Slippage (%)
          <input
            className="rounded border p-2"
            value={slippage}
            onChange={e => setSlippage(e.target.value)}
            placeholder="0.5"
            inputMode="decimal"
          />
        </label>

        <div className="rounded border p-3 text-sm">
          <div>
            Quoted output:{' '}
            <b>
              {quote && outputToken
                ? `${formatUnits(quote.quoted_amount, outputToken.decimals)} ${outputToken.symbol}`
                : '—'}
            </b>
          </div>
          <div>
            Min output ({slippage}% slippage):{' '}
            <b>
              {minOutputAmount && outputToken
                ? `${formatUnits(BigInt(minOutputAmount.toFixed(0)), outputToken.decimals)} ${outputToken.symbol}`
                : '—'}
            </b>
          </div>
          {quoteError ? <div className="text-red-600">{quoteError}</div> : null}
        </div>

        <div className="rounded border p-3 text-sm">
          <div>
            EOA eligible (prepare/submit): <b>{capabilities ? String(capabilities.eligible) : '—'}</b>
            {capabilities?.reason ? <span className="text-muted-foreground"> ({capabilities.reason})</span> : null}
          </div>
          <div>
            Mode A wallet mode: <b>{walletCapabilities?.resolvedMode ?? '—'}</b>
          </div>
          <div className="text-muted-foreground">
            chain configured: <b>{walletCapabilities ? String(walletCapabilities.configured) : '—'}</b> · atomic:{' '}
            <b>{walletCapabilities ? String(walletCapabilities.atomicSupported) : '—'}</b> · paymaster:{' '}
            <b>{walletCapabilities ? String(walletCapabilities.paymasterSupported) : '—'}</b>
          </div>
          <div className="mt-2">
            <div className="text-muted-foreground">
              Connected address capabilities{account.address ? ` (${account.address})` : ''} on chain {srcChainId}:
            </div>
            {walletCaps?.[srcChainId] ? (
              <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
                {JSON.stringify(walletCaps[srcChainId], null, 2)}
              </pre>
            ) : (
              <div className="text-muted-foreground">
                {capableWallet ? '—' : 'Connect an EIP-5792 wallet to view capabilities.'}
              </div>
            )}
          </div>
        </div>

        {isWrongChain ? (
          <Button onClick={handleSwitchChain}>Switch to {srcChainKey}</Button>
        ) : (
          <div className="flex gap-2">
            <Button onClick={handleSendCalls} disabled={isSending || isRelaying}>
              {isSending ? 'Sending…' : isRelaying ? 'Relaying…' : 'Mode A: send + relay'}
            </Button>
            <Button variant="secondary" onClick={handlePrepare} disabled={isPreparing}>
              {isPreparing ? 'Preparing…' : 'Prepare (show sign-requests)'}
            </Button>
          </div>
        )}

        {error && <div className="rounded border border-red-400 p-3 text-sm text-red-600">{error}</div>}
        {result && (
          <div className="rounded border border-green-400 p-3 text-sm break-all">
            <div>src: {result.srcChainTxHash}</div>
            <div>dst: {result.dstChainTxHash}</div>
          </div>
        )}
        {prepared && (
          <div className="rounded border border-blue-400 p-3 text-xs break-all">
            <div className="mb-1 font-semibold">Prepared — hand these to an external EOA signer:</div>
            <div>userOpHash: {prepared.userOpHash}</div>
            {prepared.authorization && (
              <div>
                authorization: chainId {prepared.authorization.chainId}, delegate {prepared.authorization.address},
                nonce {prepared.authorization.nonce}
              </div>
            )}
            <div className="mt-1 text-muted-foreground">
              Sign the hash (and authorization) off-page, then call <code>submit</code> — see the apps/node smoke
              script.
            </div>
          </div>
        )}
      </div>
      <GaslessSpikeModeC />
      <GaslessSpikeHybrid4337 />
    </>
  );
}
