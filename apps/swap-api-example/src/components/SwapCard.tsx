import type {
  Address,
  CreateIntentParamsV2,
  EvmRawTransaction,
  Hex,
  IntentRequestV2,
  IntentResponseV2,
  SwapTokenV2,
} from '@sodax/types';
import { SwapsApiError } from '@sodax/swaps-api';
import { useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { isEvmChainKey, swapsApi } from '@/lib/swapsApi';
import { fromSmallestUnit, toSmallestUnit } from '@/lib/utils';

type Token = SwapTokenV2;

/** createIntent returns an IntentResponseV2 (wire strings); submitTx wants an IntentRequestV2 (bigint). */
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

/**
 * The backend returns the EVM tx as JSON ({ from, to, value, data }) with `value` as a decimal
 * string. The wallet provider expects an `EvmRawTransaction` whose `value` is a `bigint`, so coerce
 * it here instead of casting the raw JSON (which would feed viem a string `value`).
 */
function toEvmRawTx(tx: unknown): EvmRawTransaction {
  const t = tx as { from: string; to: string; value: string | number | bigint; data: string };
  return {
    from: t.from as Address,
    to: t.to as Address,
    value: BigInt(t.value ?? 0),
    data: t.data as Hex,
  };
}

function errorText(e: unknown): string {
  if (e instanceof SwapsApiError) {
    const body = e.context.body as { message?: string } | undefined;
    return body?.message ?? e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export function SwapCard() {
  const account = useXAccount({ xChainType: 'EVM' });
  const walletProvider = useWalletProvider({ xChainType: 'EVM' });

  const [tokens, setTokens] = useState<Token[]>([]);
  const [srcChain, setSrcChain] = useState('');
  const [dstChain, setDstChain] = useState('');
  const [srcAddr, setSrcAddr] = useState('');
  const [dstAddr, setDstAddr] = useState('');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<string>();
  const [quoteError, setQuoteError] = useState('');
  const [busy, setBusy] = useState(false);
  const [swapLog, setSwapLog] = useState('');

  const chains = useMemo(() => [...new Set(tokens.map(t => t.chainKey))].sort(), [tokens]);
  const srcTokens = useMemo(() => tokens.filter(t => t.chainKey === srcChain), [tokens, srcChain]);
  const dstTokens = useMemo(() => tokens.filter(t => t.chainKey === dstChain), [tokens, dstChain]);
  const src = useMemo(() => srcTokens.find(t => t.address === srcAddr), [srcTokens, srcAddr]);
  const dst = useMemo(() => dstTokens.find(t => t.address === dstAddr), [dstTokens, dstAddr]);

  // Load supported tokens once and default the networks.
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
      .catch(e => setSwapLog(`getTokens failed: ${errorText(e)}`));
  }, []);

  // Live quote whenever the pair/amount changes. Clearing at the top means a successful (or simply
  // newer) quote always wipes a stale error.
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

  const canSwap = Boolean(account.address && walletProvider && src && dst && amount && isEvmChainKey(srcChain));

  async function onSwap() {
    if (!src || !dst || !walletProvider || !account.address) return;
    setBusy(true);
    setSwapLog('');
    try {
      const params: CreateIntentParamsV2 = {
        srcChainKey: src.chainKey,
        dstChainKey: dst.chainKey,
        inputToken: src.address,
        outputToken: dst.address,
        inputAmount: toSmallestUnit(amount, src.decimals),
        minOutputAmount: quote ?? '1',
        deadline: (await swapsApi.getDeadline()).deadline,
        allowPartialFill: false,
        srcAddress: account.address,
        dstAddress: account.address,
      };

      const allowance = await swapsApi.checkAllowance(params);
      if (!allowance.valid) {
        setSwapLog('Approving source token…');
        const approve = await swapsApi.approve(params);
        await walletProvider.sendTransaction(toEvmRawTx(approve.tx));
      }

      setSwapLog('Creating intent…');
      const created = await swapsApi.createIntent(params);

      setSwapLog('Signing & broadcasting…');
      const txHash = await walletProvider.sendTransaction(toEvmRawTx(created.tx));

      setSwapLog('Submitting to relay…');
      await swapsApi.submitTx({
        txHash,
        srcChainKey: src.chainKey,
        walletAddress: account.address,
        intent: toIntentRequest(created.intent),
        relayData: created.relayData.payload,
      });

      setSwapLog(`Submitted (${txHash}). Tracking status…`);
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
    <Card className="w-[440px]">
      <CardHeader>
        <CardTitle>Swap</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <AssetField
          label="From"
          chains={chains}
          chain={srcChain}
          onChainChange={c => {
            setSrcChain(c);
            setSrcAddr('');
          }}
          tokens={srcTokens}
          token={srcAddr}
          onTokenChange={setSrcAddr}
        />

        <div>
          <Label>Amount</Label>
          <Input inputMode="decimal" placeholder="0.0" value={amount} onChange={e => setAmount(e.target.value)} />
        </div>

        <AssetField
          label="To"
          chains={chains}
          chain={dstChain}
          onChainChange={c => {
            setDstChain(c);
            setDstAddr('');
          }}
          tokens={dstTokens}
          token={dstAddr}
          onTokenChange={setDstAddr}
        />

        <Separator />
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Quote</span>
          <span>{quote && dst ? `${fromSmallestUnit(quote, dst.decimals)} ${dst.symbol}` : '—'}</span>
        </div>
        {quoteError && <p className="text-xs text-destructive">{quoteError}</p>}

        <Button variant="cherrySoda" className="w-full" disabled={!canSwap || busy} onClick={onSwap}>
          {busy ? 'Working…' : 'Swap'}
        </Button>

        {srcChain && !isEvmChainKey(srcChain) && (
          <p className="text-xs text-muted-foreground">
            Execution here is EVM-only; pick an EVM source network to swap (quotes work for any network).
          </p>
        )}
        {swapLog && <pre className="whitespace-pre-wrap rounded-md bg-secondary p-2 text-xs">{swapLog}</pre>}
      </CardContent>
    </Card>
  );
}

function AssetField({
  label,
  chains,
  chain,
  onChainChange,
  tokens,
  token,
  onTokenChange,
}: {
  label: string;
  chains: string[];
  chain: string;
  onChainChange: (v: string) => void;
  tokens: Token[];
  token: string;
  onTokenChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Select value={chain} onValueChange={onChainChange}>
          <SelectTrigger className="w-1/2">
            <SelectValue placeholder="Network" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {chains.map(c => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={token} onValueChange={onTokenChange} disabled={!chain}>
          <SelectTrigger className="w-1/2">
            <SelectValue placeholder="Token" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {tokens.map(t => (
              <SelectItem key={t.address} value={t.address}>
                {t.symbol}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
