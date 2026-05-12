import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChainSelector } from '@/components/shared/ChainSelector';
import { useSodaxContext, useXBalances } from '@sodax/dapp-kit';
import {
  getXChainType,
  useEvmSwitchChain,
  useWalletProvider,
  useXAccount,
  useXService,
} from '@sodax/wallet-sdk-react';
import {
  ChainKeys,
  type Address,
  type GetWalletProviderType,
  type LeverageYieldVault,
  type SpokeChainKey,
  type XToken,
} from '@sodax/sdk';
import { formatUnits, parseUnits } from 'viem';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '@/zustand/useAppStore';

const MAX_UINT_HF = (1n << 256n) - 1n; // type(uint256).max → "no debt" sentinel from the vault

function bps(value: bigint): string {
  return `${(Number(value) / 100).toFixed(2)}%`;
}

function fmtUnits(value: bigint | undefined, decimals = 18, digits = 6): string {
  if (value === undefined || value === null) return '—';
  const s = formatUnits(value, decimals);
  const [int, frac = ''] = s.split('.');
  return `${int}.${frac.slice(0, digits).padEnd(digits, '0')}`;
}

function fmtHF(value: bigint | undefined): string {
  if (value === undefined || value === null) return '—';
  if (value >= MAX_UINT_HF - 1n) return '∞';
  return formatUnits(value, 18);
}

