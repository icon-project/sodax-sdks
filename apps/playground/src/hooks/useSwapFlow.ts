import {
  type ChainKey,
  type QuoteRequestV2,
  type XToken,
  useSodaxContext,
  useSwapsApiQuote,
  useSwapsApiTokens,
} from '@sodax/dapp-kit';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits } from 'viem';
import { DEFAULT_AMOUNT, DEFAULT_PAIR, DEFAULT_SLIPPAGE_PERCENT } from '../config';
import { pickChain, pickToken, readSwapAssets, tokensOn } from '../lib/assets';
import { NO_PARTNER_FEE, type PartnerFeeInput, feeAmountOf, readPartnerFee } from '../lib/fee';
import { parseAmount } from '../lib/format';
import { initialUrl } from '../lib/initialUrl';
import { assetGroups } from '../lib/pickerOptions';
import { seedFor, toSearch } from '../lib/urlState';

export type SwapFlow = ReturnType<typeof useSwapFlow>;

const seed = seedFor('swap', initialUrl);

/**
 * The whole SODAX surface this widget uses: the swaps API's token list, and a quote off it that
 * refreshes every three seconds. There is no wallet here — no allowance, no approval, no intent —
 * so nothing this hook can do moves a visitor's funds. Components below only render what it
 * returns.
 *
 * Tokens and quotes both come from the Swaps API v2 (`sodax.api.swaps`), which is what
 * `sodax.com/exchange/swap` runs: it reaches every chain the backend lists — EVM and non-EVM
 * alike — and stays current without an SDK release. The packaged `getSupportedSolverTokens` list
 * would be deterministic but EVM-shaped and frozen at the release we build against.
 */
