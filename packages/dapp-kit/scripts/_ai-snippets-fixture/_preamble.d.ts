// Ambient shims for dapp-kit code-block smoke checking.
//
// Every extracted `snippet-NNN.tsx` references these declarations as if they
// were in scope. The values they bind to are intentionally typed against the
// SDK so that snippet bodies must use the canonical hook call shapes — wrong
// shapes (e.g. `useQuote({ params: <Request> })` instead of
// `useQuote({ params: { payload: <Request> } })`) fail typecheck.
//
// This file is NOT regenerated per run; it's the authoritative shim surface
// for what doc snippets can assume about ambient identifiers.

import type {
  Address,
  Hex,
  SpokeChainKey,
  HubChainKey,
  IEvmWalletProvider,
  IBitcoinWalletProvider,
  IIconWalletProvider,
  IInjectiveWalletProvider,
  INearWalletProvider,
  ISolanaWalletProvider,
  IStacksWalletProvider,
  IStellarWalletProvider,
  ISuiWalletProvider,
  CreateIntentParams,
  CreateLimitOrderParams,
  CreateBridgeIntentParams,
  CreateAssetDepositParams,
  CreateAssetWithdrawParams,
  MoneyMarketParams,
  MoneyMarketSupplyParams,
  MoneyMarketBorrowParams,
  MoneyMarketWithdrawParams,
  MoneyMarketRepayParams,
  StakeParams,
  UnstakeParams,
  InstantUnstakeParams,
  ClaimParams,
  CancelUnstakeParams,
  IcxMigrateParams,
  IcxCreateRevertMigrationParams,
  UnifiedBnUSDMigrateParams,
  BalnMigrateParams,
  XToken,
  PoolKey,
  PoolData,
  SolverIntentQuoteRequest,
} from '@sodax/sdk';

declare global {
  // ── chain-key + identity ───────────────────────────────────────────────
  const srcChainKey: SpokeChainKey;
  const dstChainKey: SpokeChainKey;
  const chainKey: SpokeChainKey;
  const spokeChainKey: SpokeChainKey;
  const xChainId: SpokeChainKey;

  const srcAddress: `0x${string}`;
  const dstAddress: `0x${string}`;
  const userAddress: `0x${string}`;
  const account: `0x${string}`;
  const walletAddress: string;
  const tradingAddress: string;
  const address: `0x${string}`;

  // ── wallet providers (EVM-typed; chain-specific snippets cast as needed) ─
  // Single ambient `walletProvider` is unioned with `undefined` because
  // many snippets gate on `if (!walletProvider) return` — matches what
  // `useWalletProvider(chainKey)` returns.
  const walletProvider: IEvmWalletProvider | undefined;

  // ── chain-token bits ────────────────────────────────────────────────────
  const srcXToken: XToken;
  const dstXToken: XToken;
  const xTokens: readonly XToken[];
  const token: string;
  const inputToken: string;
  const outputToken: string;
  const srcToken: string;
  const dstToken: string;

  // ── amounts + numerics ──────────────────────────────────────────────────
  const amount: bigint;
  const parsedAmount: bigint;
  const inputAmount: bigint;
  const minReceive: bigint;
  const minAmount: bigint;
  const liquidity: bigint;
  const tickLower: bigint;
  const tickUpper: bigint;
  const requestId: bigint;
  const tokenId: bigint;
  const positionId: bigint;

  // ── pool/dex bits ───────────────────────────────────────────────────────
  const poolKey: PoolKey;
  const poolData: PoolData;
  const poolToken: string;
  const asset: string;
  const srcAsset: string;
  const dstAsset: string;

  // ── per-feature canonical params bindings (commonly named in docs) ──────
  const intentParams: CreateIntentParams;
  const limitOrderParams: CreateLimitOrderParams;
  const bridgeParams: CreateBridgeIntentParams<SpokeChainKey>;
  const depositParams: CreateAssetDepositParams<SpokeChainKey>;
  const withdrawParams: CreateAssetWithdrawParams<SpokeChainKey>;
  const supplyParams: MoneyMarketSupplyParams<SpokeChainKey>;
  const borrowParams: MoneyMarketBorrowParams<SpokeChainKey>;
  const withdrawMmParams: MoneyMarketWithdrawParams<SpokeChainKey>;
  const repayParams: MoneyMarketRepayParams<SpokeChainKey>;
  const stakeParams: StakeParams<SpokeChainKey>;
  const unstakeParams: UnstakeParams<SpokeChainKey>;
  const instantUnstakeParams: InstantUnstakeParams<SpokeChainKey>;
  const claimParams: ClaimParams<SpokeChainKey>;
  const cancelUnstakeParams: CancelUnstakeParams<SpokeChainKey>;
  const revertParams: IcxCreateRevertMigrationParams;
  const bnUSDParams: UnifiedBnUSDMigrateParams<SpokeChainKey>;
  const supplyLiquidityParams: unknown; // dex param-builder output; varies

  // ── solver / quote ──────────────────────────────────────────────────────
  const payload: SolverIntentQuoteRequest;

  // ── React Query bits commonly used in mutation snippets ────────────────
  const queryClient: { invalidateQueries: (opts: { queryKey: readonly unknown[] }) => Promise<void> };

  // ── misc helpers commonly referenced in snippets ───────────────────────
  const toast: { error: (msg: string) => void; success: (msg: string) => void };
  const Sentry: { captureException: (err: unknown) => void };
  const console: Console;
  const alert: (msg: string) => void;
  const navigate: (path: string) => void;
  const trackSwap: (data: unknown) => void;
  const myOwnErrorHandler: (e: unknown) => void;
  const myExtra: (...args: unknown[]) => void;
  const showSuccess: (intent: unknown) => void;
  const showError: (err: unknown) => void;
  const handleMmError: (code: string) => void;
  const fromChain: SpokeChainKey;
  const debtChain: SpokeChainKey;
  const fromAddress: `0x${string}`;
  const debtAddress: `0x${string}`;
  const fromToken: XToken;
  const toToken: XToken;
  const tokenOnFromChain: { address: string };

  // ── partial migration / staking-info shims ──────────────────────────────
  const existingTokenId: bigint | undefined;
  const tx: unknown;
  const intent: unknown;
  const relayData: unknown;
  const status: unknown;
  const txHash: string;
}

export {};
