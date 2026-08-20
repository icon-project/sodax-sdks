/**
 * Leverage Positions page.
 *
 * The unpooled counterpart to /leverage-yield. A vault is one shared ERC-4626 position at a
 * single target LTV; a leverage position is one AAVE account per owner, so an owner can hold
 * several at different eMode categories and leverage tiers at once.
 *
 * Positions are owned by the user's **hub wallet**, never their EOA — the wallet router for a
 * Sonic user, the cross-chain wallet for a spoke user, both resolved by the one
 * `useGetUserHubWalletAddress` call. That is what makes this page chain-agnostic: nothing here
 * is special-cased for Sonic.
 */

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ChainSelector } from '@/components/shared/ChainSelector';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SolverEnv, useAppStore } from '@/zustand/useAppStore';
import { useXAccount } from '@sodax/wallet-sdk-react';
import { ChainKeys, useGetUserHubWalletAddress, type SpokeChainKey } from '@sodax/dapp-kit';
import { LeveragePositionsPanel } from './LeveragePositionsPanel';
import { CreatePositionCard } from './CreatePositionCard';
import { PositionOrdersProvider } from './PositionOrders';
import type { Address } from 'viem';

export default function LeveragePositionsPage() {
  const [chain, setChain] = useState<SpokeChainKey>(ChainKeys.SONIC_MAINNET);
  const { solverEnvironment, setSolverEnvironment } = useAppStore();
  const account = useXAccount({ xChainId: chain });
  const { data: hubWallet } = useGetUserHubWalletAddress({
    params: { spokeChainId: chain, spokeAddress: account.address },
  });

  return (
    // Wraps the whole page so any control that posts an intent can record it, and so the standard
    // order panel renders once at the bottom rather than per position.
    <PositionOrdersProvider>
      <div className="flex flex-col items-center justify-start min-h-screen p-4 gap-4">
        {/* Solver-environment switcher — the same control as on /leverage-yield and /swaps-sdk, and the
          same shared `solverEnvironment` state, so switching here or there is the same switch.
          It applies to positions because a position's leverage intent is reported to whichever
          solver this selects; providers.tsx remaps the SDK's solver config on change. */}
        <Tabs value={solverEnvironment} onValueChange={v => setSolverEnvironment(v as SolverEnv)}>
          <TabsList>
            <TabsTrigger value={SolverEnv.Staging}>Staging</TabsTrigger>
            <TabsTrigger value={SolverEnv.Production}>Production</TabsTrigger>
          </TabsList>
        </Tabs>

        <Card className="w-full max-w-xl mx-auto">
          <CardHeader>
            <CardTitle className="text-2xl font-bold text-center">Leverage Positions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Your chain</Label>
              <ChainSelector selectedChainId={chain} selectChainId={setChain} />
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <span className="text-muted-foreground">your address</span>
              <span className="text-right font-mono text-xs break-all">{account.address ?? '—'}</span>
              <span className="text-muted-foreground">hub wallet (position owner)</span>
              <span className="text-right font-mono text-xs break-all">{hubWallet ?? '—'}</span>
            </div>

            <p className="text-xs text-muted-foreground">
              Leverage is asynchronous: creating a position posts an intent on-chain, that intent is reported to the
              solver selected above, and a solver fills it afterwards — so a new position is funded with the leverage
              still outstanding. Positions are open to any filler, so either environment can fill; the protection is the
              slippage floor on the intent, not the identity of whoever fills it. If nothing fills within 5 minutes the
              intent expires and the deposit returns to you.
            </p>

            <p className="text-xs text-muted-foreground">
              Positions are owned by your hub wallet rather than your own address, the same as every other SDK feature —
              the wallet router on Sonic, the cross-chain wallet elsewhere. Each position is its own AAVE account, so
              one owner can hold several at different eMode categories and leverage tiers, which the pooled vault on
              Leverage Yield cannot express.
            </p>
          </CardContent>
        </Card>

        <CreatePositionCard chain={chain} owner={hubWallet as Address | undefined} />

        <LeveragePositionsPanel chain={chain} spokeAddress={account.address} owner={hubWallet as Address | undefined} />
      </div>
    </PositionOrdersProvider>
  );
}