export function useSwapFlow() {
  const { sodax } = useSodaxContext();

  // A "no path" answer is a business result, not a transient failure, so retrying just delays the
  // headline. The 3s interval is the live-quote promise the receive leg makes.
  const tokensQuery = useSwapsApiTokens({ queryOptions: { retry: false } });
  const assets = useMemo(() => readSwapAssets(tokensQuery.data), [tokensQuery.data]);

  const [srcChain, setSrcChain] = useState<ChainKey>();
  const [dstChain, setDstChain] = useState<ChainKey>();
  const [srcToken, setSrcToken] = useState<XToken>();
  const [dstToken, setDstToken] = useState<XToken>();
  const [amount, setAmount] = useState(seed.amount ?? DEFAULT_AMOUNT);
  const [slippagePercent, setSlippagePercent] = useState(seed.slippage ?? DEFAULT_SLIPPAGE_PERCENT);
  const [partnerFeeInput, setPartnerFeeInput] = useState<PartnerFeeInput>(NO_PARTNER_FEE);

  // Seeded once, when the token list first arrives: a chain key or a symbol in the URL is a string
  // until there is a live list to resolve it against, and the list is what the app trusts.
  const isSeeded = useRef(false);

  useEffect(() => {
    if (isSeeded.current || assets.chains.length === 0) return;

    const src = pickChain(assets, seed.srcChain ?? DEFAULT_PAIR.srcChain, 0);
    const dst = pickChain(assets, seed.dstChain ?? DEFAULT_PAIR.dstChain, 1);
    if (!src || !dst) return;

    isSeeded.current = true;
    setSrcChain(src);
    setDstChain(dst);
    setSrcToken(pickToken(tokensOn(assets, src), seed.srcSymbol ?? DEFAULT_PAIR.srcSymbol));
    setDstToken(pickToken(tokensOn(assets, dst), seed.dstSymbol ?? DEFAULT_PAIR.dstSymbol));
  }, [assets]);

  const srcTokens = useMemo(() => (srcChain ? tokensOn(assets, srcChain) : []), [assets, srcChain]);
  const dstTokens = useMemo(() => (dstChain ? tokensOn(assets, dstChain) : []), [assets, dstChain]);

  // A chain change re-resolves the token against the new chain's list, keeping the same symbol when
  // it exists there. `pickToken` always returns a member of that list, never the previous chain's
  // object — every EVM chain's native token shares the address 0x0, so an address match would
  // silently carry the old chain's decimals onto the new one.
  useEffect(() => {
    if (srcTokens.length > 0) setSrcToken(current => pickToken(srcTokens, current?.symbol));
  }, [srcTokens]);

  useEffect(() => {
    if (dstTokens.length > 0) setDstToken(current => pickToken(dstTokens, current?.symbol));
  }, [dstTokens]);

  useEffect(() => {
    if (!srcChain || !dstChain) return;

    const search = toSearch({
      flow: 'swap',
      srcChain,
      dstChain,
      srcToken,
      dstToken,
      amount,
      slippage: slippagePercent,
      embed: initialUrl.embed,
    });
    // A sandboxed embed has an opaque origin and throws here; the form must still work in one.
    try {
      window.history.replaceState(null, '', `${window.location.pathname}?${search}`);
    } catch {}
  }, [srcChain, dstChain, srcToken, dstToken, amount, slippagePercent]);

  const groups = useMemo(() => assetGroups(assets.choices), [assets]);

  const inputAmount = useMemo(
    () => (srcToken ? parseAmount(amount, srcToken.decimals) : undefined),
    [amount, srcToken],
  );

  const feeState = useMemo(() => readPartnerFee(partnerFeeInput), [partnerFeeInput]);
  const partnerFee = feeState.kind === 'set' ? feeState.fee : undefined;

  // Display only. The API applies the fee itself, once, before quoting — subtracting it from
  // `amount` here would charge it twice.
  const feeAmount = useMemo(
    () => (inputAmount === undefined ? undefined : feeAmountOf(inputAmount, partnerFee)),
    [inputAmount, partnerFee],
  );

  const quoteBody = useMemo<QuoteRequestV2 | undefined>(() => {
    if (!srcChain || !dstChain || !srcToken || !dstToken || inputAmount === undefined) return undefined;
    return {
      tokenSrc: srcToken.address,
      tokenSrcChainKey: srcChain,
      tokenDst: dstToken.address,
      tokenDstChainKey: dstChain,
      amount: inputAmount.toString(),
      quoteType: 'exact_input',
      ...(partnerFee ? { partnerFee } : {}),
    };
  }, [srcChain, dstChain, srcToken, dstToken, inputAmount, partnerFee]);

  const quoteQuery = useSwapsApiQuote({
    params: { body: quoteBody },
    queryOptions: { retry: false, refetchInterval: 3000 },
  });
  const quotedAmount = quoteQuery.data?.quotedAmount;

  // Offline and rule-based — no network call, so it renders beside the form before any quote.
  const speedTier = useMemo(
    () => (srcToken && dstToken ? sodax.swaps.getSwapSpeedTier({ srcToken, dstToken }) : undefined),
    [sodax, srcToken, dstToken],
  );

  const slippageBps = useMemo(() => {
    const percent = Number(slippagePercent);
    if (!Number.isFinite(percent) || percent < 0 || percent >= 100) return undefined;
    return BigInt(Math.round((100 - percent) * 100));
  }, [slippagePercent]);

  const minOutputAmount = useMemo(() => {
    if (quotedAmount === undefined || slippageBps === undefined) return undefined;
    return (BigInt(quotedAmount) * slippageBps) / 10_000n;
  }, [quotedAmount, slippageBps]);

  const flipDirection = useCallback(() => {
    setSrcChain(dstChain);
    setDstChain(srcChain);
    setSrcToken(dstToken);
    setDstToken(srcToken);
  }, [srcChain, dstChain, srcToken, dstToken]);

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
    amount,
    setAmount,
    slippagePercent,
    setSlippagePercent,
    partnerFeeInput,
    setPartnerFeeInput,
    partnerFee,
    partnerFeeError: feeState.kind === 'invalid' ? feeState.message : undefined,
    partnerFeeAmount: feeAmount !== undefined && srcToken ? formatUnits(feeAmount, srcToken.decimals) : '',
    chains: assets.chains,
    groups,
    assetCount: assets.assetCount,
    networkCount: assets.chains.length,
    isLoadingAssets: assets.chains.length === 0 && tokensQuery.isLoading,
    assetsError: tokensQuery.isError ? 'Could not load the token list. Retry in a moment.' : undefined,
    speedTier,
    quotedOutput: quotedAmount !== undefined && dstToken ? formatUnits(BigInt(quotedAmount), dstToken.decimals) : '',
    minReceived: minOutputAmount !== undefined && dstToken ? formatUnits(minOutputAmount, dstToken.decimals) : '',
    hasQuote: quotedAmount !== undefined,
    isQuoting: quoteQuery.isFetching,
    quoteError: quoteQuery.isError ? 'No route for this pair right now.' : undefined,
    isSlippageValid: slippageBps !== undefined,
    isAmountValid: inputAmount !== undefined,
  };
}
