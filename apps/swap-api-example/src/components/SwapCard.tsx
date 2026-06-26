import type {
  CreateIntentParamsV2,
  EvmRawTransaction,
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
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { isEvmChainKey, swapsApi } from '@/lib/swapsApi';
import { fromSmallestUnit, toSmallestUnit } from '@/lib/utils';

type Token = SwapTokenV2;
const tokenKey = (t: Token) => `${t.chainKey}:${t.address}`;

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
  const [srcId, setSrcId] = useState<string>('');
  const [dstId, setDstId] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [quote, setQuote] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string>('');

  const src = useMemo(() => tokens.find(t => tokenKey(t) === srcId), [tokens, srcId]);
  const dst = useMemo(() => tokens.find(t => tokenKey(t) === dstId), [tokens, dstId]);

  // Load the supported tokens once (swaps-api getTokens).
  useEffect(() => {
    swapsApi
      .getTokens()
      .then(byChain => setTokens(Object.values(byChain).flat()))
      .catch(e => setLog(`getTokens failed: ${errorText(e)}`));
  }, []);

  // Live quote whenever src/dst/amount change (swaps-api getQuote).
  useEffect(() => {
    setQuote(undefined);
    if (!src || !dst || !amount || Number(amount) <= 0) return;
    const inputAmount = toSmallestUnit(amount, src.decimals);
    let cancelled = false;
    swapsApi
      .getQuote({
        tokenSrc: src.address,
        tokenSrcChainKey: src.chainKey,
        tokenDst: dst.address,
        tokenDstChainKey: dst.chainKey,
        amount: inputAmount,
        quoteType: 'exact_input',
      })
      .then(q => !cancelled && setQuote(q.quotedAmount))
      .catch(e => !cancelled && setLog(`getQuote: ${errorText(e)}`));
    return () => {
      cancelled = true;
    };
  }, [src, dst, amount]);

  const canSwap = Boolean(account.address && walletProvider && src && dst && amount && isEvmChainKey(src.chainKey));

  async function onSwap() {
    if (!src || !dst || !walletProvider || !account.address) return;
    setBusy(true);
    setLog('');
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

      // 1) Allowance — approve the source token if needed (unsigned tx → wallet).
      const allowance = await swapsApi.checkAllowance(params);
      if (!allowance.valid) {
        setLog('Approving source token…');
        const approve = await swapsApi.approve(params);
        await walletProvider.sendTransaction(approve.tx as EvmRawTransaction);
      }

      // 2) Build the intent (server-side) → unsigned create-intent tx.
      setLog('Creating intent…');
      const created = await swapsApi.createIntent(params);

      // 3) Sign + broadcast the create-intent tx via the connected wallet.
      setLog('Signing & broadcasting…');
      const txHash = await walletProvider.sendTransaction(created.tx as EvmRawTransaction);

      // 4) Hand the broadcast tx to the backend to process the swap server-side.
      setLog('Submitting to relay…');
      await swapsApi.submitTx({
        txHash,
        srcChainKey: src.chainKey,
        walletAddress: account.address,
        intent: toIntentRequest(created.intent),
        relayData: created.relayData.payload,
      });

      // 5) Poll backend processing status until it settles.
      setLog(`Submitted (${txHash}). Tracking status…`);
      for (let i = 0; i < 30; i++) {
        const status = await swapsApi.getSubmitTxStatus({ txHash, srcChainKey: src.chainKey });
        setLog(`Status: ${status.data.status}`);
        if (status.data.status === 'executed' || status.data.status === 'failed') break;
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (e) {
      setLog(`Error: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-[420px]">
      <CardHeader>
        <CardTitle>Swap</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <TokenField label="From" value={srcId} onChange={setSrcId} tokens={tokens} />
        <div>
          <Label>Amount</Label>
          <Input inputMode="decimal" placeholder="0.0" value={amount} onChange={e => setAmount(e.target.value)} />
        </div>
        <TokenField label="To" value={dstId} onChange={setDstId} tokens={tokens} />

        <Separator />
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Quote</span>
          <span>{quote && dst ? `${fromSmallestUnit(quote, dst.decimals)} ${dst.symbol}` : '—'}</span>
        </div>

        <Button variant="cherrySoda" className="w-full" disabled={!canSwap || busy} onClick={onSwap}>
          {busy ? 'Working…' : 'Swap'}
        </Button>

        {src && !isEvmChainKey(src.chainKey) && (
          <p className="text-xs text-muted-foreground">
            Execution here is EVM-only; pick an EVM source chain to swap (quotes work for any chain).
          </p>
        )}
        {log && <pre className="whitespace-pre-wrap rounded-md bg-secondary p-2 text-xs">{log}</pre>}
      </CardContent>
    </Card>
  );
}

function TokenField({
  label,
  value,
  onChange,
  tokens,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  tokens: Token[];
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select token" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {tokens.map(t => (
            <SelectItem key={tokenKey(t)} value={tokenKey(t)}>
              {t.symbol} · {t.chainKey}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
