/**
 * Create-position form.
 *
 * Two transactions: an approve so the deposit can be pulled, then the open itself. Both go through
 * `sodax.leverageYield`, which is what makes this work from any chain rather than only from the hub:
 * the deposit is carried to the user's hub wallet and the position is created from inside that same
 * relayed batch, so the funds are never sitting on the hub unattached to a position.
 *
 * The approve spender differs by chain and is not guessable — the hub wallet itself on Sonic, the
 * spoke asset manager elsewhere — so that is the SDK's to resolve, not this form's.
 *
 * The owner is always the funder's own hub wallet and is not selectable. The factory requires
 * `cfg.owner == msg.sender`, so naming anyone else cannot be made to work — and before that was
 * enforced, choosing the owner while also choosing the refund address was a theft path.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SelectToken } from '@/components/swaps/SelectToken';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import {
  useSodaxContext,
  useReservesUsdFormat,
  useEModes,
  useXBalances,
  EvmVaultTokenService,
  type GetWalletProviderType,
  projectLeverageLeg,
  sizeLeverageBorrow,
  type LeverageLegRequest,
  type SpokeChainKey,
  type XToken,
} from '@sodax/dapp-kit';
import { getXChainType, useEvmSwitchChain, useWalletProvider, useXAccount, useXService } from '@sodax/wallet-sdk-react';
import { formatUnits, isAddress, parseUnits, type Address } from 'viem';
import { getReadableTxError } from '@/lib/utils';
import { useOpenPosition } from './useHubWalletRoute';
import { useLegQuote } from './useLegQuote';
import { LeveragedApyPanel, apyPctFromReserve } from './LeveragedApyPanel';

/**
 * Reserves that must never be offered as the debt side, keyed by hub reserve address so one entry
 * covers that token on every chain (each chain's bnUSD resolves to the same hub reserve).
 *
 * bnUSD `0xE801CA34…` has BORROWING_ENABLED clear in its pool configuration, so `Pool.borrow`
 * rejects it with Aave error `'30'` — and there is no useful position to be had anyway, because the
 * borrowable bnUSD reserve is a DIFFERENT token: `bnUSDd` `0x94dC79ce…`, which converts 1:1 through
 * the bnUSD vault. Selecting bnUSD costs a whole cross-chain round trip to learn that.
 *
 * This is deliberately belt-and-braces with the `borrowingEnabled` filter below rather than a
 * replacement for it: a live position was created against bnUSD with that filter already in place,
 * so the flag reaching this component cannot be relied on to exclude it.
 *
 * sodahyTB is here for the same reason and from the same evidence: reading bit 58 of every listed
 * reserve's configuration, these two are the only ones with borrowing disabled.
 */
/**
 * `usableMaxLeverage` is `Infinity` when the fill is favourable enough that each turn adds more
 * borrowing power than debt — real, and not something to print as "Infinityx".
 */
function fmtLeverageCap(max: number): string {
  return Number.isFinite(max) ? `${max.toFixed(2)}x` : 'unbounded at this price';
}

const NEVER_BORROWABLE_RESERVES = new Set([
  '0xe801ca34e19abcbfea12025378d19c4fbe250131', // bnUSD — borrow bnUSDd 0x94dC79ce… instead
  '0xd806e60e3929c7f62ce22f9b132801ae98dd1cd8', // sodahyTB
]);

