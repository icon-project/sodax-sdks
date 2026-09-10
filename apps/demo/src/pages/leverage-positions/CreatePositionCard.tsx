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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SelectToken } from '@/components/shared/SelectToken';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import {
  useSodaxContext,
  useReservesUsdFormat,
  useEModes,
  useXBalances,
  isNativeToken,
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
import {
  AlertTriangle,
  Coins,
  HandCoins,
  Info,
  Layers,
  ListTree,
  Receipt,
  Settings2,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { getReadableTxError } from '@/lib/utils';
import { useOpenPosition } from './useHubWalletRoute';
import { useLegQuote } from './useLegQuote';
import { LeveragedApyPanel, apyPctFromReserve } from './LeveragedApyPanel';
import {
  DetailGrid,
  DetailRow,
  Disclosure,
  InfoHint,
  Notice,
  SummaryTile,
  SummaryTiles,
  healthTone,
} from './PositionSummary';

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

/** Position sizes on this page are routinely fractions of a cent, which `.toFixed(2)` renders as $0.00. */
function fmtUsd(value: number): string {
  return `$${value > 0 && value < 1 ? value.toFixed(4) : value.toFixed(2)}`;
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

  /**
   * The address the funding is pulled from, which is what a balance has to be read against and what
   * the deposit is built from. One source for both, because they disagreed and it cost an open: the
   * balance was read from the registry `address` while the deposit rewrote it to `hubAsset`, so for
   * Sonic's native S the form showed 42 S and the batch then called
   * `wS.transferFrom(user, hubWallet, 5e18)` against a wS balance of zero. The approval was correct;
   * the revert surfaced as nothing but "External call failed".
   */
  const fundingAddressFor = useCallback(
    (token: XToken | undefined): string => {
      if (!isHubChain) return token?.address ?? '';
      // A native entry funds AS native: `EvmSpokeService.deposit` keys on the chain's own
      // `nativeToken` to send msg.value rather than an ERC-20 transferFrom, and Sonic's S carries
      // exactly that sentinel as its `address`. Rewriting that to wS asks for a token the wallet
      // does not hold. The hub-asset rewrite is for BRIDGED entries, whose `address` is foreign.
      if (token && isNativeToken(chain, token)) return token.address;
      return token?.hubAsset ?? token?.address ?? '';
    },
    [isHubChain, chain],
  );

  // Balances of what the user holds ON `chain`, which is not the hub unless they are on it. Keyed by
  // the address given here, which is how useXBalances reports them.
  const xService = useXService({ xChainType: getXChainType(chain) });
  const balanceTokens = useMemo(
    () =>
      [collateralToken, borrowTokenSel]
        .filter((t): t is XToken => !!t)
        .map(token => ({ ...token, address: fundingAddressFor(token) })),
    [collateralToken, borrowTokenSel, fundingAddressFor],
  );
  const { data: balances } = useXBalances({
    params: {
      xService,
      xChainId: chain,
      xTokens: balanceTokens,
      address: signer,
    },
  });

  const collateralBalance = balances?.[fundingAddressFor(collateralToken)];
  const borrowReserve = useMemo(
    () => reserves?.find(r => r.underlyingAsset.toLowerCase() === borrowToken.toLowerCase()),
    [reserves, borrowToken],
  );

  const borrowBalance = balances?.[fundingAddressFor(borrowTokenSel)];
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
  const depositTokenAddress = fundingAddressFor(depositToken) as Address;
  /**
   * Named when the funding token is not the one selected, which on the hub is any native entry. The
   * balance below is that token's, so the difference has to be visible rather than inferred from a
   * number that looks wrong.
   */
  const fundingSymbol = useMemo(() => {
    if (!depositToken || !depositTokenAddress) return undefined;
    if (depositTokenAddress.toLowerCase() === (depositToken.address ?? '').toLowerCase()) return undefined;
    return chainTokens.find(t => t.address.toLowerCase() === depositTokenAddress.toLowerCase())?.symbol;
  }, [chainTokens, depositToken, depositTokenAddress]);
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

  // `undefined` is NOT a ceiling of 1.00x: reserves take ~1.7s to load, and falling back to 1 meant
  // the form advertised `max 1.00x` and clamped the thumb onto the one value it rejects.
  const maxLeverage = useMemo(
    () => (riskParams.ltv > 0 && riskParams.ltv < 1 ? (1 / (1 - riskParams.ltv)) * 0.98 : undefined),
    [riskParams],
  );

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
   * How far the slider may travel. `maxLeverage` is the PARITY ceiling — what the LTV would allow if
   * the two legs traded at their oracle ratio, which they do not. The solver's price is worse, so
   * every point between `usableMaxLeverage` and the parity ceiling is a setting that posts an intent
   * and then fails the pool's LTV check at fill time. Offering that travel was an affordance for an
   * action that cannot succeed: the form read `max 19.60x` while the reachable ceiling was 7.51x.
   *
   * Kept in state rather than read straight off `projection` because the quote refetches while the
   * amount is being typed, and a ceiling that fell back to the parity one on every keystroke would
   * make the track jump under the thumb. The key it is stored under is what expires it: a priced
   * ceiling belongs to one pair at one price, so a different pair reads as no ceiling rather than
   * as the last pair's — including on the render the selection changes.
   */
  const priceKey = `${collateral}|${borrowToken}|${eModeCategory}|${startFrom}`;
  const [priced, setPriced] = useState<{ key: string; max: number }>();
  useEffect(() => {
    if (projection?.usableMax !== undefined) setPriced({ key: priceKey, max: projection.usableMax });
  }, [projection?.usableMax, priceKey]);
  const pricedMax = priced?.key === priceKey ? priced.max : undefined;

  const sliderMax = useMemo(() => {
    if (maxLeverage === undefined) return undefined;
    if (pricedMax === undefined || !Number.isFinite(pricedMax)) return maxLeverage;
    return Math.max(Math.min(maxLeverage, pricedMax), 1.01);
  }, [maxLeverage, pricedMax]);

  // Downward only, so a recovering ceiling does not yank the thumb up under the user; an unknown one
  // clamps to nothing. The seed covers a priced ceiling that really does land at or below 1.
  const [leverageTouched, setLeverageTouched] = useState(false);
  useEffect(() => {
    if (sliderMax === undefined) return;
    setLeverage(prev => {
      if (prev > sliderMax) return Number(sliderMax.toFixed(2));
      if (!leverageTouched && prev <= 1 && sliderMax > 1) return Math.min(2, sliderMax);
      return prev;
    });
  }, [sliderMax, leverageTouched]);

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

  /**
   * What is stopping the open, and WHERE to say it. The `field` tag is what lets each message render
   * against the control that caused it: "Amount exceeds your USDC balance" printed below the button,
   * three controls away from the amount it is about, was the most confusing thing on this form —
   * the button simply looked broken.
   */
  const problem = useMemo((): { field?: 'amount' | 'leverage' | 'pair'; message: string } | undefined => {
    if (!owner) return { message: 'Connect a wallet to open a position.' };
    if (!isAddress(collateral)) return { field: 'pair', message: 'Collateral is not a valid address' };
    if (!isAddress(borrowToken)) return { field: 'pair', message: 'Borrow token is not a valid address' };
    if (collateral.toLowerCase() === borrowToken.toLowerCase())
      return { field: 'pair', message: 'Collateral and borrow token must differ' };
    if (!/^\d+$/.test(eModeCategory)) return { message: 'eMode category must be a whole number' };
    try {
      const parsed = parseUnits(amount, depositDecimals);
      if (parsed <= 0n) return { field: 'amount', message: 'Enter an amount above 0' };
      if (depositBalance !== undefined && parsed > depositBalance)
        return {
          field: 'amount',
          message: `You only have ${Number(formatUnits(depositBalance, depositDecimals)).toFixed(4)} ${fundingSymbol ?? depositSymbol}`,
        };
      // Every open is leveraged. An unlevered one would be an AAVE supply wrapped in a clone, which
      // is worth nothing over supplying directly, so it is not offered.
      if (leverage <= 1) return { field: 'leverage', message: 'Set a leverage above 1.00x' };
      if (needsWrap && vaultTokenInfo) {
        if (!vaultTokenInfo.isSupported)
          return { field: 'pair', message: `The ${depositSymbol} vault does not accept this asset` };
        if (vaultTokenInfo.depositFee !== 0n)
          return { message: 'This vault charges a deposit fee, which this flow does not size for' };
        const wrapped = EvmVaultTokenService.translateIncomingDecimals(depositDecimals, parsed);
        if (wrapped > vaultTokenInfo.maxDeposit)
          return { field: 'amount', message: `Above the ${depositSymbol} vault deposit cap` };
      }
      // Only fillable if the solver quotes the leg. Blocking here is what stops an intent going out
      // with a floor the solver cannot meet, which fails instead of filling.
      if (legQuote.isLoading) return { message: 'Waiting for the solver quote…' };
      if (legQuote.error) return { message: `No solver quote for this pair: ${legQuote.error.message}` };
      if (!minCollateralOut) return { message: 'No solver quote for this pair yet' };
      // The pool checks this at FILL time, after the solver's collateral is supplied. Catching it here
      // is the difference between a blocked button and an intent that posts and then reverts on solve
      // with AAVE 36 — which costs the fill and tells the user nothing.
      if (projection?.exceedsMaxLtv)
        return {
          field: 'leverage',
          message: `Too high for this quote. It would land at ${(projection.ltv * 100).toFixed(1)}% LTV against a ${(riskParams.ltv * 100).toFixed(0)}% max. Try ${fmtLeverageCap(projection.usableMax)} or lower.`,
        };
    } catch {
      return { field: 'amount', message: 'Not a valid number' };
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
    fundingSymbol,
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
    if (!owner || !signer || problem) return;
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
      });
      setStatus(
        result.notified
          ? `Opened at ${leverage.toFixed(2)}x. It appears below once a solver fills it.`
          : `Opened at ${leverage.toFixed(2)}x, but the solver rejected the notification: ${result.error}. It will expire and refund the deposit.`,
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
    problem,
    sodax,
    chain,
    amount,
    depositDecimals,
    depositTokenAddress,
    collateral,
    borrowToken,
    eModeCategory,
    startingDebtSide,
    leverageInput,
    minCollateralOut,
    leverage,
    openPosition,
    queryClient,
  ]);

  /** Solver-priced when the quote is in, oracle-parity until then; the tiles read the same either way. */
  const outcome = projection ?? quote;
  const costPct =
    projection && projection.equityUsd > 0 ? (projection.costUsd / projection.equityUsd) * 100 : undefined;
  const health = outcome ? healthTone(outcome.hf) : undefined;
  const eModeLabel =
    eModeCategory === '0'
      ? 'no eMode'
      : (eModes?.find(c => String(c.id) === eModeCategory)?.eMode.label ?? `category ${eModeCategory}`);
  const cappedByPrice =
    maxLeverage !== undefined && pricedMax !== undefined && Number.isFinite(pricedMax) && pricedMax < maxLeverage;

  return (
    <Card className="w-full max-w-xl mx-auto">
      <CardHeader>
        <CardTitle className="text-lg font-bold">Open position</CardTitle>
        <CardDescription>Choose the pair, deposit, and leverage. Review risk before opening.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* ---- What the position is. Two tokens and a size; nothing derived. ---- */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="flex items-center gap-1">
              <Coins className="h-3 w-3" />
              Collateral
              <InfoHint>Asset the position holds. It earns supply yield and sets the leverage limit.</InfoHint>
            </Label>
            <SelectToken
              tokens={collateralTokens}
              value={collateralToken?.symbol}
              onSelect={setCollateralToken}
              className="w-full"
            />
          </div>
          <div className="space-y-1">
            <Label className="flex items-center gap-1">
              <HandCoins className="h-3 w-3" />
              Borrow
              <InfoHint>Asset the position borrows. Its rate is the ongoing leverage cost.</InfoHint>
            </Label>
            <SelectToken
              tokens={borrowTokens}
              value={borrowTokenSel?.symbol}
              onSelect={setBorrowTokenSel}
              className="w-full"
            />
          </div>
        </div>
        {problem?.field === 'pair' && (
          <Notice tone="danger" icon={AlertTriangle}>
            {problem.message}
          </Notice>
        )}

        {/* ---- Your money in. The balance doubles as the max button, as before. ---- */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label>Deposit{fundingSymbol || depositSymbol ? ` (${fundingSymbol ?? depositSymbol})` : ''}</Label>
            {depositBalance !== undefined && (
              <button
                type="button"
                className="text-[10px] text-muted-foreground hover:underline"
                onClick={() => setAmount(formatUnits(depositBalance, depositDecimals))}
              >
                Use max: {Number(formatUnits(depositBalance, depositDecimals)).toFixed(4)}{' '}
                {fundingSymbol ?? depositSymbol}
              </button>
            )}
          </div>
          <Input value={amount} onChange={e => setAmount(e.target.value)} spellCheck={false} />
          {startingDebtSide && (
            <div className="text-[10px] text-muted-foreground">
              You fund with the debt token. The solver supplies {collateralToken?.symbol ?? 'collateral'} on fill.
            </div>
          )}
          {fundingSymbol && (
            <Notice icon={Info}>
              {depositSymbol} is funded as {fundingSymbol} on this chain — wrap it first if the balance reads zero.
            </Notice>
          )}
          {problem?.field === 'amount' && (
            <Notice tone="danger" icon={AlertTriangle}>
              {problem.message}
            </Notice>
          )}
        </div>

        {/* ---- Leverage. The track stops where the solver's price stops. ---- */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              Leverage
              <InfoHint>Position value divided by your deposit. At 2.00x, half the position is borrowed.</InfoHint>
            </Label>
            <span className="font-mono text-sm">{leverage.toFixed(2)}x</span>
          </div>
          <input
            type="range"
            className="w-full disabled:opacity-50"
            min={1}
            max={sliderMax === undefined ? 2 : Math.max(sliderMax, 1.01)}
            step={0.01}
            value={leverage}
            disabled={sliderMax === undefined}
            onChange={e => {
              setLeverageTouched(true);
              setLeverage(Number(e.target.value));
            }}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>1.00x</span>
            <span className="flex items-center gap-1">
              {sliderMax === undefined ? 'reading pool limits…' : `max ${fmtLeverageCap(sliderMax)}`}
              {cappedByPrice && maxLeverage !== undefined && (
                <InfoHint>
                  Capped by the current solver quote. The oracle LTV alone would allow {maxLeverage.toFixed(2)}x, but
                  that may fail at fill time.
                </InfoHint>
              )}
            </span>
          </div>
          {problem?.field === 'leverage' && (
            <Notice tone="danger" icon={AlertTriangle}>
              {problem.message}
            </Notice>
          )}
        </div>

        {/* ---- The three numbers the decision actually turns on. ---- */}
        <SummaryTiles>
          <SummaryTile
            icon={Layers}
            label="Position value"
            value={outcome ? fmtUsd(outcome.collateralAfterUsd) : '—'}
            hint={collateralReserve?.symbol ? `${collateralReserve.symbol} after fill` : undefined}
            emphasis
            info="Estimated collateral after the solver fills, net of the opening spread."
          />
          <SummaryTile
            icon={ShieldCheck}
            label="Health"
            value={outcome ? outcome.hf.toFixed(2) : '—'}
            hint={health?.label}
            className={health?.className}
            tone={health?.tone}
            info="Liquidation happens below 1.00. Higher is safer; more leverage pushes it down."
          />
          <SummaryTile
            icon={Receipt}
            label="Open cost"
            value={projection ? fmtUsd(projection.costUsd) : legQuote.isLoading ? '…' : '—'}
            hint={costPct !== undefined ? `${costPct.toFixed(2)}% of deposit` : undefined}
            info="Estimated solver spread on the opening leg. Closing pays a similar spread."
          />
        </SummaryTiles>

        {/* ---- Anything blocking the button, said before the button. ---- */}
        {problem && !problem.field && (
          <Notice tone="danger" icon={AlertTriangle}>
            {problem.message}
          </Notice>
        )}
        {!isHubChain && (
          <Notice tone="warn" icon={AlertTriangle}>
            <span className="font-medium">Experimental from {chain}.</span> Opening is covered by tests, but returns to
            this chain are not mainnet-proven yet. Sonic is the safest path.
          </Notice>
        )}

        {isWrongChain ? (
          <Button className="w-full" onClick={handleSwitchChain}>
            Switch network
          </Button>
        ) : (
          <Button className="w-full" disabled={!!problem || !!busy} onClick={needsApproval ? onApprove : onOpen}>
            {busy === 'approve'
              ? 'Approving…'
              : busy === 'create'
                ? 'Opening…'
                : needsApproval
                  ? `Approve ${depositSymbol}`
                  : `Open at ${leverage.toFixed(2)}x`}
          </Button>
        )}

        {status && <div className="text-xs text-cherry-soda break-all">{status}</div>}
        {error && <div className="text-xs text-negative break-all">{error}</div>}

        {/* ---- Everything below is folded. Each header keeps its values visible while collapsed. ---- */}
        <Disclosure icon={Settings2} title="Advanced" summary={`${eModeLabel}, ${slippagePct.toFixed(1)}% slippage`}>
          <div className="space-y-1">
            <Label className="text-xs">Fund with</Label>
            <Tabs value={startFrom} onValueChange={v => setStartFrom(v as 'collateral' | 'debt')}>
              <TabsList className="w-full">
                <TabsTrigger className="flex-1" value="collateral">
                  {collateralToken?.symbol ?? 'Collateral'}
                </TabsTrigger>
                <TabsTrigger className="flex-1" value="debt">
                  {borrowTokenSel?.symbol ?? 'Debt token'}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="text-[10px] text-muted-foreground">
              {startingDebtSide
                ? 'Deposit the debt token; the solver supplies collateral when the intent fills.'
                : 'You deposit the collateral directly.'}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="flex items-center gap-1 text-xs">
              eMode category
              <InfoHint>Raises the leverage limit for related assets. Fixed after the position opens.</InfoHint>
            </Label>
            <Select value={eModeCategory} onValueChange={setEModeCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">None (reserve defaults)</SelectItem>
                {(eModes ?? []).map(c => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.eMode.label || `Category ${c.id}`} — LTV {(Number(c.eMode.ltv) / 100).toFixed(0)}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Label className="flex items-center gap-1 whitespace-nowrap text-xs">
              Max slippage
              <InfoHint>Sets the minimum fill amount. Tighter is safer; looser is easier to fill.</InfoHint>
            </Label>
            <input
              type="range"
              className="flex-1"
              min={0.1}
              max={5}
              step={0.1}
              value={slippagePct}
              onChange={e => setSlippagePct(Number(e.target.value))}
            />
            <span className="w-8 text-right font-mono text-xs">{slippagePct.toFixed(1)}</span>
          </div>
        </Disclosure>

        {quote && (
          <Disclosure
            icon={ListTree}
            title="Quote details"
            summary={`${quote.borrowTokens.toFixed(4)} ${borrowReserve?.symbol ?? ''} borrowed`}
          >
            <DetailGrid>
              <DetailRow
                label="Borrow amount"
                value={`${quote.borrowTokens.toFixed(4)} ${borrowReserve?.symbol ?? ''}`}
              />
              <DetailRow label="Debt after" value={fmtUsd(quote.debtAfterUsd)} />
              <DetailRow
                label="LTV after"
                value={`${((projection ?? quote).ltv * 100).toFixed(2)}% of ${(riskParams.ltv * 100).toFixed(0)}%`}
                className={projection?.exceedsMaxLtv ? 'text-negative' : ''}
                info={`Debt over collateral. The ceiling comes from ${riskParams.source}.`}
              />
              <DetailRow
                label="Solver pays"
                value={
                  legQuote.isLoading
                    ? 'quoting…'
                    : legQuote.data
                      ? `${Number(formatUnits(legQuote.data.outputAmount, legQuote.data.outputDecimals)).toFixed(6)} ${legQuote.data.outputSymbol}`
                      : '—'
                }
                info="Current quote for the borrowed leg. The intent floor is sized from this, not the oracle."
              />
              {projection && (
                <>
                  <DetailRow
                    label="Solver keeps"
                    value={`${(projection.haircut * 100).toFixed(2)}%`}
                    info="Fee plus slippage, as a share of the borrowed leg."
                  />
                  <DetailRow
                    label="Max at quote"
                    value={fmtLeverageCap(projection.usableMax)}
                    info={
                      maxLeverage === undefined
                        ? 'The highest leverage the current solver quote supports.'
                        : `LTV alone allows ${maxLeverage.toFixed(2)}x; the solver quote brings it down to this.`
                    }
                  />
                </>
              )}
              <DetailRow
                label="Collateral reserve"
                value={collateralReserve?.symbol ?? '—'}
                info="The hub money-market reserve the position holds."
              />
              <DetailRow label="Debt reserve" value={borrowReserve?.symbol ?? '—'} />
            </DetailGrid>
            {needsWrap && (
              <Notice>
                {depositSymbol} is wrapped into its money-market reserve in the same batch. No separate wrap step.
              </Notice>
            )}
          </Disclosure>
        )}

        {collateralReserve && borrowReserve && (
          <Disclosure icon={TrendingUp} title="Yield model" summary="rates and break-even">
            <LeveragedApyPanel
              embedded
              supplyApyPct={apyPctFromReserve(collateralReserve.supplyAPY)}
              borrowApyPct={apyPctFromReserve(borrowReserve.variableBorrowAPY)}
              leverage={leverage}
              collateralSymbol={collateralReserve.symbol}
              borrowSymbol={borrowReserve.symbol}
              // From 1x: the alternative to opening levered is holding the deposit unlevered, so that
              // is what the entry cost has to beat.
              breakeven={
                projection && { costUsd: projection.costUsd, equityUsd: projection.equityUsd, fromLeverage: 1 }
              }
            />
          </Disclosure>
        )}

        <Notice>
          eMode is fixed after opening. Category 3 only works for sUSDS collateral against sodaUSSD; use None for other
          pairs.
        </Notice>
      </CardContent>
    </Card>
  );
}