export default function LeverageYieldPage() {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();
  const { openWalletModal } = useAppStore();

  // Vault registry (single entry today, ready for many).
  const vaults = useMemo(() => sodax.leverageYield.listVaults(), [sodax]);
  const [selectedVaultName, setSelectedVaultName] = useState<string>(vaults[0]?.name ?? '');
  const selectedVault: LeverageYieldVault | undefined = useMemo(
    () => vaults.find(v => v.name === selectedVaultName),
    [vaults, selectedVaultName],
  );

  // Eligible source chains: any spoke chain that has at least one token whose hub `vault`
  // matches the leverage vault's `asset`. This filters out chains that simply don't support
  // the underlying asset (e.g. Solana for a weETH-leveraged vault) and keeps the asset-mismatch
  // SDK guard from ever tripping in the UI.
  const eligibleChains = useMemo<SpokeChainKey[]>(() => {
    if (!selectedVault) return [];
    const target = selectedVault.asset.toLowerCase();
    return (Object.entries(sodax.config.spokeChainConfig) as [SpokeChainKey, { supportedTokens: Record<string, XToken> }][])
      .filter(([, cfg]) => Object.values(cfg.supportedTokens).some(t => t.vault.toLowerCase() === target))
      .map(([key]) => key);
  }, [sodax, selectedVault]);

  const [sourceChainKey, setSourceChainKey] = useState<SpokeChainKey>(ChainKeys.ARBITRUM_MAINNET);

  // Re-pick a sensible default when the vault changes or the eligible set shifts.
  React.useEffect(() => {
    if (eligibleChains.length > 0 && !eligibleChains.includes(sourceChainKey)) {
      setSourceChainKey(eligibleChains[0]);
    }
  }, [eligibleChains, sourceChainKey]);

  const account = useXAccount({ xChainId: sourceChainKey });
  const walletProvider = useWalletProvider({ xChainId: sourceChainKey });
  // Chain switching only applies to EVM spokes — non-EVM wallets are connected per-chain.
  const sourceChainType = getXChainType(sourceChainKey);
  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: sourceChainKey });
  const showEvmSwitch = sourceChainType === 'EVM' && isWrongChain;

  // Source-token candidates on the selected chain that match the vault's asset.
  const sourceTokens = useMemo<XToken[]>(() => {
    if (!selectedVault) return [];
    const all = sodax.config.spokeChainConfig[sourceChainKey]?.supportedTokens ?? {};
    return Object.values(all).filter(t => t.vault.toLowerCase() === selectedVault.asset.toLowerCase());
  }, [sodax, selectedVault, sourceChainKey]);
  const [srcToken, setSrcToken] = useState<XToken | undefined>(undefined);

  // Re-pick the first compatible token whenever vault or chain changes.
  React.useEffect(() => {
    setSrcToken(sourceTokens[0]);
  }, [sourceTokens]);

  // ─── Reads ──────────────────────────────────────────────────────────────

  const { data: hubWalletAddress } = useQuery({
    queryKey: ['leverageYield', 'hubWallet', account.address, sourceChainKey],
    enabled: !!account.address,
    queryFn: async () =>
      sodax.hubProvider.getUserHubWalletAddress(account.address as string, sourceChainKey),
  });

  const { data: position, isLoading: isPositionLoading } = useQuery({
    queryKey: ['leverageYield', 'position', selectedVault?.vault],
    enabled: !!selectedVault,
    refetchInterval: 15_000,
    queryFn: async () => {
      if (!selectedVault) return null;
      const r = await sodax.leverageYield.getPosition(selectedVault.vault);
      if (!r.ok) throw r.error;
      return r.value;
    },
  });

  const { data: hubWalletMaxWithdraw, isLoading: isMaxLoading } = useQuery({
    queryKey: ['leverageYield', 'maxWithdraw', selectedVault?.vault, hubWalletAddress],
    enabled: !!selectedVault && !!hubWalletAddress,
    refetchInterval: 15_000,
    queryFn: async () => {
      if (!selectedVault || !hubWalletAddress) return 0n;
      const r = await sodax.leverageYield.getMaxWithdraw(selectedVault.vault, hubWalletAddress as Address);
      if (!r.ok) throw r.error;
      return r.value;
    },
  });

  // User's spoke-side `srcToken` balance — powers the Deposit "Max" button.
  // `useXBalances` (from @sodax/dapp-kit) routes per chain type: viem for EVM, the right
  // RPC client for Solana / Sui / Stellar / Bitcoin / etc. Returns a `Record<address, bigint>`.
  const sourceXService = useXService({ xChainType: sourceChainType });
  const { data: sourceBalances } = useXBalances({
    params: {
      xService: sourceXService,
      xChainId: sourceChainKey,
      xTokens: srcToken ? [srcToken] : [],
      address: account.address,
    },
  });
  const srcTokenBalance: bigint | undefined = srcToken
    ? (sourceBalances?.[srcToken.address] as bigint | undefined)
    : undefined;

  // ─── Mutations ──────────────────────────────────────────────────────────

  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');

  const depositMutation = useMutation({
    mutationFn: async () => {
      if (!selectedVault || !srcToken || !walletProvider || !account.address) {
        throw new Error('Vault, token, wallet, and account are required');
      }
      const amount = parseUnits(depositAmount || '0', srcToken.decimals);
      if (amount === 0n) throw new Error('Amount must be greater than 0');

      // The SDK infers wallet-provider type from `srcChainKey`. Cast at the boundary —
      // chain-type narrowing across `useWalletProvider` returns the union, the per-chain
      // SpokeService router enforces the right shape at runtime.
      const params = {
        raw: false as const,
        walletProvider: walletProvider as GetWalletProviderType<SpokeChainKey>,
        params: {
          vault: selectedVault.vault,
          srcChainKey: sourceChainKey,
          srcAddress: account.address as Address,
          srcToken: srcToken.address,
          amount,
        },
      };

      // Pre-flight: spoke-side allowance for SpokeAssetManager, approve if needed.
      // EVM only — non-EVM chains return `value: true` from isXDepositAllowanceValid.
      const allowance = await sodax.leverageYield.isXDepositAllowanceValid(params);
      if (!allowance.ok) throw allowance.error;
      if (!allowance.value) {
        const approve = await sodax.leverageYield.xdepositApprove(params);
        if (!approve.ok) throw approve.error;
        // Receipt wait is EVM-specific. Skip for non-EVM (the relay phase covers settlement).
        if (sourceChainType === 'EVM' && typeof approve.value === 'string') {
          await (walletProvider as GetWalletProviderType<SpokeChainKey> & {
            waitForTransactionReceipt: (h: `0x${string}`) => Promise<unknown>;
          }).waitForTransactionReceipt(approve.value as `0x${string}`);
        }
      }

      const result = await sodax.leverageYield.xdeposit(params);
      if (!result.ok) throw result.error;
      return result.value;
    },
    onSuccess: () => {
      setDepositAmount('');
      queryClient.invalidateQueries({ queryKey: ['leverageYield'] });
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: async () => {
      if (!selectedVault || !srcToken || !walletProvider || !account.address) {
        throw new Error('Vault, token, wallet, and account are required');
      }
      // xwithdraw amount is in vault-asset (sodaWEETH-style, 18 decimal) units.
      const amount = parseUnits(withdrawAmount || '0', 18);
      if (amount === 0n) throw new Error('Amount must be greater than 0');

      const result = await sodax.leverageYield.xwithdraw({
        raw: false,
        walletProvider: walletProvider as GetWalletProviderType<SpokeChainKey>,
        params: {
          vault: selectedVault.vault,
          srcChainKey: sourceChainKey,
          srcAddress: account.address as Address,
          dstToken: srcToken.address,
          amount,
        },
      });
      if (!result.ok) throw result.error;
      return result.value;
    },
    onSuccess: () => {
      setWithdrawAmount('');
      queryClient.invalidateQueries({ queryKey: ['leverageYield'] });
    },
  });

  // ─── Render ─────────────────────────────────────────────────────────────

  if (!selectedVault) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <Card className="w-full max-w-lg mx-auto">
          <CardHeader>
            <CardTitle>Leverage Yield</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">
              No leverage vaults registered in <code>@sodax/types</code>.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-start min-h-screen p-4 gap-4">
      <Card className="w-full max-w-lg mx-auto">
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

          <div className="space-y-2">
            <Label>Source chain</Label>
            {eligibleChains.length === 0 ? (
              <div className="text-sm text-amber-600">
                No spoke chain has a token mapping to vault asset <code>{selectedVault.asset}</code>.
              </div>
            ) : (
              <ChainSelector
                selectedChainId={sourceChainKey}
                selectChainId={setSourceChainKey}
                allowedChains={eligibleChains}
              />
            )}
            <div className="text-xs text-muted-foreground">
              {eligibleChains.length} eligible chain{eligibleChains.length === 1 ? '' : 's'} for this vault.
            </div>
          </div>

          <div className="space-y-2">
            <Label>Source token</Label>
            {sourceTokens.length === 0 ? (
              <div className="text-sm text-amber-600">
                No tokens on <code>{sourceChainKey}</code> map to vault asset <code>{selectedVault.asset}</code>.
              </div>
            ) : (
              <Select
                value={srcToken?.address}
                onValueChange={addr => setSrcToken(sourceTokens.find(t => t.address === addr))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Token" />
                </SelectTrigger>
                <SelectContent>
                  {sourceTokens.map(t => (
                    <SelectItem key={t.address} value={t.address}>
                      {t.symbol}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label>Account ({sourceChainType ?? '—'})</Label>
            <div className="flex items-center gap-2">
              <Input value={account.address ?? ''} disabled placeholder="(not connected)" />
              {!account.address && <Button onClick={openWalletModal}>Connect</Button>}
            </div>
            {hubWalletAddress && sourceChainKey !== ChainKeys.SONIC_MAINNET && (
              <div className="text-xs text-muted-foreground break-all">
                hub wallet: <code>{hubWalletAddress as string}</code>
              </div>
            )}
          </div>

          {showEvmSwitch && (
            <Button onClick={handleSwitchChain} className="w-full" variant="cherryOutline">
              Switch wallet to {sourceChainKey}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="w-full max-w-lg mx-auto">
        <CardHeader>
          <CardTitle className="text-lg">Position</CardTitle>
        </CardHeader>
        <CardContent>
          {isPositionLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : position ? (
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted-foreground">collateral</dt>
              <dd className="text-right font-mono">{fmtUnits(position.collateral)}</dd>
              <dt className="text-muted-foreground">debt</dt>
              <dd className="text-right font-mono">{fmtUnits(position.debt)}</dd>
              <dt className="text-muted-foreground">idle</dt>
              <dd className="text-right font-mono">{fmtUnits(position.idleAsset)}</dd>
              <dt className="text-muted-foreground">LTV</dt>
              <dd className="text-right font-mono">{bps(position.ltv)}</dd>
              <dt className="text-muted-foreground">health factor</dt>
              <dd className="text-right font-mono">{fmtHF(position.healthFactor)}</dd>
              <dt className="text-muted-foreground">hub-wallet maxWithdraw</dt>
              <dd className="text-right font-mono">
                {isMaxLoading ? <Skeleton className="h-4 w-20 inline-block" /> : fmtUnits(hubWalletMaxWithdraw)}
              </dd>
            </dl>
          ) : (
            <div className="text-sm text-muted-foreground">No data.</div>
          )}
        </CardContent>
      </Card>

      <Card className="w-full max-w-lg mx-auto">
        <CardHeader>
          <CardTitle className="text-lg">Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="deposit">
            <TabsList className="w-full">
              <TabsTrigger value="deposit" className="flex-1">Deposit</TabsTrigger>
              <TabsTrigger value="withdraw" className="flex-1">Withdraw</TabsTrigger>
            </TabsList>

            <TabsContent value="deposit" className="space-y-4 pt-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Amount ({srcToken?.symbol ?? 'token'})</Label>
                  {srcToken && srcTokenBalance !== undefined && (
                    <span className="text-xs text-muted-foreground">
                      balance: <span className="font-mono">{fmtUnits(srcTokenBalance, srcToken.decimals)}</span>
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="0.0"
                    value={depositAmount}
                    onChange={e => setDepositAmount(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (srcToken && srcTokenBalance !== undefined) {
                        setDepositAmount(formatUnits(srcTokenBalance, srcToken.decimals));
                      }
                    }}
                    disabled={!srcToken || srcTokenBalance === undefined}
                  >
                    Max
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground">
                  Cross-chain: bridges {srcToken?.symbol ?? '—'} from {sourceChainKey} into the leverage
                  vault on Sonic. Allowance is checked + approved automatically (EVM only).
                </div>
              </div>
              <Button
                className="w-full"
                onClick={() => depositMutation.mutate()}
                disabled={
                  depositMutation.isPending ||
                  !srcToken ||
                  !account.address ||
                  !depositAmount ||
                  showEvmSwitch
                }
              >
                {depositMutation.isPending ? 'Depositing…' : 'xdeposit'}
              </Button>
              {depositMutation.error && (
                <div className="text-sm text-red-600 break-all">
                  {(depositMutation.error as Error).message}
                </div>
              )}
              {depositMutation.data && (
                <div className="text-sm text-green-700 break-all space-y-0.5">
                  <div>✓ srcChainTxHash: <code>{depositMutation.data.srcChainTxHash}</code></div>
                  <div>✓ dstChainTxHash: <code>{depositMutation.data.dstChainTxHash}</code></div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="withdraw" className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Amount (vault asset, 18 decimals)</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="0.0"
                    value={withdrawAmount}
                    onChange={e => setWithdrawAmount(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (hubWalletMaxWithdraw !== undefined) {
                        setWithdrawAmount(formatUnits(hubWalletMaxWithdraw, 18));
                      }
                    }}
                    disabled={hubWalletMaxWithdraw === undefined}
                  >
                    Max
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground">
                  Burns shares from your hub wallet, unwraps to {srcToken?.symbol ?? '—'} on the hub, and bridges back
                  to your address on {sourceChainKey}. Amount is denominated in the vault asset (sodaWEETH-style).
                </div>
              </div>
              <Button
                className="w-full"
                onClick={() => withdrawMutation.mutate()}
                disabled={
                  withdrawMutation.isPending ||
                  !srcToken ||
                  !account.address ||
                  !withdrawAmount ||
                  showEvmSwitch
                }
              >
                {withdrawMutation.isPending ? 'Withdrawing…' : 'xwithdraw'}
              </Button>
              {withdrawMutation.error && (
                <div className="text-sm text-red-600 break-all">
                  {(withdrawMutation.error as Error).message}
                </div>
              )}
              {withdrawMutation.data && (
                <div className="text-sm text-green-700 break-all space-y-0.5">
                  <div>✓ srcChainTxHash: <code>{withdrawMutation.data.srcChainTxHash}</code></div>
                  <div>✓ dstChainTxHash: <code>{withdrawMutation.data.dstChainTxHash}</code></div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
        <CardFooter className="text-xs text-muted-foreground">
          Position auto-refreshes every 15s. Deposits / withdrawals trigger immediate refetch.
        </CardFooter>
      </Card>
    </div>
  );
}
