import {
  ChainKeys,
  type CreateIntentParamsV2,
  type IntentResponseV2,
  type EvmRawTransaction,
  type ISuiWalletProvider,
} from '@sodax/dapp-kit';
import { describe, expect, it, vi } from 'vitest';
import { executeSwap, canExecute, toIntentRequest, broadcast, type ExecutionDependencies } from './execution';
import { readActivity, submissionFor, type Activity } from './activity';

const address = '0x1234567890abcdef1234567890abcdef12345678';
const tx: EvmRawTransaction = { from: address, to: address, value: 0n, data: '0x' };
const body: CreateIntentParamsV2 = {
  srcChainKey: ChainKeys.BASE_MAINNET,
  dstChainKey: ChainKeys.SOLANA_MAINNET,
  srcAddress: address,
  dstAddress: 'recipient',
  inputToken: address,
  outputToken: 'mint',
  inputAmount: '1000000',
  minOutputAmount: '990',
  deadline: '0',
  allowPartialFill: false,
  partnerFee: { address, percentage: 25 },
};
const intent: IntentResponseV2 = {
  intentId: '9007199254740993',
  creator: address,
  inputToken: address,
  outputToken: address,
  inputAmount: '1000000',
  minOutputAmount: '990',
  deadline: '2000000000',
  allowPartialFill: false,
  srcChain: '8453',
  dstChain: '123',
  srcAddress: address,
  dstAddress: address,
  solver: address,
  data: '0x',
};

function setup(allowed = true) {
  const calls: string[] = [];
  const deps: ExecutionDependencies = {
    api: {
      getQuote: vi.fn(async () => ({ ok: true as const, value: { quotedAmount: '1000' } })),
      checkAllowance: vi.fn(async () => ({ ok: true as const, value: { valid: allowed } })),
      getDeadline: vi.fn(async () => ({ ok: true as const, value: { deadline: '2000000000' } })),
      createIntent: vi.fn(async () => ({
        ok: true as const,
        value: { tx, intent, relayData: { address, payload: '0x00' } },
      })),
      submitTx: vi.fn(async () => {
        calls.push('submit');
        return { ok: true as const, value: { success: true, data: { status: 'inserted' as const, message: 'OK' } } };
      }),
    },
    approve: vi.fn(async () => {
      calls.push('approve');
    }),
    sign: vi.fn(async () => {
      calls.push('sign');
      return '0x1234';
    }),
    onPhase: vi.fn(),
    onBroadcast: vi.fn(() => calls.push('save')),
  };
  return { deps, calls };
}

