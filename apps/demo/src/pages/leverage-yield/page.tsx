/**
 * Leverage Yield demo page — swap-style deposit/withdraw.
 *
 * Treats lsoda* tokens (leverage-vault shares) as just-another-tradeable-token via the
 * Sodax solver. So:
 *   - Deposit  = swap (any token, any chain) → lsoda* on Sonic
 *   - Withdraw = swap lsoda* on Sonic → (any token, any chain)
 *
 * No bespoke leverage-yield orchestration needed — the solver routes through whichever
 * AMM has lsoda* liquidity. Legacy `xdeposit`/`xwithdraw` SDK methods still exist for
 * direct deposit/withdraw against the vault.asset() but aren't exposed here.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChainSelector } from '@/components/shared/ChainSelector';
import {
  useBackendSubmitSwapTx,
  useQuote,
  useSodaxContext,
  useSwapAllowance,
  useSwapApprove,
  useXBalances,
} from '@sodax/dapp-kit';
import OrderStatus, { type Order } from '@/components/swaps/OrderStatus';
import {
  getXChainType,
  useEvmSwitchChain,
  useWalletProvider,
  useXAccount,
  useXService,
} from '@sodax/wallet-sdk-react';
import {
  ChainKeys,
  getSupportedSolverTokens,
  type CreateIntentParams,
  type LeverageYieldVault,
  type SolverIntentQuoteRequest,
  type SpokeChainKey,
  type SubmitSwapTxRequest,
  type SwapIntentData,
  type XToken,
} from '@sodax/sdk';
import { ArrowDownUp } from 'lucide-react';
import BigNumber from 'bignumber.js';
import { formatUnits, parseUnits } from 'viem';
import { SolverEnv, useAppStore } from '@/zustand/useAppStore';

const SONIC = ChainKeys.SONIC_MAINNET satisfies SpokeChainKey;
const DEFAULT_SLIPPAGE = '0.5'; // %

// Backend Execution Service — submits the spoke tx to the relay/solver and exposes a
// status endpoint we can poll. Same canary host the solver page uses.
const SUBMIT_TX_API_CONFIG = { baseURL: 'https://canary-api.sodax.com/v1/bes' } as const;

function fmtUnits(value: bigint | undefined, decimals: number, digits = 6): string {
  if (value === undefined || value === null) return '—';
  const s = formatUnits(value, decimals);
  const [int, frac = ''] = s.split('.');
  return `${int}.${frac.slice(0, digits).padEnd(digits, '0')}`;
}

export default function LeverageYieldPage() {
  const { sodax } = useSodaxContext();
  const { openWalletModal, solverEnvironment, setSolverEnvironment } = useAppStore();

  // ─── Vault selection ─────────────────────────────────────────────────────

  const vaults = useMemo(() => sodax.leverageYield.listVaults(), [sodax]);
  const [selectedVaultName, setSelectedVaultName] = useState<string>(vaults[0]?.name ?? '');
  const selectedVault: LeverageYieldVault | undefined = useMemo(
    () => vaults.find(v => v.name === selectedVaultName),
    [vaults, selectedVaultName],
  );

  // The lsoda* XToken on Sonic that matches this vault's proxy address. This is the
  // "locked" side of the swap UI — destination on deposit, source on withdraw.
  const lsodaToken: XToken | undefined = useMemo(() => {
    if (!selectedVault) return undefined;
    const sonicTokens = getSupportedSolverTokens(SONIC);
    return sonicTokens.find(t => t.address.toLowerCase() === selectedVault.vault.toLowerCase());
  }, [selectedVault]);

  // ─── Counterparty (the "other" side that the user picks) ─────────────────
  // Same state object reused for both tabs. On the Deposit tab it's the source
  // (any → lsoda); on Withdraw it's the destination (lsoda → any).

  const supportedSpokeChains = useMemo(() => sodax.config.getSupportedSpokeChains(), [sodax]);
  const [otherChain, setOtherChain] = useState<SpokeChainKey>(ChainKeys.ARBITRUM_MAINNET);
  const otherTokens = useMemo(() => getSupportedSolverTokens(otherChain), [otherChain]);
  const [otherToken, setOtherToken] = useState<XToken | undefined>(otherTokens[0]);

  useEffect(() => {
    if (otherTokens.length === 0) return;
    setOtherToken(prev =>
      prev && otherTokens.some(t => t.address === prev.address) ? prev : otherTokens[0],
    );
  }, [otherTokens]);

  // ─── Active tab ──────────────────────────────────────────────────────────

  const [tab, setTab] = useState<'deposit' | 'withdraw'>('deposit');

  // Resolve src/dst by tab. lsoda is dst on deposit, src on withdraw.
  const src = tab === 'deposit'
    ? { chain: otherChain, token: otherToken }
    : { chain: SONIC, token: lsodaToken };
  const dst = tab === 'deposit'
    ? { chain: SONIC, token: lsodaToken }
    : { chain: otherChain, token: otherToken };

  // ─── Wallets ─────────────────────────────────────────────────────────────

  const sourceAccount = useXAccount({ xChainId: src.chain });
  const destAccount = useXAccount({ xChainId: dst.chain });
  const sourceWalletProvider = useWalletProvider({ xChainId: src.chain });
  const sourceChainType = getXChainType(src.chain);
  const destChainType = getXChainType(dst.chain);
  const { isWrongChain: isSrcWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: src.chain });
  const showEvmSwitch = sourceChainType === 'EVM' && isSrcWrongChain && !!sourceAccount.address;

  // ─── Balances ────────────────────────────────────────────────────────────
  // useXBalances routes per chain type via the XService (EVM viem, Solana web3.js, etc.).
  // Passing the right service is what makes balance reads work outside EVM.

  const sourceXService = useXService({ xChainType: sourceChainType });
  const { data: srcBalances } = useXBalances({
    params: {
      xService: sourceXService,
      xChainId: src.chain,
      xTokens: src.token ? [src.token] : [],
      address: sourceAccount.address,
    },
  });
  const srcBalance: bigint | undefined = src.token ? (srcBalances?.[src.token.address] as bigint | undefined) : undefined;

  const destXService = useXService({ xChainType: destChainType });
  const { data: dstBalances } = useXBalances({
    params: {
      xService: destXService,
      xChainId: dst.chain,
      xTokens: dst.token ? [dst.token] : [],
      address: destAccount.address,
    },
  });
  const dstBalance: bigint | undefined = dst.token ? (dstBalances?.[dst.token.address] as bigint | undefined) : undefined;

  // ─── Amount + quote ──────────────────────────────────────────────────────

  const [sourceAmount, setSourceAmount] = useState('');
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE);

  // Reset amount + intent when tab/vault/chain/token changes — stale quotes are confusing.
  useEffect(() => {
    setSourceAmount('');
    setIntentOrderPayload(undefined);
  }, [tab, selectedVaultName, otherChain, otherToken?.address]);

  const quotePayload: SolverIntentQuoteRequest | undefined = useMemo(() => {
    if (!src.token || !dst.token || Number(sourceAmount) <= 0) return undefined;
    return {
      token_src: src.token.address,
      token_src_blockchain_id: src.chain,
      token_dst: dst.token.address,
      token_dst_blockchain_id: dst.chain,
      amount: parseUnits(sourceAmount, src.token.decimals),
      quote_type: 'exact_input',
    } satisfies SolverIntentQuoteRequest;
  }, [src.token, dst.token, src.chain, dst.chain, sourceAmount]);

  const quoteQuery = useQuote({ params: { payload: quotePayload } });
  const quote = quoteQuery.data?.ok ? quoteQuery.data.value : undefined;

  const exchangeRate = useMemo(() => {
    if (!quote?.quoted_amount || !sourceAmount || !dst.token) return undefined;
    const out = new BigNumber(formatUnits(quote.quoted_amount, dst.token.decimals));
    const inp = new BigNumber(sourceAmount);
    if (inp.isZero()) return undefined;
    return out.div(inp);
  }, [quote, sourceAmount, dst.token]);

  const minOutputAmount: bigint | undefined = useMemo(() => {
    if (!quote?.quoted_amount) return undefined;
    return BigInt(
      new BigNumber(quote.quoted_amount)
        .multipliedBy(new BigNumber(100).minus(new BigNumber(slippage || '0')))
        .div(100)
        .toFixed(0),
    );
  }, [quote, slippage]);

  // ─── Intent payload + allowance + swap mutations ─────────────────────────

  const [intentOrderPayload, setIntentOrderPayload] = useState<CreateIntentParams | undefined>();
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: hasAllowance, isLoading: isAllowanceLoading } = useSwapAllowance({
    params: {
      payload: intentOrderPayload,
      srcChainKey: src.chain,
      walletProvider: sourceWalletProvider,
    },
  });

  const { mutateAsyncSafe: approve, isPending: isApproving } = useSwapApprove();
  const { mutateAsyncSafe: submitSwapTx, isPending: isSubmitting } = useBackendSubmitSwapTx();

  // Accumulated orders — each one polls the BES status endpoint via <OrderStatus> and
  // shows live progress. Mirrors the solver page's pattern so users see the same UX
  // whether they deposit/withdraw via this page or swap via /solver.
  const [orders, setOrders] = useState<Order[]>([]);

  const buildIntent = (): CreateIntentParams | undefined => {
    if (!src.token || !dst.token || !sourceAccount.address || !destAccount.address || !sourceWalletProvider) {
      return undefined;
    }
    if (!quote || !minOutputAmount) return undefined;
    return {
      inputToken: src.token.address,
      outputToken: dst.token.address,
      inputAmount: parseUnits(sourceAmount, src.token.decimals),
      minOutputAmount,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 60 * 5),
      allowPartialFill: false,
      srcChainKey: src.chain,
      dstChainKey: dst.chain,
      srcAddress: sourceAccount.address,
      dstAddress: destAccount.address,
      solver: '0x0000000000000000000000000000000000000000',
      data: '0x',
    } satisfies CreateIntentParams;
  };

  const prepare = () => {
    setActionError(null);
    const intent = buildIntent();
    if (!intent) {
      setActionError('Missing wallet, token, or quote — connect both chains and enter an amount.');
      return;
    }
    setIntentOrderPayload(intent);
  };

  const handleApprove = async () => {
    if (!intentOrderPayload || !sourceWalletProvider) return;
    setActionError(null);
    const result = await approve({ params: intentOrderPayload, walletProvider: sourceWalletProvider });
    if (!result.ok) setActionError((result.error as Error)?.message ?? 'Approve failed');
  };

  /**
   * Two-step submit-tx flow (matches the solver page's `handleSubmitTxSwap`):
   *   1. `createIntent` — broadcasts the spoke tx and returns immediately with the intent
   *      payload + relay metadata. Does NOT wait for relay to land — so it can't time out
   *      on a still-relaying intent the way `useSwap` does.
   *   2. `submitSwapTx` — POSTs the spoke tx hash + intent to the BES backend, which
   *      forwards to the solver and exposes a status endpoint we poll via `<OrderStatus>`.
   * After both succeed we push an Order; live status renders above the card.
   */
  const handleSwap = async () => {
    if (!intentOrderPayload || !sourceWalletProvider || !sourceAccount.address) return;
    setActionError(null);

    const createIntentResult = await sodax.swaps.createIntent({
      params: intentOrderPayload,
      raw: false,
      walletProvider: sourceWalletProvider,
    });
    if (!createIntentResult.ok) {
      setActionError(`Create intent failed: ${(createIntentResult.error as Error)?.message ?? 'unknown'}`);
      return;
    }
    const { tx: spokeTxHash, intent, relayData } = createIntentResult.value;

    const swapIntentData: SwapIntentData = {
      intentId: intent.intentId.toString(),
      creator: intent.creator,
      inputToken: intent.inputToken,
      outputToken: intent.outputToken,
      inputAmount: intent.inputAmount.toString(),
      minOutputAmount: intent.minOutputAmount.toString(),
      deadline: intent.deadline.toString(),
      allowPartialFill: intent.allowPartialFill,
      srcChain: Number(intent.srcChain),
      dstChain: Number(intent.dstChain),
      srcAddress: intent.srcAddress,
      dstAddress: intent.dstAddress,
      solver: intent.solver,
      data: intent.data,
    };

    const request: SubmitSwapTxRequest = {
      txHash: spokeTxHash as string,
      srcChainKey: src.chain,
      walletAddress: sourceAccount.address,
      intent: swapIntentData,
      relayData: relayData.payload,
    };
    const submitResult = await submitSwapTx({ request, apiConfig: SUBMIT_TX_API_CONFIG });
    if (!submitResult.ok) {
      setActionError(`BES submit failed: ${(submitResult.error as Error)?.message ?? 'unknown'}`);
      return;
    }

    setOrders(prev => [
      ...prev,
      {
        mode: 'submit-tx',
        txHash: spokeTxHash as string,
        srcChainKey: src.chain,
        apiBaseURL: SUBMIT_TX_API_CONFIG.baseURL,
      },
    ]);
    setSourceAmount('');
    setIntentOrderPayload(undefined);
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  if (!selectedVault || !lsodaToken) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <Card className="w-full max-w-lg mx-auto">
          <CardHeader>
            <CardTitle>Leverage Yield</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">
              {vaults.length === 0
                ? 'No leverage vaults registered in @sodax/types.'
                : "Selected vault's share token isn't in the swap registry — add it to LsodaTokens in @sodax/types."}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-start min-h-screen p-4 gap-4">
      {/* Live status print-out for every submitted intent — same component the solver page
          uses. Each order polls the BES status endpoint and shows progress until executed. */}
      {orders.map((order, index) => (
        <OrderStatus key={index} order={order} />
      ))}

      {/* Solver-environment switcher — same control as on /solver. Drives `solverEnvironment`
          in the app store; providers.tsx remaps the SDK's solver config on change. */}
      <Tabs value={solverEnvironment} onValueChange={v => setSolverEnvironment(v as SolverEnv)}>
        <TabsList>
          <TabsTrigger value={SolverEnv.Staging}>Staging</TabsTrigger>
          <TabsTrigger value={SolverEnv.Production}>Production</TabsTrigger>
          <TabsTrigger value={SolverEnv.Dev}>Dev</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card className="w-full max-w-xl mx-auto">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center">Leverage Yield</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Vault</Label>
            <Select value={selectedVaultName} onValueChange={setSelectedVaultName}>
              <SelectTrigger>
                <SelectValue placeholder="Select a vault" />
              </SelectTrigger>
              <SelectContent>
                {vaults.map(v => (
                  <SelectItem key={v.name} value={v.name}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground space-y-0.5 break-all">
              <div>vault: <code>{selectedVault.vault}</code></div>
              <div>asset: <code>{selectedVault.asset}</code></div>
              <div>borrowToken: <code>{selectedVault.borrowToken}</code></div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="w-full max-w-xl mx-auto">
        <CardContent className="pt-6">
          <Tabs value={tab} onValueChange={v => setTab(v as 'deposit' | 'withdraw')}>
            <TabsList className="w-full">
              <TabsTrigger value="deposit" className="flex-1">Deposit (any → {lsodaToken.symbol})</TabsTrigger>
              <TabsTrigger value="withdraw" className="flex-1">Withdraw ({lsodaToken.symbol} → any)</TabsTrigger>
            </TabsList>

            <TabsContent value={tab} className="space-y-4 pt-4">
              {/* Source */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>From</Label>
                  {src.token && srcBalance !== undefined && (
                    <span className="text-xs text-muted-foreground">
                      balance: <span className="font-mono">{fmtUnits(srcBalance, src.token.decimals)}</span>
                    </span>
                  )}
                </div>
                {tab === 'deposit' ? (
                  <ChainSelector
                    selectedChainId={otherChain}
                    selectChainId={setOtherChain}
                    allowedChains={supportedSpokeChains}
                  />
                ) : (
                  <div className="text-sm">
                    <code>{SONIC}</code>{' '}
                    <span className="text-xs text-muted-foreground">(locked — Sonic)</span>
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="0.0"
                    value={sourceAmount}
                    onChange={e => setSourceAmount(e.target.value)}
                  />
                  {tab === 'deposit' ? (
                    <Select
                      value={otherToken?.address}
                      onValueChange={addr => setOtherToken(otherTokens.find(t => t.address === addr))}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue placeholder="Token" />
                      </SelectTrigger>
                      <SelectContent>
                        {otherTokens.map(t => (
                          <SelectItem key={t.address} value={t.address}>
                            {t.symbol}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="w-[140px] flex items-center justify-center border rounded-md text-sm font-medium">
                      {lsodaToken.symbol}
                    </div>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (src.token && srcBalance !== undefined) {
                        setSourceAmount(formatUnits(srcBalance, src.token.decimals));
                      }
                    }}
                    disabled={!src.token || srcBalance === undefined}
                  >
                    Max
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground break-all">
                  {sourceAccount.address ? (
                    <>signer: <code>{sourceAccount.address}</code></>
                  ) : (
                    <span className="text-amber-600">connect a wallet on {src.chain}</span>
                  )}
                </div>
              </div>

              <div className="flex justify-center">
                <ArrowDownUp className="h-5 w-5 text-muted-foreground" />
              </div>

              {/* Destination */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>To</Label>
                  {dst.token && dstBalance !== undefined && (
                    <span className="text-xs text-muted-foreground">
                      balance: <span className="font-mono">{fmtUnits(dstBalance, dst.token.decimals)}</span>
                    </span>
                  )}
                </div>
                {tab === 'withdraw' ? (
                  <ChainSelector
                    selectedChainId={otherChain}
                    selectChainId={setOtherChain}
                    allowedChains={supportedSpokeChains}
                  />
                ) : (
                  <div className="text-sm">
                    <code>{SONIC}</code>{' '}
                    <span className="text-xs text-muted-foreground">(locked — Sonic)</span>
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    type="text"
                    readOnly
                    value={
                      quote?.quoted_amount && dst.token
                        ? formatUnits(quote.quoted_amount, dst.token.decimals)
                        : ''
                    }
                    placeholder={quoteQuery.isFetching ? 'Quoting…' : '0.0'}
                  />
                  {tab === 'withdraw' ? (
                    <Select
                      value={otherToken?.address}
                      onValueChange={addr => setOtherToken(otherTokens.find(t => t.address === addr))}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue placeholder="Token" />
                      </SelectTrigger>
                      <SelectContent>
                        {otherTokens.map(t => (
                          <SelectItem key={t.address} value={t.address}>
                            {t.symbol}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="w-[140px] flex items-center justify-center border rounded-md text-sm font-medium">
                      {lsodaToken.symbol}
                    </div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground break-all">
                  {destAccount.address ? (
                    <>recipient: <code>{destAccount.address}</code></>
                  ) : (
                    <span className="text-amber-600">connect a wallet on {dst.chain}</span>
                  )}
                </div>
              </div>

              {/* Quote summary */}
              <div className="text-xs text-muted-foreground space-y-0.5">
                {exchangeRate && dst.token && src.token && (
                  <div>
                    rate: 1 {src.token.symbol} ≈{' '}
                    <span className="font-mono">{exchangeRate.toFixed(6)}</span> {dst.token.symbol}
                  </div>
                )}
                {minOutputAmount !== undefined && dst.token && (
                  <div>
                    min received ({slippage}% slippage):{' '}
                    <span className="font-mono">{fmtUnits(minOutputAmount, dst.token.decimals)}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <Label className="text-xs">slippage %</Label>
                  <Input
                    type="number"
                    value={slippage}
                    onChange={e => setSlippage(e.target.value)}
                    className="h-7 w-24 text-xs"
                  />
                </div>
              </div>

              {/* Action buttons */}
              {!sourceAccount.address || !destAccount.address ? (
                <Button onClick={openWalletModal} className="w-full">
                  Connect wallet{!sourceAccount.address && !destAccount.address ? 's' : ''}
                </Button>
              ) : showEvmSwitch ? (
                <Button onClick={handleSwitchChain} className="w-full" variant="cherryOutline">
                  Switch wallet to {src.chain}
                </Button>
              ) : !intentOrderPayload ? (
                <Button
                  onClick={prepare}
                  disabled={!quote || !sourceAmount || quoteQuery.isFetching}
                  className="w-full"
                >
                  {quoteQuery.isFetching ? 'Quoting…' : 'Review'}
                </Button>
              ) : isAllowanceLoading ? (
                <Button disabled className="w-full">Checking allowance…</Button>
              ) : hasAllowance ? (
                <Button onClick={handleSwap} disabled={isSubmitting} className="w-full">
                  {isSubmitting ? 'Submitting…' : tab === 'deposit' ? 'Deposit' : 'Withdraw'}
                </Button>
              ) : (
                <Button onClick={handleApprove} disabled={isApproving} className="w-full">
                  {isApproving ? 'Approving…' : 'Approve'}
                </Button>
              )}

              {actionError && (
                <div className="text-sm text-red-600 break-all">{actionError}</div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
        <CardFooter className="text-xs text-muted-foreground">
          Routed via the Sodax solver.{' '}
          {tab === 'deposit'
            ? `${lsodaToken.symbol} lands on your Sonic wallet — hold or trade like any token.`
            : `Burns ${lsodaToken.symbol} from your Sonic wallet and delivers the chosen token to your destination chain.`}
        </CardFooter>
      </Card>
    </div>
  );
}
