import {
  type CreateIntentParams,
  type Hex,
  type SolverIntentQuoteRequest,
  type SpokeChainKey,
  type XToken,
  getSupportedSolverTokens,
  useQuote,
  useSodaxContext,
  useStatus,
  useSwap,
  useSwapAllowance,
  useSwapApprove,
} from '@sodax/dapp-kit';
import { useEvmSwitchChain, useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatUnits, parseUnits } from 'viem';
import { ANY_SOLVER, DEFAULT_SLIPPAGE_PERCENT, playgroundMode } from '../config';
import { DEFAULT_DST_CHAIN, DEFAULT_SRC_CHAIN, type PlaygroundChainKey } from '../lib/chains';
import { type FriendlyError, describeError } from '../lib/errors';
import { NO_PARTNER_FEE, type PartnerFeeInput, feeAmountOf, readPartnerFee } from '../lib/fee';
import { pickToken, readUrlState, toSearch } from '../lib/urlState';

/** Everything `CreateIntentParams` needs except the deadline, which is resolved at submit time. */
type IntentDraft = Omit<CreateIntentParams, 'deadline'>;

export type Delivery = {
  srcTxHash: string;
  dstTxHash: Hex;
  srcChainKey: SpokeChainKey;
};

export type SwapFlow = ReturnType<typeof useSwapFlow>;