describe('swap execution', () => {
  it('persists the broadcast before submitting and uses the reviewed minimum and partner fee', async () => {
    const { deps, calls } = setup();
    await executeSwap(body, deps);
    expect(calls).toEqual(['sign', 'save', 'submit']);
    expect(deps.api.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({ amount: body.inputAmount, partnerFee: body.partnerFee }),
    );
    expect(deps.api.createIntent).toHaveBeenCalledWith({ ...body, deadline: '2000000000' });
    expect(deps.api.submitTx).toHaveBeenCalledWith(
      expect.objectContaining({ txHash: '0x1234', intent: toIntentRequest(intent) }),
    );
  });
  it('waits for approval and rechecks the price before signing', async () => {
    const { deps, calls } = setup(false);
    await executeSwap(body, deps);
    expect(calls).toEqual(['approve', 'sign', 'save', 'submit']);
    expect(deps.api.getQuote).toHaveBeenCalledTimes(2);
  });
  it('stops before approval when the reviewed minimum is no longer available', async () => {
    const { deps } = setup(false);
    vi.mocked(deps.api.getQuote).mockResolvedValue({ ok: true as const, value: { quotedAmount: '989' } });
    await expect(executeSwap(body, deps)).rejects.toThrow('quote changed');
    expect(deps.approve).not.toHaveBeenCalled();
    expect(deps.sign).not.toHaveBeenCalled();
  });
  it('does not sign a deposit after an approval failure', async () => {
    const { deps } = setup(false);
    vi.mocked(deps.approve).mockRejectedValue(new Error('Approval reverted'));
    await expect(executeSwap(body, deps)).rejects.toThrow('Approval reverted');
    expect(deps.sign).not.toHaveBeenCalled();
    expect(deps.api.submitTx).not.toHaveBeenCalled();
  });
  it('retains the broadcast when the relay is unavailable', async () => {
    const { deps, calls } = setup();
    vi.mocked(deps.api.submitTx).mockResolvedValue({ ok: false, error: new Error('Offline') });
    await expect(executeSwap(body, deps)).rejects.toThrow('Offline');
    expect(calls).toEqual(['sign', 'save']);
    expect(deps.onBroadcast).toHaveBeenCalledWith(expect.objectContaining({ txHash: '0x1234' }), intent);
    expect(deps.sign).toHaveBeenCalledTimes(1);
  });
  it('does not submit or persist when a wallet declines signing', async () => {
    const { deps } = setup();
    vi.mocked(deps.sign).mockRejectedValue(new Error('User rejected'));
    await expect(executeSwap(body, deps)).rejects.toThrow('User rejected');
    expect(deps.onBroadcast).not.toHaveBeenCalled();
    expect(deps.api.submitTx).not.toHaveBeenCalled();
  });
  it('binds EVM signing to the selected chain', async () => {
    const send = vi.fn(async (): Promise<`0x${string}`> => '0x1234');
    await broadcast(ChainKeys.BASE_MAINNET, tx, {
      chainType: 'EVM',
      getWalletAddress: async () => address,
      sendTransaction: send,
      waitForTransactionReceipt: vi.fn(),
    });
    expect(send).toHaveBeenCalledWith(tx, { expectedChainId: 8453 });
  });
  it('rejects a wallet of the wrong family without sending', async () => {
    const send = vi.fn();
    await expect(
      broadcast(ChainKeys.SOLANA_MAINNET, tx, {
        chainType: 'EVM',
        getWalletAddress: async () => address,
        sendTransaction: send,
        waitForTransactionReceipt: vi.fn(),
      }),
    ).rejects.toThrow('Reconnect');
    expect(send).not.toHaveBeenCalled();
  });
  it('keeps unsupported execution families explicit', () => {
    expect(canExecute(ChainKeys.BASE_MAINNET)).toBe(true);
    expect(canExecute(ChainKeys.SOLANA_MAINNET)).toBe(true);
    expect(canExecute(ChainKeys.SUI_MAINNET)).toBe(true);
    expect(canExecute(ChainKeys.BITCOIN_MAINNET)).toBe(false);
    expect(canExecute(ChainKeys.STELLAR_MAINNET)).toBe(false);
  });
  it('refuses a transaction built for another signing account', async () => {
    const send = vi.fn();
    await expect(
      broadcast(ChainKeys.BASE_MAINNET, tx, {
        chainType: 'EVM',
        getWalletAddress: async () => '0x0000000000000000000000000000000000000001',
        sendTransaction: send,
        waitForTransactionReceipt: vi.fn(),
      }),
    ).rejects.toThrow('signing account changed');
    expect(send).not.toHaveBeenCalled();
  });
  it('passes Solana transaction data to its wallet signer', async () => {
    const sign = vi.fn(async () => 'solana-signature');
    const solanaTx = { from: 'solana-account', to: 'program', value: 0n, data: 'base64' };
    expect(
      await broadcast(ChainKeys.SOLANA_MAINNET, solanaTx, {
        chainType: 'SOLANA',
        getWalletAddress: async () => 'solana-account',
        signAndSendTransaction: sign,
        sendTransaction: vi.fn(),
        waitForConfirmation: vi.fn(),
        buildV0Txn: vi.fn(),
        getWalletBase58PublicKey: vi.fn(),
        getAssociatedTokenAddress: vi.fn(),
        getBalance: vi.fn(),
        getTokenAccountBalance: vi.fn(),
      }),
    ).toBe('solana-signature');
    expect(sign).toHaveBeenCalledWith(solanaTx);
  });
  it('passes Sui serialized transaction data to its execution method', async () => {
    const sign = vi.fn<ISuiWalletProvider['signAndExecuteTxn']>(async () => 'sui-digest');
    await broadcast(ChainKeys.SUI_MAINNET, tx, {
      chainType: 'SUI',
      getWalletAddress: async () => address,
      signAndExecuteTxn: sign,
      getCoins: vi.fn(),
      viewContract: vi.fn(),
    });
    expect(await sign.mock.calls[0]?.[0].toJSON()).toBe(tx.data);
  });
});

describe('activity recovery', () => {
  const activity: Activity = {
    txHash: '0x1234',
    srcChainKey: ChainKeys.BASE_MAINNET,
    dstChainKey: ChainKeys.SOLANA_MAINNET,
    walletAddress: address,
    recipient: 'recipient',
    summary: '1 ETH → USDC',
    createdAt: 1000,
    intent,
    relayData: '0x00',
  };
  it('restores the exact relay request without losing bigint precision', () => {
    const restored = readActivity(JSON.stringify(activity));
    expect(restored).toEqual(activity);
    if (!restored) throw new Error('Activity did not restore');
    expect(submissionFor(restored).intent.intentId).toBe(9007199254740993n);
    expect(submissionFor(restored).txHash).toBe(activity.txHash);
  });
  it('rejects corrupted storage and untrusted chain keys', () => {
    expect(readActivity('{')).toBeUndefined();
    expect(readActivity(JSON.stringify({ ...activity, srcChainKey: 'toString' }))).toBeUndefined();
    expect(readActivity(JSON.stringify({ ...activity, intent: { ...intent, inputAmount: '1.5' } }))).toBeUndefined();
    expect(readActivity(JSON.stringify({ ...activity, txHash: '<script>' }))).toBeUndefined();
  });
});
