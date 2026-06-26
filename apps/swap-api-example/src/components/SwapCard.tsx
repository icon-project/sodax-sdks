import type {
  ChainType,
  CreateIntentParamsV2,
  EvmRawTransaction,
  IEvmWalletProvider,
  IIconWalletProvider,
  ISolanaWalletProvider,
  IStacksWalletProvider,
  ISuiWalletProvider,
  IntentRequestV2,
  IntentResponseV2,
  RawTxReturnType,
  SpokeChainKey,
  SwapTokenV2,
} from '@sodax/types';
import { SwapsApiError } from '@sodax/swaps-api';
import { getXChainType, useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';
import { ArrowDown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { type Option, SearchSelect } from '@/components/ui/SearchSelect';
import { swapsApi } from '@/lib/swapsApi';
import { cn, fromSmallestUnit, toSmallestUnit } from '@/lib/utils';

type Token = SwapTokenV2;

function toIntentRequest(r: IntentResponseV2): IntentRequestV2 {
  return {
    ...r,
    intentId: BigInt(r.intentId),
    inputAmount: BigInt(r.inputAmount),
    minOutputAmount: BigInt(r.minOutputAmount),
    deadline: BigInt(r.deadline),
    srcChain: BigInt(r.srcChain),
    dstChain: BigInt(r.dstChain),
  };
}

// `tx` is now a typed `RawTxReturnType` (value already a bigint); just narrow the union to its EVM
// variant. The union is structurally ambiguous (EVM/Solana/Sui/Stellar share a shape); this app is EVM-only.
function asEvmRawTx(tx: RawTxReturnType): EvmRawTransaction {
  return tx as EvmRawTransaction;
}

/** Chains whose signing is wired here. EVM is verified end-to-end; the others call the right provider
 *  method but the backend types `tx` as `unknown` (chain-specific), so their casts are assumptions to
 *  verify with a real wallet. Bitcoin/Stellar/Injective/NEAR need a sign→broadcast flow not wired yet. */
const SIGNABLE: readonly ChainType[] = ['EVM', 'SOLANA', 'SUI', 'STACKS', 'ICON'];

/** Sign + broadcast one unsigned tx through the source chain's wallet — the per-chain `if/else`.
 *  Returns the tx hash / signature. */
async function signTx(provider: object, chainType: ChainType, tx: unknown): Promise<string> {
  switch (chainType) {
    case 'EVM':
      return (provider as IEvmWalletProvider).sendTransaction(asEvmRawTx(tx as RawTxReturnType));
    case 'SOLANA': {
      const p = provider as ISolanaWalletProvider;
      return p.sendTransaction(tx as Parameters<typeof p.sendTransaction>[0]);
    }
    case 'SUI': {
      const p = provider as ISuiWalletProvider;
      return p.signAndExecuteTxn(tx as Parameters<typeof p.signAndExecuteTxn>[0]);
    }
    case 'STACKS': {
      const p = provider as IStacksWalletProvider;
      return p.sendTransaction(tx as Parameters<typeof p.sendTransaction>[0]);
    }
    case 'ICON': {
      const p = provider as IIconWalletProvider;
      return p.sendTransaction(tx as Parameters<typeof p.sendTransaction>[0]);
    }
    default:
      throw new Error(
        `This example doesn't wire ${chainType} signing yet — it needs a chain-specific sign→broadcast flow. ` +
          `The unsigned tx from createIntent is available; sign it with a ${chainType} wallet.`,
      );
  }
}

function errorText(e: unknown): string {
  if (e instanceof SwapsApiError) {
    const body = e.context.body as { message?: string } | undefined;
    return body?.message ?? e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export function SwapCard() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [srcChain, setSrcChain] = useState('');
  const [dstChain, setDstChain] = useState('');
  const [srcAddr, setSrcAddr] = useState('');
  const [dstAddr, setDstAddr] = useState('');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<string>();
  const [quoteError, setQuoteError] = useState('');
  const [slippage, setSlippage] = useState('0.5');
  const [busy, setBusy] = useState(false);
  const [swapLog, setSwapLog] = useState('');

  // Account + provider for the SOURCE chain (any chain), so signing isn't hardcoded to EVM.
  const account = useXAccount({ xChainId: srcChain as SpokeChainKey });
  const walletProvider = useWalletProvider({ xChainId: srcChain as SpokeChainKey });
  const srcChainType = srcChain ? getXChainType(srcChain as SpokeChainKey) : undefined;

  const chainOptions = useMemo<Option[]>(
    () => [...new Set(tokens.map(t => t.chainKey))].sort().map(c => ({ value: c, label: c })),
    [tokens],
  );
  const srcTokens = useMemo(() => tokens.filter(t => t.chainKey === srcChain), [tokens, srcChain]);
  const dstTokens = useMemo(() => tokens.filter(t => t.chainKey === dstChain), [tokens, dstChain]);
  const src = useMemo(() => srcTokens.find(t => t.address === srcAddr), [srcTokens, srcAddr]);
  const dst = useMemo(() => dstTokens.find(t => t.address === dstAddr), [dstTokens, dstAddr]);

  const tokenOptions = (list: Token[]): Option[] =>
    list.map(t => ({ value: t.address, label: t.symbol, sublabel: t.name }));

  useEffect(() => {
    swapsApi
      .getTokens()
      .then(byChain => {
        const all = Object.values(byChain).flat();
        setTokens(all);
        const keys = [...new Set(all.map(t => t.chainKey))].sort();
        setSrcChain(c => c || keys.find(k => k === 'sonic') || keys[0] || '');
        setDstChain(c => c || keys.find(k => k !== 'sonic') || '');
      })
      .catch(e => setSwapLog(`Couldn't load tokens: ${errorText(e)}`));
  }, []);

  // Live quote. Clearing at the top means a newer (or successful) quote always wipes a stale error.
  useEffect(() => {
    setQuote(undefined);
    setQuoteError('');
    if (!src || !dst || !amount || Number(amount) <= 0) return;
    let cancelled = false;
    swapsApi
      .getQuote({
        tokenSrc: src.address,
        tokenSrcChainKey: src.chainKey,
        tokenDst: dst.address,
        tokenDstChainKey: dst.chainKey,
        amount: toSmallestUnit(amount, src.decimals),
        quoteType: 'exact_input',
      })
      .then(q => !cancelled && setQuote(q.quotedAmount))
      .catch(e => !cancelled && setQuoteError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [src, dst, amount]);

  function flip() {
    setSrcChain(dstChain);
    setDstChain(srcChain);
    setSrcAddr(dstAddr);
    setDstAddr(srcAddr);
  }

  const quoted = quote && dst ? fromSmallestUnit(quote, dst.decimals) : undefined;
  const rate =
    quoted && Number(amount) > 0 ? (Number(quoted) / Number(amount)).toFixed(6).replace(/\.?0+$/, '') : undefined;

  // Min output after slippage (raw smallest units), like Robi's SwapCard. slippage% → basis points;
  // BigInt floor keeps precision on large amounts. Invalid slippage (NaN/<0/>100) → undefined, blocking the swap.
  const minOutputAmount = useMemo(() => {
    const s = Number(slippage);
    if (!quote || !Number.isFinite(s) || s < 0 || s > 100) return undefined;
    return ((BigInt(quote) * BigInt(Math.round((100 - s) * 100))) / 10000n).toString();
  }, [quote, slippage]);
  const minReceived = minOutputAmount && dst ? fromSmallestUnit(minOutputAmount, dst.decimals) : undefined;

  const signable = Boolean(srcChainType && SIGNABLE.includes(srcChainType));
  const canSwap = Boolean(account.address && walletProvider && src && dst && amount && minOutputAmount && signable);

  async function onSwap() {
    if (!src || !dst || !walletProvider || !account.address || !srcChainType) return;
    if (!minOutputAmount) {
      setSwapLog('Enter an amount and wait for the quote before swapping.');
      return;
    }
    setBusy(true);
    setSwapLog('');
    try {
      const params: CreateIntentParamsV2 = {
        srcChainKey: src.chainKey,
        dstChainKey: dst.chainKey,
        inputToken: src.address,
        outputToken: dst.address,
        inputAmount: toSmallestUnit(amount, src.decimals),
        minOutputAmount,
        deadline: (await swapsApi.getDeadline()).deadline,
        allowPartialFill: false,
        srcAddress: account.address,
        dstAddress: account.address,
      };

      const allowance = await swapsApi.checkAllowance(params);
      if (!allowance.valid) {
        setSwapLog('Approve the source token in your wallet…');
        const approve = await swapsApi.approve(params);
        const approveHash = await signTx(walletProvider, srcChainType, approve.tx);
        // Wait until the approval is mined (EVM) — otherwise createIntent's tx can revert on a stale allowance.
        if (srcChainType === 'EVM') {
          setSwapLog('Waiting for approval to confirm…');
          await (walletProvider as IEvmWalletProvider).waitForTransactionReceipt(
            approveHash as Parameters<IEvmWalletProvider['waitForTransactionReceipt']>[0],
          );
        }
      }

      setSwapLog('Building the swap…');
      const created = await swapsApi.createIntent(params);

      setSwapLog('Confirm the swap in your wallet…');
      const txHash = await signTx(walletProvider, srcChainType, created.tx);

      setSwapLog('Submitting to the relay…');
      await swapsApi.submitTx({
        txHash,
        srcChainKey: src.chainKey,
        walletAddress: account.address,
        intent: toIntentRequest(created.intent),
        relayData: created.relayData.payload,
      });

      setSwapLog(`Submitted ${txHash.slice(0, 10)}… · tracking`);
      for (let i = 0; i < 30; i++) {
        const status = await swapsApi.getSubmitTxStatus({ txHash, srcChainKey: src.chainKey });
        setSwapLog(`Status: ${status.data.status}`);
        if (status.data.status === 'executed' || status.data.status === 'failed') break;
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (e) {
      setSwapLog(`Error: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-[460px] max-w-full rounded-3xl border border-border/70 bg-card p-5 shadow-[0_24px_60px_-30px_rgba(122,13,46,0.45)]">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cherry-soda">SODAX · swaps-api</p>
          <h2 className="text-xl font-semibold tracking-tight">Cross-chain swap</h2>
        </div>
      </div>

      <AssetPanel
        heading="You pay"
        chainOptions={chainOptions}
        chain={srcChain}
        onChainChange={c => {
          setSrcChain(c);
          setSrcAddr('');
        }}
        tokenOptions={tokenOptions(srcTokens)}
        token={srcAddr}
        onTokenChange={setSrcAddr}
      >
        <input
          inputMode="decimal"
          placeholder="0.0"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          className="w-full bg-transparent font-mono text-3xl font-medium tracking-tight outline-none placeholder:text-muted-foreground/50"
        />
      </AssetPanel>

      {/* Signature: the swap-direction control. */}
      <div className="relative z-10 -my-3 flex justify-center">
        <button
          type="button"
          onClick={flip}
          aria-label="Swap direction"
          className="grid size-11 place-items-center rounded-full border-4 border-card bg-cherry-soda text-white shadow-lg transition-transform duration-300 hover:rotate-180 hover:bg-cherry-dark"
        >
          <ArrowDown className="size-4" />
        </button>
      </div>

      <AssetPanel
        heading="You receive"
        chainOptions={chainOptions}
        chain={dstChain}
        onChainChange={c => {
          setDstChain(c);
          setDstAddr('');
        }}
        tokenOptions={tokenOptions(dstTokens)}
        token={dstAddr}
        onTokenChange={setDstAddr}
      >
        <div className="font-mono text-3xl font-medium tracking-tight text-muted-foreground">{quoted ?? '0.0'}</div>
      </AssetPanel>

      <div className="mt-4 flex min-h-5 items-center justify-between text-xs">
        {quoteError ? (
          <span className="text-destructive">{quoteError}</span>
        ) : rate && src && dst ? (
          <span className="text-muted-foreground">
            1 {src.symbol} ≈ <span className="font-mono text-foreground">{rate}</span> {dst.symbol}
          </span>
        ) : (
          <span className="text-muted-foreground">Enter an amount to get a live quote</span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <label className="flex items-center gap-1.5">
          <span>Slippage</span>
          <input
            inputMode="decimal"
            value={slippage}
            onChange={e => setSlippage(e.target.value)}
            className="w-12 rounded-md border border-border/60 bg-secondary/40 px-1.5 py-0.5 text-right font-mono text-foreground outline-none"
          />
          <span>%</span>
        </label>
        {minReceived && dst && (
          <span>
            Min received <span className="font-mono text-foreground">{minReceived}</span> {dst.symbol}
          </span>
        )}
      </div>

      <Button
        variant="cherrySoda"
        className="mt-3 h-12 w-full rounded-xl text-base"
        disabled={!canSwap || busy}
        onClick={onSwap}
      >
        {busy ? 'Working…' : !account.address ? 'Connect an EVM wallet to swap' : 'Swap'}
      </Button>

      {srcChain && !signable && (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Quotes work for any network. Signing is wired for EVM, Solana, Sui, Stacks, and ICON;{' '}
          {srcChainType ?? 'this network'} isn't wired yet.
        </p>
      )}
      {swapLog && (
        <p className="mt-3 rounded-xl bg-secondary px-3 py-2 font-mono text-xs text-foreground/80">{swapLog}</p>
      )}
    </div>
  );
}

function AssetPanel({
  heading,
  chainOptions,
  chain,
  onChainChange,
  tokenOptions,
  token,
  onTokenChange,
  children,
}: {
  heading: string;
  chainOptions: Option[];
  chain: string;
  onChainChange: (v: string) => void;
  tokenOptions: Option[];
  token: string;
  onTokenChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('rounded-2xl border border-border/60 bg-secondary/40 p-4')}>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{heading}</p>
      <div className="mb-3 flex gap-2">
        <div className="w-[46%]">
          <SearchSelect
            options={chainOptions}
            value={chain}
            onChange={onChainChange}
            placeholder="Network"
            searchPlaceholder="Search networks"
          />
        </div>
        <div className="flex-1">
          <SearchSelect
            options={tokenOptions}
            value={token}
            onChange={onTokenChange}
            placeholder="Token"
            searchPlaceholder="Search tokens"
            disabled={!chain}
          />
        </div>
      </div>
      {children}
    </div>
  );
}