export function CreatePositionCard({ chain, owner }: { chain: SpokeChainKey; owner: Address | undefined }) {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();
  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: chain });
  const walletProvider = useWalletProvider({ xChainId: chain });
  const signer = useXAccount({ xChainId: chain }).address;
  // Opens from `chain`, reports the intent, and records the order — see useOpenPosition.
  const openPosition = useOpenPosition(chain);
  const isHubChain = chain === sodax.hubProvider.chainConfig.chain.key;

  const { data: reserves } = useReservesUsdFormat();
  /**
   * Tokens come from the money market's own per-chain list, not the swap lists — leverage *is*
   * money market, so solver swap support is the wrong gate. The two lists have since converged for
   * this pair (USSD, sodaUSSD and sodaSUSDS are all production swap tokens now), but they are still
   * not the same question: `sodaUSDS` is a money-market reserve the production solver has no path
   * for, so gating on the swap list would drop a usable collateral and gating on nothing would offer
   * an unfillable one.
   *
   * Each entry resolves to its hub reserve via `XToken.vault`, which is what makes a raw token
   * selectable at all: USSD.vault is sodaUSSD, and a wrapper's vault is itself.
   */
  const chainTokens = useMemo(() => sodax.moneyMarket.getSupportedTokensByChainId(chain), [sodax, chain]);

  const reserveFor = useCallback(
    (token: XToken | undefined) =>
      token ? reserves?.find(r => r.underlyingAsset.toLowerCase() === token.vault.toLowerCase()) : undefined,
    [reserves],
  );
  const { data: eModes } = useEModes();
  // A token is offerable only if the reserve behind it permits that side.
  const collateralTokens = useMemo(
    () =>
      chainTokens.filter(t => {
        const r = reserveFor(t);
        return (
          !!r && r.isActive && !r.isFrozen && r.usageAsCollateralEnabled && Number(r.formattedBaseLTVasCollateral) > 0
        );
      }),
    [chainTokens, reserveFor],
  );
  const borrowTokens = useMemo(
    () =>
      chainTokens.filter(t => {
        const r = reserveFor(t);
        return (
          !!r &&
          r.isActive &&
          !r.isFrozen &&
          r.borrowingEnabled &&
          !NEVER_BORROWABLE_RESERVES.has(r.underlyingAsset.toLowerCase())
        );
      }),
    [chainTokens, reserveFor],
  );

  const [collateralToken, setCollateralToken] = useState<XToken | undefined>();
  const [borrowTokenSel, setBorrowTokenSel] = useState<XToken | undefined>();
  const [eModeCategory, setEModeCategory] = useState('0');
  const [amount, setAmount] = useState('1');
  const [leverage, setLeverage] = useState(2);
  const [slippagePct, setSlippagePct] = useState(1);
  const [startFrom, setStartFrom] = useState<'collateral' | 'debt'>('collateral');
  const [busy, setBusy] = useState<'approve' | 'create' | undefined>();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();

  // Reserve data reports `underlyingAsset` lowercased while the defaults here are checksummed,
  // and Select matches its value by exact string — so snap each selection onto the option's own
  // casing once reserves load, otherwise the trigger renders empty with nothing selected.
  // Re-seed whenever the chain changes: last chain's tokens are not valid on this one.
  useEffect(() => {
    setCollateralToken(prev => (prev && collateralTokens.includes(prev) ? prev : collateralTokens[0]));
    setBorrowTokenSel(prev =>
      prev && borrowTokens.includes(prev)
        ? prev
        : (borrowTokens.find(t => t !== collateralTokens[0]) ?? borrowTokens[0]),
    );
  }, [collateralTokens, borrowTokens]);

  // Three addresses per selection, and they are not interchangeable:
  //   `vault`    — the hub MONEY-MARKET reserve the position uses (soda*), always 18 decimals
  //   `hubAsset` — what the user actually HOLDS on the hub, and the vault's deposit input
  //   `address`  — the spoke-side original; not what to read a hub balance from
  // For a Sonic-native token like USSD the first two of those collapse (`hubAsset == address`); for
  // a bridged one like sUSDS the hub asset is a distinct contract and `address` is the foreign one.
  // Sourcing funds from `hubAsset` is what `EvmAssetManagerService.depositToData` does, and it
  // sidesteps the Sonic sUSDS entry whose `address` points at Arbitrum.
  const collateral = collateralToken?.vault ?? '';
  const borrowToken = borrowTokenSel?.vault ?? '';
  const collateralHubAsset = collateralToken?.hubAsset ?? '';
  const borrowHubAsset = borrowTokenSel?.hubAsset ?? '';

  const collateralReserve = useMemo(
    () => reserves?.find(r => r.underlyingAsset.toLowerCase() === collateral.toLowerCase()),
    [reserves, collateral],
  );

  // Balances of what the user holds ON `chain`, which is not the hub unless they are on it. Keyed by
  // the token's own address, which is how useXBalances reports them.
  const xService = useXService({ xChainType: getXChainType(chain) });
  const { data: balances } = useXBalances({
    params: {
      xService,
      xChainId: chain,
      xTokens: [collateralToken, borrowTokenSel].filter((t): t is XToken => !!t),
      address: signer,
    },
  });

  const collateralBalance = balances?.[collateralToken?.address ?? ''];
  const borrowReserve = useMemo(
    () => reserves?.find(r => r.underlyingAsset.toLowerCase() === borrowToken.toLowerCase()),
    [reserves, borrowToken],
  );

  const borrowBalance = balances?.[borrowTokenSel?.address ?? ''];
  const startingDebtSide = startFrom === 'debt';
  const depositReserve = startingDebtSide ? borrowReserve : collateralReserve;
  const depositToken = startingDebtSide ? borrowTokenSel : collateralToken;
  // The amount is entered in the HELD token's decimals; the vault share is always 18.
  const depositDecimals = depositToken?.decimals ?? depositReserve?.decimals ?? 18;
  const depositHubAsset = (startingDebtSide ? borrowHubAsset : collateralHubAsset) as Address;
  const depositVault = (startingDebtSide ? borrowToken : collateral) as Address;
  /**
   * The address to fund with, as held on `chain`. On the hub that is the hub asset — the registry's
   * spoke `address` for a bridged token can point at another chain entirely (the live Sonic sUSDS
   * entry carries an Arbitrum address), and on the hub the hub asset is what the user holds anyway.
   */
  const depositTokenAddress = ((isHubChain ? depositHubAsset : depositToken?.address) ?? '') as Address;
  /** The held asset is already the reserve for a soda* selection, so there is nothing to wrap. */
  const needsWrap = !!depositHubAsset && depositHubAsset.toLowerCase() !== depositVault.toLowerCase();
  const depositBalance = startingDebtSide ? borrowBalance : collateralBalance;
  const depositSymbol = (startingDebtSide ? borrowTokenSel : collateralToken)?.symbol ?? '';

  // Opting into an eMode category replaces the reserve's own LTV and liquidation threshold, so
  // the projection has to follow the selected category rather than the reserve. Category 0 means
  // no eMode, and then the reserve's base params apply.
  const riskParams = useMemo(() => {
    const selected = eModes?.find(c => Number(c.id) === Number(eModeCategory));
    if (Number(eModeCategory) !== 0 && selected) {
      return {
        ltv: Number(selected.eMode.ltv) / 10_000,
        liquidationThreshold: Number(selected.eMode.liquidationThreshold) / 10_000,
        source: selected.eMode.label || `category ${eModeCategory}`,
      };
    }
    return {
      ltv: Number(collateralReserve?.formattedBaseLTVasCollateral ?? 0),
      liquidationThreshold: Number(collateralReserve?.formattedReserveLiquidationThreshold ?? 0),
      source: 'reserve base params',
    };
  }, [eModes, eModeCategory, collateralReserve]);

  // Leverage is collateral / equity, and the deposit *is* the equity on a fresh position, so the
  // borrow needed is simply deposit x (leverage - 1), converted into borrow-token units.
  const maxLeverage = useMemo(
    () => (riskParams.ltv > 0 && riskParams.ltv < 1 ? (1 / (1 - riskParams.ltv)) * 0.98 : 1),
    [riskParams],
  );

  // Switching to a lower-LTV category must not leave the slider above the new ceiling.
  useEffect(() => {
    setLeverage(prev => (prev > maxLeverage ? maxLeverage : prev));
  }, [maxLeverage]);

  /**
   * The leg request, in the shape the SDK sizes from. How a position is sized now lives in
   * `@sodax/sdk`'s `positionSizing`, deliberately: getting it wrong is an AAVE 36 revert after the
   * solver has already filled, and a partner integrating without this UI needs the same arithmetic.
   * This component only decides what the user typed.
   */
  const legRequest = useMemo(() => {
    if (!collateralReserve || !borrowReserve || leverage <= 1) return undefined;
    const collateralPriceUsd = Number(collateralReserve.priceInUSD);
    const borrowPriceUsd = Number(borrowReserve.priceInUSD);
    if (!(collateralPriceUsd > 0) || !(borrowPriceUsd > 0)) return undefined;
    let deposit: bigint;
    try {
      deposit = parseUnits(amount, depositDecimals);
    } catch {
      return undefined;
    }
    if (deposit <= 0n) return undefined;
    return {
      side: startingDebtSide ? 'debt' : 'collateral',
      deposit,
      depositDecimals,
      collateralPriceUsd,
      borrowPriceUsd,
      borrowDecimals: borrowReserve.decimals,
      leverage,
    } satisfies LeverageLegRequest;
  }, [collateralReserve, borrowReserve, leverage, amount, depositDecimals, startingDebtSide]);

  /** Oracle-parity figures, shown until the solver quote lands and `projection` supersedes them. */
  const quote = useMemo(() => {
    if (!legRequest) return undefined;
    const sized = sizeLeverageBorrow(legRequest);
    const collateralAfterUsd = sized.depositUsd * leverage;
    return {
      depositUsd: sized.depositUsd,
      intentInput: sized.intentInput,
      borrowTokens: Number(formatUnits(sized.borrowAmount, legRequest.borrowDecimals)),
      collateralAfterUsd,
      debtAfterUsd: sized.borrowUsd,
      ltv: collateralAfterUsd > 0 ? sized.borrowUsd / collateralAfterUsd : 0,
      hf:
        sized.borrowUsd > 0
          ? (collateralAfterUsd * riskParams.liquidationThreshold) / sized.borrowUsd
          : Number.POSITIVE_INFINITY,
    };
  }, [legRequest, leverage, riskParams]);

  const leverageInput = quote?.intentInput;

  /**
   * What the solver will really pay for that input. The floor MUST come from this rather than from
   * the oracle: the two legs do not trade at their oracle ratio, and sizing the floor as
   * `amount x leverage x (1 - slippage)` assumes 1:1 token parity, which put earlier attempts ~1.8%
   * above what the solver pays and made them unfillable — they were accepted and then FAILED.
   */
  const legQuote = useLegQuote({
    inputHubToken: isAddress(borrowToken) ? (borrowToken as Address) : undefined,
    outputHubToken: isAddress(collateral) ? (collateral as Address) : undefined,
    amount: leverageInput,
  });

  /**
   * What the position ACTUALLY looks like after the fill, priced off the solver rather than the
   * oracle — plus the floor to post and the leverage ceiling this quote supports. All from the SDK;
   * the renaming below only keeps this component's existing display shape.
   */
  const projection = useMemo(() => {
    if (!legRequest || !legQuote.data || !quote) return undefined;
    const p = projectLeverageLeg(
      legRequest,
      { quotedCollateral: legQuote.data.outputAmount, collateralDecimals: legQuote.data.outputDecimals },
      riskParams,
      slippagePct,
    );
    return {
      collateralAfterUsd: p.collateralUsd,
      debtAfterUsd: p.debtUsd,
      ltv: p.ltv,
      hf: p.healthFactor,
      haircut: p.haircut,
      usableMax: p.usableMaxLeverage,
      exceedsMaxLtv: p.exceedsMaxLtv,
      costUsd: p.costUsd,
      equityUsd: quote.depositUsd,
      minCollateralOut: p.minCollateralOut,
    };
  }, [legRequest, legQuote.data, quote, riskParams, slippagePct]);

  const minCollateralOut = projection?.minCollateralOut;

  /**
   * The vault's own view of the asset being wrapped. Read rather than assumed, because all three
   * fields can invalidate an open before it is signed: an unsupported asset, a per-asset deposit cap
   * (3e23 on sodaUSSD, 1e24 on sodaSUSDS today), and a deposit fee — a non-zero fee would mint fewer
   * shares than predicted, so the factory's pull of `initialAssets` would revert.
   */
  const { data: vaultTokenInfo } = useQuery({
    queryKey: ['leveragePositions', 'vaultTokenInfo', depositVault, depositHubAsset],
    enabled: needsWrap && !!depositVault && !!depositHubAsset,
    queryFn: () => EvmVaultTokenService.getTokenInfo(depositVault, depositHubAsset, sodax.hubProvider.publicClient),
  });

  const invalid = useMemo(() => {
    if (!owner) return 'Connect a Sonic wallet';
    if (!isAddress(collateral)) return 'Collateral is not a valid address';
    if (!isAddress(borrowToken)) return 'Borrow token is not a valid address';
    if (collateral.toLowerCase() === borrowToken.toLowerCase()) return 'Collateral and borrow token must differ';
    if (!/^\d+$/.test(eModeCategory)) return 'eMode category must be a whole number';
    try {
      const parsed = parseUnits(amount, depositDecimals);
      if (parsed <= 0n) return 'Amount must be greater than 0';
      if (depositBalance !== undefined && parsed > depositBalance)
        return `Amount exceeds your ${depositSymbol} balance`;
      // Every open is leveraged. An unlevered one would be an AAVE supply wrapped in a clone, which
      // is worth nothing over supplying directly, so it is not offered.
      if (leverage <= 1) return 'Set a leverage above 1.00x';
      if (needsWrap && vaultTokenInfo) {
        if (!vaultTokenInfo.isSupported) return `The ${depositSymbol} vault does not accept this asset`;
        if (vaultTokenInfo.depositFee !== 0n)
          return 'This vault charges a deposit fee, which this flow does not size for';
        const wrapped = EvmVaultTokenService.translateIncomingDecimals(depositDecimals, parsed);
        if (wrapped > vaultTokenInfo.maxDeposit) return `Above the ${depositSymbol} vault deposit cap`;
      }
      // Only fillable if the solver quotes the leg. Blocking here is what stops an intent going out
      // with a floor the solver cannot meet, which fails instead of filling.
      if (legQuote.isLoading) return 'Waiting for the solver quote';
      if (legQuote.error) return `Solver will not quote this leg: ${legQuote.error.message}`;
      if (!minCollateralOut) return 'No solver quote for this leg yet';
      // The pool checks this at FILL time, after the solver's collateral is supplied. Catching it here
      // is the difference between a blocked button and an intent that posts and then reverts on solve
      // with AAVE 36 — which costs the fill and tells the user nothing.
      if (projection?.exceedsMaxLtv)
        return `At ${leverage.toFixed(2)}x the solver's price leaves LTV at ${(projection.ltv * 100).toFixed(2)}%, above the ${(riskParams.ltv * 100).toFixed(2)}% max — the borrow would revert. Max at this price is about ${fmtLeverageCap(projection.usableMax)}.`;
    } catch {
      return 'Amount is not a valid number';
    }
    return undefined;
  }, [
    owner,
    collateral,
    borrowToken,
    eModeCategory,
    amount,
    depositDecimals,
    depositBalance,
    depositSymbol,
    leverage,
    legQuote.isLoading,
    legQuote.error,
    minCollateralOut,
    needsWrap,
    vaultTokenInfo,
    projection,
    riskParams,
  ]);

  /**
   * Whether the deposit still needs approving. Asked of the SDK rather than read off the token,
   * because the spender is chain-dependent — the hub wallet on Sonic, the spoke asset manager
   * elsewhere — and a chain with no allowance concept answers `true` without a call.
   */
  const { data: hasAllowance } = useQuery({
    queryKey: ['leveragePositions', 'allowance', chain, signer, depositTokenAddress, amount, depositDecimals],
    enabled: !!signer && !!depositTokenAddress,
    queryFn: async (): Promise<boolean> => {
      const parsed = parseUnits(amount || '0', depositDecimals);
      if (parsed <= 0n) return true;
      const result = await sodax.leverageYield.isPositionFundingAllowanceValid({
        srcChainKey: chain,
        srcAddress: signer as string,
        token: depositTokenAddress,
        amount: parsed,
      });
      if (!result.ok) throw result.error;
      return result.value;
    },
    // Polled, not only invalidated on demand. `approvePositionFunding` waits for the receipt now, but a
    // read served by a node that is a block behind would still report the old allowance and leave the
    // button asking for an approval the user has already given. Matches useMMAllowance's cadence.
    refetchInterval: 5000,
  });
  const needsApproval = hasAllowance === false;

  const onApprove = useCallback(async () => {
    if (!signer) return;
    setBusy('approve');
    setError(undefined);
    setStatus(undefined);
    try {
      const result = await sodax.leverageYield.approvePositionFunding({
        srcChainKey: chain,
        srcAddress: signer,
        token: depositTokenAddress,
        amount: parseUnits(amount, depositDecimals),
        walletProvider: walletProvider as GetWalletProviderType<typeof chain>,
      });
      if (!result.ok) throw result.error;
      // The SDK returns only once the approval has landed, so re-reading here sees the new allowance
      // rather than the pre-approval one — which is what used to leave the button on "Approve".
      setStatus(`Approved ${depositSymbol} (${String(result.value).slice(0, 10)}…)`);
      await queryClient.invalidateQueries({ queryKey: ['leveragePositions', 'allowance'] });
    } catch (e) {
      setError(getReadableTxError(e));
    } finally {
      setBusy(undefined);
    }
  }, [signer, sodax, chain, depositTokenAddress, amount, depositDecimals, depositSymbol, walletProvider, queryClient]);

  const onOpen = useCallback(async () => {
    if (!owner || !signer || invalid) return;
    setBusy('create');
    setError(undefined);
    setStatus(undefined);
    try {
      // `invalid` has already established the quote exists; this is the type narrowing.
      if (!leverageInput || !minCollateralOut) throw new Error('No solver quote for this leg yet');

      // The amount is what the user holds, in that token's decimals. Wrapping it into the reserve
      // and rescaling to 18 decimals happens inside the relayed batch, so nothing is converted here.
      const held = parseUnits(amount, depositDecimals);
      const funding = {
        srcChainKey: chain,
        srcAddress: signer,
        token: depositTokenAddress,
        amount: held,
        eModeCategory: Number(eModeCategory),
        minCollateralOut,
      } as const;

      const result = await openPosition({
        open: provider =>
          (startingDebtSide
            ? sodax.leverageYield.openPositionFromDebtToken({
                params: { ...funding, collateral: collateral as Address, totalInput: leverageInput },
                walletProvider: provider as GetWalletProviderType<typeof chain>,
              })
            : sodax.leverageYield.openPosition({
                params: { ...funding, borrowToken: borrowToken as Address, borrowAmount: leverageInput },
                walletProvider: provider as GetWalletProviderType<typeof chain>,
              })
          ).then(r => {
            if (!r.ok) throw r.error;
            return r.value;
          }),
        from: { amount, symbol: depositSymbol },
        to: {
          symbol: legQuote.data?.outputSymbol ?? '',
          decimals: legQuote.data?.outputDecimals ?? 18,
          quoted: legQuote.data?.outputAmount,
        },
      });
      setStatus(
        result.notified
          ? `Opened at ${leverage.toFixed(2)}x and reported to the solver — progress is below.`
          : `Opened at ${leverage.toFixed(2)}x, but the solver would not accept the intent: ${result.error}. It will expire and the deposit returns to you.`,
      );
      await queryClient.invalidateQueries({ queryKey: ['leverageYield'] });
    } catch (e) {
      setError(getReadableTxError(e));
    } finally {
      setBusy(undefined);
    }
  }, [
    owner,
    signer,
    invalid,
    sodax,
    chain,
    amount,
    depositDecimals,
    depositTokenAddress,
    depositSymbol,
    collateral,
    borrowToken,
    eModeCategory,
    startingDebtSide,
    leverageInput,
    minCollateralOut,
    leverage,
    openPosition,
    queryClient,
    legQuote.data?.outputDecimals,
    legQuote.data?.outputSymbol,
    legQuote.data?.outputAmount,
  ]);

  return (
    <Card className="w-full max-w-xl mx-auto">
      <CardHeader>
        <CardTitle className="text-lg font-bold">Create a position</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {owner && (
          <div className="rounded-md border p-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span className="text-muted-foreground">your {collateralToken?.symbol ?? 'collateral'}</span>
            <span className="text-right font-mono text-xs">
              {collateralBalance === undefined
                ? '…'
                : Number(formatUnits(collateralBalance, collateralToken?.decimals ?? 18)).toFixed(4)}
            </span>
            <span className="text-muted-foreground">your {borrowTokenSel?.symbol ?? 'debt token'}</span>
            <span className="text-right font-mono text-xs">
              {borrowBalance === undefined
                ? '…'
                : Number(formatUnits(borrowBalance, borrowTokenSel?.decimals ?? 18)).toFixed(4)}
            </span>
          </div>
        )}

        <div className="space-y-1">
          <Label>Start from</Label>
          <Tabs value={startFrom} onValueChange={v => setStartFrom(v as 'collateral' | 'debt')}>
            <TabsList className="w-full">
              <TabsTrigger className="flex-1" value="collateral">
                Collateral
              </TabsTrigger>
              <TabsTrigger className="flex-1" value="debt">
                Debt token
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="text-[10px] text-muted-foreground">
            {startingDebtSide
              ? 'You deposit the debt token; the solver delivers the collateral and the hook borrows the rest. Needs leverage above 1.00x.'
              : 'You deposit the collateral directly.'}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Collateral</Label>
            <SelectToken
              tokens={collateralTokens}
              value={collateralToken?.symbol}
              onSelect={setCollateralToken}
              className="w-full"
            />
            {collateralReserve && (
              <div className="text-[10px] text-muted-foreground">
                via {collateralReserve.symbol} · LTV {(riskParams.ltv * 100).toFixed(0)}%
              </div>
            )}
          </div>
          <div className="space-y-1">
            <Label>Borrow</Label>
            <SelectToken
              tokens={borrowTokens}
              value={borrowTokenSel?.symbol}
              onSelect={setBorrowTokenSel}
              className="w-full"
            />
            {borrowReserve && <div className="text-[10px] text-muted-foreground">via {borrowReserve.symbol}</div>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>Deposit{depositSymbol ? ` (${depositSymbol})` : ''}</Label>
              {depositBalance !== undefined && (
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:underline"
                  onClick={() => setAmount(formatUnits(depositBalance, depositDecimals))}
                >
                  balance {Number(formatUnits(depositBalance, depositDecimals)).toFixed(4)} — max
                </button>
              )}
            </div>
            <Input value={amount} onChange={e => setAmount(e.target.value)} spellCheck={false} />
          </div>
          <div className="space-y-1">
            <Label>eMode category</Label>
            <Select value={eModeCategory} onValueChange={setEModeCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">None — reserve params</SelectItem>
                {(eModes ?? []).map(c => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.eMode.label || `Category ${c.id}`} — LTV {(Number(c.eMode.ltv) / 100).toFixed(0)}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2 border-t pt-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Target leverage</Label>
            <span className="font-mono text-xs">{leverage.toFixed(2)}x</span>
          </div>
          <input
            type="range"
            className="w-full"
            min={1}
            max={Math.max(maxLeverage, 1.01)}
            step={0.01}
            value={leverage}
            onChange={e => setLeverage(Number(e.target.value))}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>1.00x (no leverage)</span>
            <span>
              max {maxLeverage.toFixed(2)}x — LTV {(riskParams.ltv * 100).toFixed(0)}% / LT{' '}
              {(riskParams.liquidationThreshold * 100).toFixed(0)}% ({riskParams.source})
            </span>
          </div>

          {quote && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <span className="text-muted-foreground">borrow</span>
              <span className="text-right font-mono text-xs">
                {quote.borrowTokens.toFixed(4)} {borrowReserve?.symbol}
              </span>
              <span className="text-muted-foreground">collateral after</span>
              <span className="text-right font-mono text-xs">
                ${(projection ?? quote).collateralAfterUsd.toFixed(2)}
              </span>
              <span className="text-muted-foreground">debt after</span>
              <span className="text-right font-mono text-xs">${quote.debtAfterUsd.toFixed(2)}</span>
              <span className="text-muted-foreground">ltv after</span>
              <span className={`text-right font-mono text-xs ${projection?.exceedsMaxLtv ? 'text-negative' : ''}`}>
                {((projection ?? quote).ltv * 100).toFixed(2)}%
                {projection?.exceedsMaxLtv && ` > ${(riskParams.ltv * 100).toFixed(2)}% max`}
              </span>
              <span className="text-muted-foreground">solver pays</span>
              <span className="text-right font-mono text-xs">
                {legQuote.isLoading
                  ? 'quoting…'
                  : legQuote.data
                    ? `${Number(formatUnits(legQuote.data.outputAmount, legQuote.data.outputDecimals)).toFixed(6)} ${legQuote.data.outputSymbol}`
                    : '—'}
              </span>
              <span className="text-muted-foreground">health factor after</span>
              <span
                className={`text-right font-mono text-xs ${(projection ?? quote).hf < 1 ? 'text-negative' : 'text-cherry-soda'}`}
              >
                {(projection ?? quote).hf.toFixed(3)}
              </span>
              {/* The solver's cut is why the numbers above are worse than deposit x leverage, and why the
                  usable ceiling is below the parity one. Shown rather than left to be inferred. */}
              {projection && (
                <>
                  <span className="text-muted-foreground">solver keeps (fee + slippage)</span>
                  <span className="text-right font-mono text-xs">{(projection.haircut * 100).toFixed(2)}%</span>
                  <span className="text-muted-foreground">max leverage at this price</span>
                  <span className="text-right font-mono text-xs">{fmtLeverageCap(projection.usableMax)}</span>
                </>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">slippage %</Label>
            <input
              type="range"
              className="flex-1"
              min={0.1}
              max={5}
              step={0.1}
              value={slippagePct}
              onChange={e => setSlippagePct(Number(e.target.value))}
            />
            <span className="font-mono text-xs w-8 text-right">{slippagePct.toFixed(1)}</span>
          </div>
        </div>

        {collateralReserve && borrowReserve && (
          <LeveragedApyPanel
            supplyApyPct={apyPctFromReserve(collateralReserve.supplyAPY)}
            borrowApyPct={apyPctFromReserve(borrowReserve.variableBorrowAPY)}
            leverage={leverage}
            collateralSymbol={collateralReserve.symbol}
            borrowSymbol={borrowReserve.symbol}
            // From 1x: the alternative to opening levered is holding the deposit unlevered, so that
            // is what the entry cost has to beat.
            breakeven={projection && { costUsd: projection.costUsd, equityUsd: projection.equityUsd, fromLeverage: 1 }}
          />
        )}

        {isWrongChain ? (
          <Button className="w-full" onClick={handleSwitchChain}>
            Switch network
          </Button>
        ) : (
          <Button className="w-full" disabled={!!invalid || !!busy} onClick={needsApproval ? onApprove : onOpen}>
            {busy === 'approve'
              ? 'Approving…'
              : busy === 'create'
                ? 'Opening…'
                : needsApproval
                  ? `Approve ${depositSymbol}`
                  : leverage > 1
                    ? `Open at ${leverage.toFixed(2)}x`
                    : 'Open position'}
          </Button>
        )}

        {invalid && <div className="text-xs text-muted-foreground">{invalid}</div>}
        {needsWrap && (
          <div className="text-[10px] text-muted-foreground">
            {depositSymbol} is wrapped into its money-market reserve inside the same batch — the deposit is pulled,
            deposited to the vault, and the resulting share opens the position. No separate wrap step, and no extra
            approval beyond the one above.
          </div>
        )}
        {!isHubChain && (
          <div className="text-[10px] text-muted-foreground">
            Opening from {chain} is relayed: you sign once there, and the deposit and the position are created together
            on the hub. That takes as long as the relay does, so the button stays busy until the hub side lands.
          </div>
        )}

        {status && <div className="text-xs text-cherry-soda break-all">{status}</div>}
        {error && <div className="text-xs text-negative break-all">{error}</div>}
        <div className="text-xs text-muted-foreground">
          eMode is fixed at creation. Category 3 (&quot;RWAStable Loop&quot;) accepts only sUSDS collateral against
          sodaUSSD, which has no borrowable liquidity yet — use 0 unless you have both.
        </div>
      </CardContent>
    </Card>
  );
}
