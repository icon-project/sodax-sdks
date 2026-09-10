import { networkAllowed, type WidgetSettings } from '../lib/widgetSettings';
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
import { DEFAULT_AMOUNT, DEFAULT_PAIR, DEFAULT_SLIPPAGE_PERCENT, deploymentFeeInput, deploymentFee } from '../config';
import { useExecution } from './useExecution';
import {
  type PairDimensions,
  quoteEventKey,
  trackExchangeHandoff,
  trackPartnerFeeSet,
  trackQuoteFailed,
  trackQuoteReceived,
} from '../lib/analytics';
import { pickChain, pickToken, readSwapAssets, tokensOn } from '../lib/assets';
import type { Brand } from '../lib/brand';
import { feeAmountOf } from '../lib/fee';
import { parseAmount } from '../lib/format';
import { initialUrl } from '../lib/initialUrl';
import { assetGroups } from '../lib/pickerOptions';
import { seedFor, toSearch } from '../lib/urlState';

export type SwapFlow = ReturnType<typeof useSwapFlow>;

const seed = seedFor('swap', initialUrl);

/** Written back with the form, so a styled widget keeps its styling across the rewrite. */
export type SwapFlowOptions = { brand: Brand };

/** Owns live assets, quote state, and the wallet-backed execution flow. */
export function useSwapFlow({ brand }: SwapFlowOptions) {
  const { sodax } = useSodaxContext();
  const [widget, setWidget] = useState<WidgetSettings>(seed.widget ?? { sourceNetworks: [], destinationNetworks: [] });

  // Retry is explicit so a token-list outage exposes a usable recovery action.
  const tokensQuery = useSwapsApiTokens({ queryOptions: { retry: false } });
  const assets = useMemo(() => readSwapAssets(tokensQuery.data), [tokensQuery.data]);

  const [srcChain, setSrcChain] = useState<ChainKey>();
  const [dstChain, setDstChain] = useState<ChainKey>();
  const [srcToken, setSrcToken] = useState<XToken>();
  const [dstToken, setDstToken] = useState<XToken>();
  const [amount, setAmount] = useState(seed.amount ?? DEFAULT_AMOUNT);
  const [slippagePercent, setSlippagePercent] = useState(seed.slippage ?? DEFAULT_SLIPPAGE_PERCENT);
  const partnerFeeInput = deploymentFeeInput;

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
      brand,
      widget,
    });
    // A sandboxed embed has an opaque origin and throws here; the form must still work in one.
    try {
      window.history.replaceState(null, '', `${window.location.pathname}?${search}`);
    } catch {}
  }, [srcChain, dstChain, srcToken, dstToken, amount, slippagePercent, brand, widget]);

  const groups = useMemo(() => assetGroups(assets.choices), [assets]);
  const sourceNetworks = useMemo(
    () => assets.chains.filter(chain => networkAllowed(chain, widget.sourceNetworks)),
    [assets, widget],
  );
  const destinationNetworks = useMemo(
    () => assets.chains.filter(chain => networkAllowed(chain, widget.destinationNetworks)),
    [assets, widget],
  );
  const sourceGroups = useMemo(
    () => assetGroups(assets.choices.filter(choice => networkAllowed(choice.chain, widget.sourceNetworks))),
    [assets, widget],
  );
  const destinationGroups = useMemo(
    () => assetGroups(assets.choices.filter(choice => networkAllowed(choice.chain, widget.destinationNetworks))),
    [assets, widget],
  );
  useEffect(() => {
    if (!srcChain || !sourceNetworks.includes(srcChain)) {
      setSrcChain(
        sourceNetworks.find(chain => chain === (seed.srcChain ?? DEFAULT_PAIR.srcChain)) ?? sourceNetworks[0],
      );
    }
    if (!dstChain || !destinationNetworks.includes(dstChain)) {
      setDstChain(
        destinationNetworks.find(chain => chain === (seed.dstChain ?? DEFAULT_PAIR.dstChain)) ?? destinationNetworks[0],
      );
    }
  }, [srcChain, dstChain, sourceNetworks, destinationNetworks]);

  const inputAmount = useMemo(
    () => (srcToken ? parseAmount(amount, srcToken.decimals) : undefined),
    [amount, srcToken],
  );

  const feeState = deploymentFee;
  const partnerFee = feeState.kind === 'set' ? feeState.fee : undefined;

  // Display only. The API applies the fee itself, once, before quoting — subtracting it from
  // `amount` here would charge it twice.
  const feeAmount = useMemo(
    () => (inputAmount === undefined ? undefined : feeAmountOf(inputAmount, partnerFee)),
    [inputAmount, partnerFee],
  );

  const [quotedInput, setQuotedInput] = useState(inputAmount);
  useEffect(() => {
    const timer = window.setTimeout(() => setQuotedInput(inputAmount), 350);
    return () => window.clearTimeout(timer);
  }, [inputAmount]);
  const isAmountSettled = inputAmount === quotedInput;

  const quoteBody = useMemo<QuoteRequestV2 | undefined>(() => {
    if (!srcChain || !dstChain || !srcToken || !dstToken || inputAmount === undefined) return undefined;
    return {
      tokenSrc: srcToken.address,
      tokenSrcChainKey: srcChain,
      tokenDst: dstToken.address,
      tokenDstChainKey: dstChain,
      amount: quotedInput?.toString() ?? inputAmount.toString(),
      quoteType: 'exact_input',
      ...(partnerFee ? { partnerFee } : {}),
    };
  }, [srcChain, dstChain, srcToken, dstToken, inputAmount, quotedInput, partnerFee]);

  const quoteQuery = useSwapsApiQuote({
    params: { body: isAmountSettled && feeState.kind !== 'invalid' ? quoteBody : undefined },
    queryOptions: { retry: false, refetchInterval: 10000 },
  });
  const quotedAmount = isAmountSettled ? quoteQuery.data?.quotedAmount : undefined;

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

  const pair = useMemo<PairDimensions | undefined>(() => {
    if (!srcChain || !dstChain || !srcToken || !dstToken) return undefined;
    return {
      source_chain: srcChain,
      destination_chain: dstChain,
      input_token_symbol: srcToken.symbol,
      output_token_symbol: dstToken.symbol,
      input_amount: amount,
      has_partner_fee: partnerFee !== undefined,
    };
  }, [srcChain, dstChain, srcToken, dstToken, amount, partnerFee]);

  const trackedQuote = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!pair || (quotedAmount === undefined && !quoteQuery.isError)) return;

    const key = `${quoteEventKey(pair)}|${quoteQuery.isError}`;
    if (trackedQuote.current === key) return;
    trackedQuote.current = key;

    if (quoteQuery.isError) trackQuoteFailed(pair, 'no_route');
    else trackQuoteReceived(pair);
  }, [pair, quotedAmount, quoteQuery.isError]);

  const trackedFeeBps = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (partnerFee === undefined || trackedFeeBps.current === partnerFee.percentage) return;
    trackedFeeBps.current = partnerFee.percentage;
    trackPartnerFeeSet(partnerFee.percentage);
  }, [partnerFee]);

  const trackHandoff = useCallback(() => {
    if (pair) trackExchangeHandoff(pair);
  }, [pair]);

  const flipDirection = useCallback(() => {
    setSrcChain(dstChain);
    setDstChain(srcChain);
    setSrcToken(dstToken);
    setDstToken(srcToken);
  }, [srcChain, dstChain, srcToken, dstToken]);

  const execution = useExecution({
    srcChain,
    dstChain,
    srcToken,
    dstToken,
    amount,
    inputAmount,
    minOutputAmount,
    partnerFee,
    ready:
      !!srcChain &&
      sourceNetworks.includes(srcChain) &&
      !!dstChain &&
      destinationNetworks.includes(dstChain) &&
      quotedAmount !== undefined &&
      !quoteQuery.isError &&
      isAmountSettled &&
      feeState.kind !== 'invalid',
  });

  return {
    execution,
    widget,
    setWidget,
    sourceNetworks,
    destinationNetworks,
    sourceGroups,
    destinationGroups,
    retryAssets: () => tokensQuery.refetch(),
    refreshQuote: () => quoteQuery.refetch(),
    quoteUpdatedAt: quoteQuery.dataUpdatedAt,
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
    partnerFee,
    partnerFeeError: feeState.kind === 'invalid' ? feeState.message : undefined,
    partnerFeeAmount: feeAmount !== undefined && srcToken ? formatUnits(feeAmount, srcToken.decimals) : '',
    chains: assets.chains,
    groups,
    assetCount: new Set(
      assets.choices
        .filter(
          choice =>
            networkAllowed(choice.chain, widget.sourceNetworks) ||
            networkAllowed(choice.chain, widget.destinationNetworks),
        )
        .map(choice => choice.token.symbol),
    ).size,
    networkCount: new Set([...sourceNetworks, ...destinationNetworks]).size,
    isLoadingAssets: assets.chains.length === 0 && tokensQuery.isLoading,
    assetsError: tokensQuery.isError ? 'Could not load the token list. Retry in a moment.' : undefined,
    speedTier,
    quotedOutput: quotedAmount !== undefined && dstToken ? formatUnits(BigInt(quotedAmount), dstToken.decimals) : '',
    minReceived: minOutputAmount !== undefined && dstToken ? formatUnits(minOutputAmount, dstToken.decimals) : '',
    hasQuote: quotedAmount !== undefined,
    isQuoting: quoteQuery.isFetching || !isAmountSettled,
    quoteError: quoteQuery.isError ? 'Could not get a quote. Retry or choose another pair.' : undefined,
    isSlippageValid: slippageBps !== undefined,
    isAmountValid: inputAmount !== undefined,
    trackHandoff,
    brand,
  };
}