function parseAmount(value: string, decimals: number): bigint | undefined {
  const trimmed = value.trim();
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(trimmed)) return undefined;
  try {
    const parsed = parseUnits(trimmed, decimals);
    return parsed > 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// The SDK types IntentDeliveryInfo.dstTxHash as `string` while useStatus wants `Hex`. A tx hash is
// always 0x-prefixed hex, so normalize at this one boundary rather than casting blindly.
function toHex(value: string): Hex {
  return value.startsWith('0x') ? (value as Hex) : `0x${value}`;
}

/** Read once: the app owns the query string from its first render on. */
const initialUrl = readUrlState(window.location.search);

/**
 * The whole SODAX surface this playground uses, in one place: quote → allowance → approve → swap →
 * status. Components below only render what this returns.
 */
export function useSwapFlow() {
  const { sodax } = useSodaxContext();
  const account = useXAccount({ xChainType: 'EVM' });

  const [srcChain, setSrcChain] = useState<PlaygroundChainKey>(initialUrl.srcChain ?? DEFAULT_SRC_CHAIN);
  const [dstChain, setDstChain] = useState<PlaygroundChainKey>(initialUrl.dstChain ?? DEFAULT_DST_CHAIN);
  const [srcToken, setSrcToken] = useState<XToken | undefined>(() =>
    pickToken(getSupportedSolverTokens(initialUrl.srcChain ?? DEFAULT_SRC_CHAIN), initialUrl.srcSymbol),
  );
  const [dstToken, setDstToken] = useState<XToken | undefined>(() =>
    pickToken(getSupportedSolverTokens(initialUrl.dstChain ?? DEFAULT_DST_CHAIN), initialUrl.dstSymbol),
  );
  const [amount, setAmount] = useState(initialUrl.amount ?? '');
  const [slippagePercent, setSlippagePercent] = useState(initialUrl.slippage ?? DEFAULT_SLIPPAGE_PERCENT);
  const [partnerFeeInput, setPartnerFeeInput] = useState<PartnerFeeInput>(NO_PARTNER_FEE);
  const [error, setError] = useState<FriendlyError | undefined>();
  const [delivery, setDelivery] = useState<Delivery | undefined>();

  const srcTokens = useMemo(() => getSupportedSolverTokens(srcChain), [srcChain]);
  const dstTokens = useMemo(() => getSupportedSolverTokens(dstChain), [dstChain]);

  // A chain change re-resolves the token against the new chain's list, keeping the same symbol when
  // it exists there. `pickToken` always returns a member of that list, never the previous chain's
  // object — every chain's native token shares the address 0x0, so an address match would silently
  // carry the old chain's decimals onto the new chain.
  useEffect(() => setSrcToken(current => pickToken(srcTokens, current?.symbol)), [srcTokens]);
  useEffect(() => setDstToken(current => pickToken(dstTokens, current?.symbol)), [dstTokens]);

  useEffect(() => {
    const search = toSearch({ srcChain, dstChain, srcToken, dstToken, amount, slippage: slippagePercent });
    // A sandboxed embed has an opaque origin and throws here; the form must still work in one.
    try {
      window.history.replaceState(null, '', `${window.location.pathname}?${search}`);
    } catch {}
  }, [srcChain, dstChain, srcToken, dstToken, amount, slippagePercent]);

  const walletProvider = useWalletProvider({ xChainId: srcChain });
  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: srcChain });

  const inputAmount = useMemo(
    () => (srcToken ? parseAmount(amount, srcToken.decimals) : undefined),
    [amount, srcToken],
  );

  const feeState = useMemo(() => readPartnerFee(partnerFeeInput), [partnerFeeInput]);
  const partnerFee = feeState.kind === 'set' ? feeState.fee : undefined;

  const feeAmount = useMemo(
    () => (inputAmount === undefined ? undefined : feeAmountOf(inputAmount, partnerFee)),
    [inputAmount, partnerFee],
  );

  // Quoting needs no wallet, so the panel stays useful to a reader who never connects one.
  //
  // The fee comes off the input before quoting, so `quoted_amount` is what the user actually gets.
  // `SwapService.getQuote` does this itself from the *configured* fee — which is what the generated
  // snippet uses — but `useQuote` takes no per-call override, so an interactive fee is applied here.
  const quotePayload = useMemo<SolverIntentQuoteRequest | undefined>(() => {
    if (!srcToken || !dstToken || inputAmount === undefined || feeAmount === undefined) return undefined;
    return {
      token_src: srcToken.address,
      token_src_blockchain_id: srcChain,
      token_dst: dstToken.address,
      token_dst_blockchain_id: dstChain,
      amount: inputAmount - feeAmount,
      quote_type: 'exact_input',
    };
  }, [srcToken, dstToken, srcChain, dstChain, inputAmount, feeAmount]);

  // Offline and rule-based — no network call, so it can render beside the form before any quote.
  const speedTier = useMemo(
    () => (srcToken && dstToken ? sodax.swaps.getSwapSpeedTier({ srcToken, dstToken }) : undefined),
    [sodax, srcToken, dstToken],
  );

  const quoteQuery = useQuote({ params: { payload: quotePayload } });
  const quote = quoteQuery.data?.ok ? quoteQuery.data.value : undefined;
  const quoteError = quoteQuery.data && !quoteQuery.data.ok ? quoteQuery.data.error.detail.message : undefined;

  const slippageBps = useMemo(() => {
    const percent = Number(slippagePercent);
    if (!Number.isFinite(percent) || percent < 0 || percent >= 100) return undefined;
    return BigInt(Math.round((100 - percent) * 100));
  }, [slippagePercent]);

  const minOutputAmount = useMemo(() => {
    if (!quote || slippageBps === undefined) return undefined;
    return (BigInt(quote.quoted_amount) * slippageBps) / 10_000n;
  }, [quote, slippageBps]);

  // Built synchronously: on EVM the source signer address is the connected account, so the
  // allowance check below can run against it without awaiting the wallet provider.
  const draft = useMemo<IntentDraft | undefined>(() => {
    if (!srcToken || !dstToken || inputAmount === undefined || minOutputAmount === undefined) return undefined;
    if (!account.address) return undefined;
    return {
      inputToken: srcToken.address,
      outputToken: dstToken.address,
      inputAmount,
      minOutputAmount,
      allowPartialFill: false,
      srcChainKey: srcChain,
      dstChainKey: dstChain,
      srcAddress: account.address,
      dstAddress: account.address,
      solver: ANY_SOLVER,
      data: '0x',
    };
  }, [srcToken, dstToken, inputAmount, minOutputAmount, account.address, srcChain, dstChain]);

  const canSign = playgroundMode === 'full';

  // The allowance check reads only (srcChainKey, srcAddress, inputToken, inputAmount) — the deadline
  // is filler so the draft satisfies CreateIntentParams; the real one is resolved in executeSwap.
  const allowancePayload = useMemo<CreateIntentParams | undefined>(
    () => (draft && canSign ? { ...draft, deadline: 0n } : undefined),
    [draft, canSign],
  );

  const { data: hasAllowance, isLoading: isCheckingAllowance } = useSwapAllowance({
    params: { payload: allowancePayload, srcChainKey: srcChain, walletProvider },
  });

  const { mutateAsyncSafe: approveMutation, isPending: isApproving } = useSwapApprove();
  const { mutateAsyncSafe: swapMutation, isPending: isSwapping } = useSwap();

  const statusQuery = useStatus({ params: { intentTxHash: delivery?.dstTxHash } });
  const statusCode = statusQuery.data?.ok ? statusQuery.data.value.status : undefined;

  const approve = useCallback(async () => {
    if (!allowancePayload || !walletProvider) return;
    setError(undefined);
    const result = await approveMutation({ params: allowancePayload, walletProvider });
    if (!result.ok) setError(describeError(result.error, 'The approval failed.'));
  }, [allowancePayload, walletProvider, approveMutation]);

  const executeSwap = useCallback(async () => {
    if (!draft || !walletProvider) return;
    setError(undefined);
    setDelivery(undefined);

    // Read the deadline off the hub chain at submit time — a client clock can be minutes out, and a
    // deadline computed when the form opened would already be stale.
    const deadline = await sodax.swaps.getSwapDeadline();
    if (!deadline.ok) {
      setError(describeError(deadline.error, 'Could not read the hub-chain deadline.'));
      return;
    }

    // The same fee the quote was taken with. A swap charging more than the quote assumed produces a
    // `minOutputAmount` the intent cannot deliver, and it never fills.
    const result = await swapMutation({
      params: { ...draft, deadline: deadline.value },
      walletProvider,
      extras: { partnerFee },
    });
    if (!result.ok) {
      setError(describeError(result.error, 'The swap failed.'));
      return;
    }

    const info = result.value.intentDeliveryInfo;
    setDelivery({ srcTxHash: info.srcTxHash, dstTxHash: toHex(info.dstTxHash), srcChainKey: info.srcChainKey });
  }, [draft, walletProvider, sodax, swapMutation, partnerFee]);

  const flipDirection = useCallback(() => {
    setSrcChain(dstChain);
    setDstChain(srcChain);
  }, [srcChain, dstChain]);

  return {
    srcChain,
    dstChain,
    setSrcChain,
    setDstChain,
    flipDirection,
    srcToken,
    dstToken,
    setSrcToken,
    setDstToken,
    srcTokens,
    dstTokens,
    amount,
    setAmount,
    slippagePercent,
    setSlippagePercent,
    partnerFeeInput,
    setPartnerFeeInput,
    partnerFee,
    partnerFeeError: feeState.kind === 'invalid' ? feeState.message : undefined,
    partnerFeeAmount: feeAmount && srcToken ? formatUnits(feeAmount, srcToken.decimals) : '',
    speedTier,
    quotedOutput: quote && dstToken ? formatUnits(BigInt(quote.quoted_amount), dstToken.decimals) : '',
    minReceived: minOutputAmount !== undefined && dstToken ? formatUnits(minOutputAmount, dstToken.decimals) : '',
    hasQuote: !!quote,
    isQuoting: quoteQuery.isFetching,
    quoteError,
    isSlippageValid: slippageBps !== undefined,
    isAmountValid: inputAmount !== undefined,
    isConnected: !!account.address,
    canSign,
    isWrongChain,
    handleSwitchChain,
    hasAllowance: !!hasAllowance,
    isCheckingAllowance,
    approve,
    isApproving,
    executeSwap,
    isSwapping,
    error,
    delivery,
    statusCode,
  };
}
