import {
  baseChainInfo,
  type ChainKey,
  type CreateIntentParamsV2,
  type IntentResponseV2,
  type IntentRequestV2,
  type IWalletProvider,
  type RawTxReturnType,
  type SolanaRawTransaction,
  type SubmitTxRequestV2,
  type Sodax,
  type EvmRawTransaction,
} from '@sodax/dapp-kit';
import { isAddress, isHex } from 'viem';

export function canExecute(chain: ChainKey | undefined): boolean {
  if (!chain) return false;
  const type = baseChainInfo[chain].type;
  return type === 'EVM' || type === 'SOLANA' || type === 'SUI';
}

function isTransfer(tx: RawTxReturnType): tx is SolanaRawTransaction {
  return (
    'from' in tx &&
    typeof tx.from === 'string' &&
    'to' in tx &&
    typeof tx.to === 'string' &&
    'value' in tx &&
    typeof tx.value === 'bigint' &&
    'data' in tx &&
    typeof tx.data === 'string'
  );
}

function isEvmTransfer(tx: RawTxReturnType): tx is EvmRawTransaction {
  return isTransfer(tx) && isAddress(tx.from) && isAddress(tx.to) && isHex(tx.data);
}

export async function broadcast(chain: ChainKey, tx: RawTxReturnType, wallet: IWalletProvider): Promise<string> {
  const network = baseChainInfo[chain];
  if (network.type !== wallet.chainType) throw new Error('Reconnect the wallet for the source network.');
  if (isTransfer(tx)) {
    const account = await wallet.getWalletAddress();
    const matches = wallet.chainType === 'EVM' ? tx.from.toLowerCase() === account.toLowerCase() : tx.from === account;
    if (!matches) throw new Error('The signing account changed. Review the swap again.');
  }
  if (wallet.chainType === 'EVM' && typeof network.chainId === 'number' && isEvmTransfer(tx)) {
    return wallet.sendTransaction(tx, { expectedChainId: network.chainId });
  }
  if (wallet.chainType === 'SOLANA' && isTransfer(tx) && wallet.signAndSendTransaction) {
    return wallet.signAndSendTransaction(tx);
  }
  if (wallet.chainType === 'SUI' && isTransfer(tx)) {
    return wallet.signAndExecuteTxn({ toJSON: async () => tx.data });
  }
  throw new Error('This wallet cannot sign this transaction. Try another wallet.');
}

export function toIntentRequest(intent: IntentResponseV2): IntentRequestV2 {
  return {
    ...intent,
    intentId: BigInt(intent.intentId),
    inputAmount: BigInt(intent.inputAmount),
    minOutputAmount: BigInt(intent.minOutputAmount),
    deadline: BigInt(intent.deadline),
    srcChain: BigInt(intent.srcChain),
    dstChain: BigInt(intent.dstChain),
  };
}

export type ExecutionPhase = 'checking' | 'approving' | 'building' | 'signing' | 'submitting';

export type ExecutionDependencies = {
  api: Pick<Sodax['api']['swaps'], 'getQuote' | 'checkAllowance' | 'getDeadline' | 'createIntent' | 'submitTx'>;
  approve: (body: CreateIntentParamsV2) => Promise<void>;
  sign: (tx: RawTxReturnType) => Promise<string>;
  onPhase: (phase: ExecutionPhase) => void;
  onBroadcast: (request: SubmitTxRequestV2, intent: IntentResponseV2) => void;
};

/** Persist the broadcast before relay submission; retries must never sign a second deposit. */
export async function executeSwap(body: CreateIntentParamsV2, deps: ExecutionDependencies): Promise<void> {
  const { api, onPhase } = deps;
  const checkQuote = async () => {
    const quote = await api.getQuote({
      tokenSrcChainKey: body.srcChainKey,
      tokenDstChainKey: body.dstChainKey,
      tokenSrc: body.inputToken,
      tokenDst: body.outputToken,
      amount: body.inputAmount,
      quoteType: 'exact_input',
      ...(body.partnerFee ? { partnerFee: body.partnerFee } : {}),
    });
    if (!quote.ok) throw quote.error;
    if (BigInt(quote.value.quotedAmount) < BigInt(body.minOutputAmount)) {
      throw new Error('The quote changed beyond your slippage. Review a new quote before swapping.');
    }
  };
  onPhase('checking');
  await checkQuote();
  const allowance = await api.checkAllowance(body);
  if (!allowance.ok) throw allowance.error;
  if (!allowance.value.valid) {
    onPhase('approving');
    await deps.approve(body);
    await checkQuote();
  }
  const deadline = await api.getDeadline();
  if (!deadline.ok) throw deadline.error;
  onPhase('building');
  const created = await api.createIntent({ ...body, deadline: deadline.value.deadline });
  if (!created.ok) throw created.error;
  onPhase('signing');
  const txHash = await deps.sign(created.value.tx);
  const request: SubmitTxRequestV2 = {
    txHash,
    srcChainKey: body.srcChainKey,
    walletAddress: body.srcAddress,
    intent: toIntentRequest(created.value.intent),
    relayData: created.value.relayData.payload,
  };
  deps.onBroadcast(request, created.value.intent);
  onPhase('submitting');
  const submitted = await api.submitTx(request);
  if (!submitted.ok) throw submitted.error;
  if (!submitted.value.success) throw new Error('The relay has not accepted this swap yet. Retry tracking.');
}

export function executionError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Could not complete this step. Please try again.';
  if (/reject|denied|cancelled by user|canceled by user/i.test(message))
    return 'Request declined in your wallet. You can try again.';
  return message;
}
