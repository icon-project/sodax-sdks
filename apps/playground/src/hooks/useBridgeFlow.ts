import {
  type CreateBridgeIntentParams,
  HUB_CHAIN_KEY,
  type XToken,
  useBridge,
  useBridgeAllowance,
  useBridgeApprove,
  useGetBridgeableAmount,
  useGetBridgeableTokens,
} from '@sodax/dapp-kit';
import { useEvmSwitchChain, useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatUnits } from 'viem';
import { DEFAULT_AMOUNT } from '../config';
import { pickToken } from '../lib/assets';
import {
  type PlaygroundChainKey,
  bridgeChainOr,
  defaultBridgeDstChain,
  defaultBridgeSrcChain,
  spokeTokens,
} from '../lib/chains';
import { type FriendlyError, describeError } from '../lib/errors';
import { initialUrl } from '../lib/initialUrl';
import { parseAmount } from '../lib/format';
import { seedFor, toSearch } from '../lib/urlState';

/**
 * Parked with the flow: nothing mounts `SodaxWalletProvider` any more, so there is no signer to
 * approve or bridge with. Reviving the bridge means mounting it again for that route only.
 */
const CAN_SIGN = false;

/** Bridging settles on the hub, so the second hash is a Sonic tx — not one on the destination spoke. */
export type BridgeDelivery = {
  srcChainKey: PlaygroundChainKey;
  srcTxHash: string;
  hubTxHash: string;
};

export type BridgeFlow = ReturnType<typeof useBridgeFlow>;

const seed = seedFor('bridge', initialUrl);

/**
 * The bridge counterpart to `useSwapFlow`: bridgeable tokens → limit → allowance → approve →
 * bridge. There is no quote and no slippage — a bridge moves one asset 1:1, so the only price-like
 * constraint is the vault's capacity on the destination side.
 */
export function useBridgeFlow() {
  const account = useXAccount({ xChainType: 'EVM' });

  // A chain key from the URL is a string until the derived list recognises it — the list is the
  // allowlist, so an unknown one falls back to the default rather than reaching the SDK.
  const seedSrcChain = bridgeChainOr(seed.srcChain, defaultBridgeSrcChain());
  const [srcChain, setSrcChain] = useState<PlaygroundChainKey>(seedSrcChain);
  const [dstChain, setDstChain] = useState<PlaygroundChainKey>(bridgeChainOr(seed.dstChain, defaultBridgeDstChain()));
  const [srcToken, setSrcToken] = useState<XToken | undefined>(() =>
    pickToken(spokeTokens(seedSrcChain), seed.srcSymbol),
  );
  const [dstToken, setDstToken] = useState<XToken | undefined>();
  const [amount, setAmount] = useState(seed.amount ?? DEFAULT_AMOUNT);
  const [error, setError] = useState<FriendlyError | undefined>();
  const [delivery, setDelivery] = useState<BridgeDelivery | undefined>();

  const srcTokens = useMemo(() => spokeTokens(srcChain), [srcChain]);

  // The destination list is the SDK's answer, not a filter of ours: it returns the tokens on
  // `dstChain` sharing the source token's hub vault, which is what "the same asset" means here.
  const bridgeableQuery = useGetBridgeableTokens({
    params: { from: srcChain, to: dstChain, token: srcToken?.address },
  });
  const dstTokens = useMemo(() => bridgeableQuery.data ?? [], [bridgeableQuery.data]);

  useEffect(() => setSrcToken(current => pickToken(srcTokens, current?.symbol)), [srcTokens]);
  useEffect(() => setDstToken(current => pickToken(dstTokens, current?.symbol)), [dstTokens]);

  useEffect(() => {
    const search = toSearch({ flow: 'bridge', srcChain, dstChain, srcToken, dstToken, amount });
    // A sandboxed embed has an opaque origin and throws here; the form must still work in one.
    try {
      window.history.replaceState(null, '', `${window.location.pathname}?${search}`);
    } catch {}
  }, [srcChain, dstChain, srcToken, dstToken, amount]);

  const walletProvider = useWalletProvider({ xChainId: srcChain });
  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: srcChain });

  const inputAmount = useMemo(
    () => (srcToken ? parseAmount(amount, srcToken.decimals) : undefined),
    [amount, srcToken],
  );

  const limitQuery = useGetBridgeableAmount({ params: { from: srcToken, to: dstToken } });
  const limit = limitQuery.data;
  const exceedsLimit = limit !== undefined && inputAmount !== undefined && inputAmount > limit.amount;

  const payload = useMemo<CreateBridgeIntentParams<PlaygroundChainKey> | undefined>(() => {
    if (!srcToken || !dstToken || inputAmount === undefined || !account.address) return undefined;
    return {
      srcAddress: account.address,
      srcChainKey: srcChain,
      srcToken: srcToken.address,
      amount: inputAmount,
      dstChainKey: dstChain,
      dstToken: dstToken.address,
      recipient: account.address,
    };
  }, [srcToken, dstToken, inputAmount, account.address, srcChain, dstChain]);

  const canSign = CAN_SIGN;
  const signablePayload = canSign ? payload : undefined;

  const { data: hasAllowance, isLoading: isCheckingAllowance } = useBridgeAllowance({
    params: { payload: signablePayload, walletProvider },
  });

  const { mutateAsyncSafe: approveMutation, isPending: isApproving } = useBridgeApprove();
  const { mutateAsyncSafe: bridgeMutation, isPending: isBridging } = useBridge();

  const approve = useCallback(async () => {
    if (!signablePayload || !walletProvider) return;
    setError(undefined);
    const result = await approveMutation({ params: signablePayload, walletProvider });
    if (!result.ok) setError(describeError(result.error, 'The approval failed.'));
  }, [signablePayload, walletProvider, approveMutation]);

  const executeBridge = useCallback(async () => {
    if (!signablePayload || !walletProvider) return;
    setError(undefined);
    setDelivery(undefined);

    const result = await bridgeMutation({ params: signablePayload, walletProvider });
    if (!result.ok) {
      setError(describeError(result.error, 'The bridge failed.'));
      return;
    }

    setDelivery({
      srcChainKey: srcChain,
      srcTxHash: result.value.srcChainTxHash,
      hubTxHash: result.value.dstChainTxHash,
    });
  }, [signablePayload, walletProvider, bridgeMutation, srcChain]);

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
    // A bridge is 1:1, so the receive leg mirrors the input rather than waiting on a quote.
    receivedAmount: inputAmount !== undefined && dstToken ? formatUnits(inputAmount, dstToken.decimals) : '',
    maxBridgeable: limit ? formatUnits(limit.amount, limit.decimals) : '',
    exceedsLimit,
    isLoadingRoute: bridgeableQuery.isFetching,
    hasRoute: dstTokens.length > 0,
    routeError: bridgeableQuery.isError ? 'No shared vault between these chains for that token.' : undefined,
    isAmountValid: inputAmount !== undefined,
    isConnected: !!account.address,
    canSign,
    isWrongChain,
    handleSwitchChain,
    hasAllowance: !!hasAllowance,
    isCheckingAllowance,
    approve,
    isApproving,
    executeBridge,
    isBridging,
    error,
    delivery,
    hubChainKey: HUB_CHAIN_KEY,
  };
}
