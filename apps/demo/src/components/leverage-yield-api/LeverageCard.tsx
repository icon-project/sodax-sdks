import { SelectChain } from '@/components/swaps-api/SelectChain';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatMutationFailureMessage } from '@/lib/utils';
import { parseUnits } from 'viem';
import type {
  CreateDepositIntentParamsV2,
  CreateWithdrawIntentParamsV2,
  LeverageVaultV2,
  LeverageYieldDepositQuoteRequestV2,
  LeverageYieldWithdrawQuoteRequestV2,
  SpokeChainKey,
  SubmitTxRequestV2,
  XToken,
} from '@sodax/dapp-kit';
import { Loader2 } from 'lucide-react';
import React, { type SetStateAction, useMemo, useState } from 'react';
import {
  ChainKeys,
  getSupportedSolverTokens,
  useSodaxContext,
  useLeverageYieldApiAllowance,
  useLeverageYieldApiApprove,
  useLeverageYieldApiCreateDepositIntent,
  useLeverageYieldApiCreateWithdrawIntent,
  useLeverageYieldApiDeadline,
  useLeverageYieldApiDepositQuote,
  useLeverageYieldApiEffectiveApr,
  useLeverageYieldApiPosition,
  useLeverageYieldApiShareBalance,
  useLeverageYieldApiTotalAssets,
  useLeverageYieldApiVaults,
  useLeverageYieldApiWithdrawQuote,
  useLeverageYieldApiSubmitTx,
} from '@sodax/dapp-kit';
import { getXChainType, useEvmSwitchChain, useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';
import type { LeverageYieldApiOrder } from '@/components/leverage-yield-api/OrderStatus';
import { LEVERAGE_YIELD_API_CONFIG } from '@/components/leverage-yield-api/lib/config';
import { toIntentRequest } from '@/components/swaps-api/lib/mappers';
import {
  isSignableSwapsApiChain,
  signAndBroadcastSwapsApiTx,
  waitForTxFinality,
} from '@/components/swaps-api/lib/signAndBroadcast';
import { useDebouncedValue } from '@/components/swaps-api/lib/useDebouncedValue';

/** Vault-share decimals (lsoda* ERC-4626 shares are always 18 decimals). */
const SHARE_DECIMALS = 18;

/** `(100 - slippage)%` of `quotedAmount`, in bps to avoid float drift. */
function applySlippageMinOut(quotedAmount: string, slippagePct: string): string {
  const bps = BigInt(Math.round(Math.max(0, 100 - Number(slippagePct)) * 100));
  return ((BigInt(quotedAmount) * bps) / 10_000n).toString();
}

/** RAY (1e27 = 100%) → display percent. */
function formatRayPct(ray: string | undefined): string {
  if (ray === undefined) return '—';
  return `${(Number(ray) / 1e25).toFixed(2)}%`;
}

/** A token dropdown backed by the solver-supported token list for a chain. */
function SelectToken({
  tokens,
  value,
  onSelect,
  id,
  label,
}: {
  tokens: readonly XToken[];
  value: string;
  onSelect: (token: XToken) => void;
  id?: string;
  label?: string;
}) {
  return (
    <div className="space-y-2">
      {label && <Label htmlFor={id}>{label}</Label>}
      <Select
        value={value}
        onValueChange={address => {
          const token = tokens.find(t => t.address === address);
          if (token) onSelect(token);
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder="Select token" />
        </SelectTrigger>
        <SelectContent>
          {tokens.map(token => (
            <SelectItem key={token.address} value={token.address}>
              {token.symbol}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Leverage Yield API card. Every quote/allowance/intent/relay decision is delegated to the
 * `useLeverageYieldApi*` hooks (the backend `sodax.api.leverageYield.*` client); the only
 * client-side steps are allowance signing, sign-and-broadcast, and minor utils. Mirrors the
 * swaps-api `SwapCard`, focused on the EVM/wallet-signable path.
 */
export default function LeverageCard({
  setOrders,
}: {
  setOrders: (value: SetStateAction<LeverageYieldApiOrder[]>) => void;
}) {
  const { sodax } = useSodaxContext();
  const apiConfig = LEVERAGE_YIELD_API_CONFIG;
  const supportedChains = useMemo(() => sodax.config.getSupportedSpokeChains() as string[], [sodax]);

  const [slippage, setSlippage] = useState<string>('0.5');

  // ── Vault registry ──
  const { data: vaults } = useLeverageYieldApiVaults({ params: { apiConfig } });
  const [vaultName, setVaultName] = useState<string>('');
  const selectedVault: LeverageVaultV2 | undefined = useMemo(
    () => vaults?.find(v => v.name === vaultName),
    [vaults, vaultName],
  );

  // ── Vault info panel ──
  const { data: effectiveApr } = useLeverageYieldApiEffectiveApr({ params: { vault: selectedVault?.vault, apiConfig } });
  const { data: position } = useLeverageYieldApiPosition({ params: { vault: selectedVault?.vault, apiConfig } });
  const { data: totalAssets } = useLeverageYieldApiTotalAssets({ params: { vault: selectedVault?.vault, apiConfig } });

  const { data: deadlineData, refetch: refetchDeadline } = useLeverageYieldApiDeadline({ params: { apiConfig } });

  // ══════════════════════════════ DEPOSIT ══════════════════════════════
  const [depositChain, setDepositChain] = useState<string>(ChainKeys.ARBITRUM_MAINNET);
  const depositTokens = useMemo(
    () => (depositChain ? getSupportedSolverTokens(depositChain as SpokeChainKey) : []),
    [depositChain],
  );
  const [depositToken, setDepositToken] = useState<XToken | undefined>(undefined);
  const [depositAmount, setDepositAmount] = useState<string>('');
  const debouncedDepositAmount = useDebouncedValue(depositAmount);

  const depositAccount = useXAccount({ xChainId: depositChain as SpokeChainKey });
  const depositWalletProvider = useWalletProvider({ xChainId: depositChain as SpokeChainKey });
  const { isWrongChain: isDepositWrongChain, handleSwitchChain: handleDepositSwitchChain } = useEvmSwitchChain({
    xChainId: depositChain as SpokeChainKey,
  });

  const depositQuoteBody: LeverageYieldDepositQuoteRequestV2 | undefined = useMemo(() => {
    if (!selectedVault || !depositToken || !debouncedDepositAmount || Number(debouncedDepositAmount) <= 0) {
      return undefined;
    }
    return {
      vault: selectedVault.vault,
      tokenSrc: depositToken.address,
      tokenSrcChainKey: depositChain,
      amount: parseUnits(debouncedDepositAmount, depositToken.decimals).toString(),
      quoteType: 'exact_input',
    };
  }, [selectedVault, depositToken, debouncedDepositAmount, depositChain]);

  const { data: depositQuote, isFetching: isDepositQuoting } = useLeverageYieldApiDepositQuote({
    params: { body: depositQuoteBody, apiConfig },
  });

  const depositIntentParams: CreateDepositIntentParamsV2 | undefined = useMemo(() => {
    if (!selectedVault || !depositToken || !depositAccount.address || !depositQuote?.quotedAmount) return undefined;
    return {
      vault: selectedVault.vault,
      srcChainKey: depositChain,
      srcAddress: depositAccount.address,
      inputToken: depositToken.address,
      inputAmount: parseUnits(debouncedDepositAmount, depositToken.decimals).toString(),
      minOutputAmount: applySlippageMinOut(depositQuote.quotedAmount, slippage),
      deadline: deadlineData?.deadline,
    };
  }, [
    selectedVault,
    depositToken,
    depositAccount.address,
    depositQuote,
    depositChain,
    debouncedDepositAmount,
    slippage,
    deadlineData,
  ]);

  const { data: allowance, refetch: refetchAllowance } = useLeverageYieldApiAllowance({
    params: { body: depositIntentParams, apiConfig },
  });
  const hasAllowed = allowance?.valid === true;

  const { data: shareBalance } = useLeverageYieldApiShareBalance({
    params: { vault: selectedVault?.vault, owner: depositAccount.address, apiConfig },
  });

  const { mutateAsyncSafe: approve } = useLeverageYieldApiApprove();
  const { mutateAsyncSafe: createDepositIntent } = useLeverageYieldApiCreateDepositIntent();
  const { mutateAsyncSafe: submitTx } = useLeverageYieldApiSubmitTx();

  const [isApproving, setIsApproving] = useState(false);
  const [isDepositing, setIsDepositing] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);

  const handleApprove = async (): Promise<void> => {
    if (!depositIntentParams || !depositWalletProvider) return;
    setDepositError(null);
    setIsApproving(true);
    try {
      const result = await approve({ body: depositIntentParams, apiConfig });
      if (!result.ok) {
        setDepositError(formatMutationFailureMessage(result.error, 'Approve failed'));
        return;
      }
      const txHash = await signAndBroadcastSwapsApiTx({
        chainKey: depositChain as SpokeChainKey,
        tx: result.value.tx,
        walletProvider: depositWalletProvider,
      });
      await waitForTxFinality(depositChain as SpokeChainKey, depositWalletProvider, txHash);
      await refetchAllowance();
    } catch (error) {
      setDepositError(formatMutationFailureMessage(error, 'Approve signing failed'));
    } finally {
      setIsApproving(false);
    }
  };

  const handleDeposit = async (): Promise<void> => {
    if (!depositIntentParams || !depositWalletProvider || !depositAccount.address) return;
    setDepositError(null);
    setIsDepositing(true);
    try {
      // 1. The API builds the unsigned deposit create-intent tx + intent + relay data.
      const created = await createDepositIntent({ body: depositIntentParams, apiConfig });
      if (!created.ok) {
        setDepositError(formatMutationFailureMessage(created.error, 'Create deposit intent failed'));
        return;
      }
      const { tx, intent, relayData } = created.value;

      // 2. Sign + broadcast on the source chain.
      const spokeTxHash = await signAndBroadcastSwapsApiTx({
        chainKey: depositChain as SpokeChainKey,
        tx,
        walletProvider: depositWalletProvider,
      });

      // 3. Hand the tx back to the API for relay + solver post-execution.
      const request: SubmitTxRequestV2 = {
        txHash: spokeTxHash,
        srcChainKey: depositChain,
        walletAddress: depositAccount.address,
        intent: toIntentRequest(intent),
        relayData: relayData.payload,
      };
      const submitted = await submitTx({ request, apiConfig });
      if (!submitted.ok) {
        setDepositError(formatMutationFailureMessage(submitted.error, 'Submit tx failed'));
        return;
      }
      setOrders(prev => [
        ...prev,
        { txHash: spokeTxHash, srcChainKey: depositChain, apiBaseURL: apiConfig.baseURL, kind: 'deposit' },
      ]);
    } catch (error) {
      setDepositError(formatMutationFailureMessage(error, 'Deposit signing failed'));
    } finally {
      setIsDepositing(false);
    }
  };

  // ══════════════════════════════ WITHDRAW ══════════════════════════════
  const [withdrawSignChain, setWithdrawSignChain] = useState<string>(ChainKeys.ARBITRUM_MAINNET);
  const [withdrawDstChain, setWithdrawDstChain] = useState<string>(ChainKeys.ARBITRUM_MAINNET);
  const withdrawTokens = useMemo(
    () => (withdrawDstChain ? getSupportedSolverTokens(withdrawDstChain as SpokeChainKey) : []),
    [withdrawDstChain],
  );
  const [withdrawToken, setWithdrawToken] = useState<XToken | undefined>(undefined);
  const [withdrawShares, setWithdrawShares] = useState<string>('');
  const debouncedWithdrawShares = useDebouncedValue(withdrawShares);

  const withdrawSignAccount = useXAccount({ xChainId: withdrawSignChain as SpokeChainKey });
  const withdrawSignWalletProvider = useWalletProvider({ xChainId: withdrawSignChain as SpokeChainKey });
  const withdrawDstAccount = useXAccount({ xChainId: withdrawDstChain as SpokeChainKey });
  const { isWrongChain: isWithdrawWrongChain, handleSwitchChain: handleWithdrawSwitchChain } = useEvmSwitchChain({
    xChainId: withdrawSignChain as SpokeChainKey,
  });

  const withdrawQuoteBody: LeverageYieldWithdrawQuoteRequestV2 | undefined = useMemo(() => {
    if (!selectedVault || !withdrawToken || !withdrawSignChain || Number(debouncedWithdrawShares) <= 0) return undefined;
    return {
      vault: selectedVault.vault,
      srcChainKey: withdrawSignChain,
      tokenDst: withdrawToken.address,
      tokenDstChainKey: withdrawDstChain,
      amount: parseUnits(debouncedWithdrawShares, SHARE_DECIMALS).toString(),
      quoteType: 'exact_input',
    };
  }, [selectedVault, withdrawToken, withdrawSignChain, withdrawDstChain, debouncedWithdrawShares]);

  const { data: withdrawQuote, isFetching: isWithdrawQuoting } = useLeverageYieldApiWithdrawQuote({
    params: { body: withdrawQuoteBody, apiConfig },
  });

  const withdrawIntentParams: CreateWithdrawIntentParamsV2 | undefined = useMemo(() => {
    if (!selectedVault || !withdrawToken || !withdrawSignAccount.address || !withdrawDstAccount.address) return undefined;
    if (!withdrawQuote?.quotedAmount) return undefined;
    return {
      vault: selectedVault.vault,
      srcChainKey: withdrawSignChain,
      srcAddress: withdrawSignAccount.address,
      dstChainKey: withdrawDstChain,
      outputToken: withdrawToken.address,
      inputAmount: parseUnits(debouncedWithdrawShares, SHARE_DECIMALS).toString(),
      minOutputAmount: applySlippageMinOut(withdrawQuote.quotedAmount, slippage),
      recipient: withdrawDstAccount.address,
      deadline: deadlineData?.deadline,
    };
  }, [
    selectedVault,
    withdrawToken,
    withdrawSignAccount.address,
    withdrawDstAccount.address,
    withdrawQuote,
    withdrawSignChain,
    withdrawDstChain,
    debouncedWithdrawShares,
    slippage,
    deadlineData,
  ]);

  const { mutateAsyncSafe: createWithdrawIntent } = useLeverageYieldApiCreateWithdrawIntent();
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const handleWithdraw = async (): Promise<void> => {
    if (!withdrawIntentParams || !withdrawSignWalletProvider || !withdrawSignAccount.address) return;
    setWithdrawError(null);
    setIsWithdrawing(true);
    try {
      // Refresh the deadline just before building so the intent isn't already expired.
      await refetchDeadline();
      const created = await createWithdrawIntent({ body: withdrawIntentParams, apiConfig });
      if (!created.ok) {
        setWithdrawError(formatMutationFailureMessage(created.error, 'Create withdraw intent failed'));
        return;
      }
      const { tx, intent, relayData } = created.value;

      const spokeTxHash = await signAndBroadcastSwapsApiTx({
        chainKey: withdrawSignChain as SpokeChainKey,
        tx,
        walletProvider: withdrawSignWalletProvider,
      });

      const request: SubmitTxRequestV2 = {
        txHash: spokeTxHash,
        srcChainKey: withdrawSignChain,
        walletAddress: withdrawSignAccount.address,
        intent: toIntentRequest(intent),
        relayData: relayData.payload,
      };
      const submitted = await submitTx({ request, apiConfig });
      if (!submitted.ok) {
        setWithdrawError(formatMutationFailureMessage(submitted.error, 'Submit tx failed'));
        return;
      }
      setOrders(prev => [
        ...prev,
        { txHash: spokeTxHash, srcChainKey: withdrawSignChain, apiBaseURL: apiConfig.baseURL, kind: 'withdraw' },
      ]);
    } catch (error) {
      setWithdrawError(formatMutationFailureMessage(error, 'Withdraw signing failed'));
    } finally {
      setIsWithdrawing(false);
    }
  };

  const depositSignable = !depositChain || isSignableSwapsApiChain(depositChain as SpokeChainKey) || getXChainType(depositChain as SpokeChainKey) === 'EVM';
  const withdrawSignable = !withdrawSignChain || isSignableSwapsApiChain(withdrawSignChain as SpokeChainKey);

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>Leverage Yield API</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Vault selector + info */}
        <div className="space-y-2">
          <Label htmlFor="vault">Vault</Label>
          <Select value={vaultName} onValueChange={setVaultName}>
            <SelectTrigger id="vault">
              <SelectValue placeholder="Select a leverage vault" />
            </SelectTrigger>
            <SelectContent>
              {(vaults ?? []).map(v => (
                <SelectItem key={v.name} value={v.name}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedVault && (
          <div className="rounded-md border p-3 text-sm space-y-1">
            <div>Effective APR: {formatRayPct(effectiveApr?.effectiveNetAprRay)}</div>
            <div>Total Assets: {totalAssets?.totalAssets ?? '—'}</div>
            {position && (
              <>
                <div>LTV: {(Number(position.ltv) / 100).toFixed(2)}%</div>
                <div>Health Factor (WAD): {position.healthFactor}</div>
              </>
            )}
            <div>Your Shares: {shareBalance?.balance ?? '—'}</div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="slippage">Slippage (%)</Label>
          <Input id="slippage" value={slippage} onChange={e => setSlippage(e.target.value)} />
        </div>

        <Tabs defaultValue="deposit">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="deposit">Deposit</TabsTrigger>
            <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
          </TabsList>

          {/* ── DEPOSIT ── */}
          <TabsContent value="deposit" className="space-y-4">
            <SelectChain
              chainList={supportedChains}
              value={depositChain}
              setChain={c => {
                setDepositChain(c);
                setDepositToken(undefined);
              }}
              placeholder="Source chain"
              id="deposit-chain"
              label="Source chain"
            />
            <SelectToken
              tokens={depositTokens}
              value={depositToken?.address ?? ''}
              onSelect={setDepositToken}
              id="deposit-token"
              label="Input token"
            />
            <div className="space-y-2">
              <Label htmlFor="deposit-amount">Amount</Label>
              <Input
                id="deposit-amount"
                value={depositAmount}
                onChange={e => setDepositAmount(e.target.value)}
                placeholder="0.0"
              />
            </div>
            <div className="text-sm text-muted-foreground">
              Quoted shares: {isDepositQuoting ? 'quoting…' : (depositQuote?.quotedAmount ?? '—')}
            </div>
            {depositError && <div className="text-red-500 text-sm">{depositError}</div>}
          </TabsContent>

          {/* ── WITHDRAW ── */}
          <TabsContent value="withdraw" className="space-y-4">
            <SelectChain
              chainList={supportedChains}
              value={withdrawSignChain}
              setChain={setWithdrawSignChain}
              placeholder="Sign chain (hub-wallet source)"
              id="withdraw-sign-chain"
              label="Sign chain"
            />
            <SelectChain
              chainList={supportedChains}
              value={withdrawDstChain}
              setChain={c => {
                setWithdrawDstChain(c);
                setWithdrawToken(undefined);
              }}
              placeholder="Destination chain"
              id="withdraw-dst-chain"
              label="Destination chain"
            />
            <SelectToken
              tokens={withdrawTokens}
              value={withdrawToken?.address ?? ''}
              onSelect={setWithdrawToken}
              id="withdraw-token"
              label="Output token"
            />
            <div className="space-y-2">
              <Label htmlFor="withdraw-shares">Shares (lsoda*, 18 decimals)</Label>
              <Input
                id="withdraw-shares"
                value={withdrawShares}
                onChange={e => setWithdrawShares(e.target.value)}
                placeholder="0.0"
              />
            </div>
            <div className="text-sm text-muted-foreground">
              Quoted output: {isWithdrawQuoting ? 'quoting…' : (withdrawQuote?.quotedAmount ?? '—')}
            </div>
            {withdrawError && <div className="text-red-500 text-sm">{withdrawError}</div>}
          </TabsContent>
        </Tabs>
      </CardContent>

      <CardFooter className="flex flex-col gap-2">
        {/* Deposit actions */}
        {isDepositWrongChain ? (
          <Button className="w-full" onClick={handleDepositSwitchChain}>
            Switch network
          </Button>
        ) : (
          <>
            {!hasAllowed && depositIntentParams && (
              <Button className="w-full" onClick={handleApprove} disabled={isApproving || !depositSignable}>
                {isApproving ? <Loader2 className="animate-spin" /> : 'Approve (deposit)'}
              </Button>
            )}
            <Button
              className="w-full"
              onClick={handleDeposit}
              disabled={!depositIntentParams || !hasAllowed || isDepositing || !depositSignable}
            >
              {isDepositing ? <Loader2 className="animate-spin" /> : 'Deposit'}
            </Button>
          </>
        )}

        {/* Withdraw actions */}
        {isWithdrawWrongChain ? (
          <Button className="w-full" onClick={handleWithdrawSwitchChain}>
            Switch network (withdraw)
          </Button>
        ) : (
          <Button
            className="w-full"
            onClick={handleWithdraw}
            disabled={!withdrawIntentParams || isWithdrawing || !withdrawSignable}
          >
            {isWithdrawing ? <Loader2 className="animate-spin" /> : 'Withdraw'}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
