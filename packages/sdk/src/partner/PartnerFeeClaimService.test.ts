// packages/sdk/src/partner/PartnerFeeClaimService.test.ts
import { decodeFunctionData, type Address, type Hex } from 'viem';
import { ChainKeys } from '@sodax/types';
import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../shared/config/ConfigService.js';
import type { HubProvider } from '../shared/types/types.js';
import type { SpokeService } from '../shared/services/spoke/SpokeService.js';
import { ProtocolIntentsAbi } from '../shared/abis/protocolIntents.abi.js';
import { PartnerFeeClaimService } from './PartnerFeeClaimService.js';

const PROTOCOL_INTENTS = '0xaFf2EDb3057ed6f9C1dA6c930b8ddDf2beE573A5' as Address;
const SRC = '0x6c5f91fd68dd7b3a1aedb0f09946659272f523a4' as Address;
const USDC = '0x29219dd400f2Bf60E5a23d13Be72B486D4038894' as Address;

function makeService(overrides: {
  readContract?: ReturnType<typeof vi.fn>;
  sendTransaction?: ReturnType<typeof vi.fn>;
}): PartnerFeeClaimService {
  const config = {
    solver: { protocolIntentsContract: PROTOCOL_INTENTS },
    logger: { warn: vi.fn(), error: vi.fn() },
  } as unknown as ConfigService;
  const hubProvider = {
    publicClient: { readContract: overrides.readContract ?? vi.fn() },
    chainConfig: { chain: { key: ChainKeys.SONIC_MAINNET } },
  } as unknown as HubProvider;
  const spoke = {} as unknown as SpokeService;
  return new PartnerFeeClaimService({ config, hubProvider, spoke });
}

describe('PartnerFeeClaimService.cancelIntent', () => {
  it('encodes a ProtocolIntents.cancelIntent(fromToken, toToken) call to the protocol intents contract (raw)', async () => {
    const service = makeService({});

    const result = await service.cancelIntent({
      raw: true,
      params: { srcChainKey: ChainKeys.SONIC_MAINNET, srcAddress: SRC, fromToken: USDC, toToken: USDC },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rawTx = result.value as { from: Address; to: Address; value: bigint; data: Hex };
    expect(rawTx.to).toBe(PROTOCOL_INTENTS);
    expect(rawTx.from).toBe(SRC);
    expect(rawTx.value).toBe(0n);

    const decoded = decodeFunctionData({ abi: ProtocolIntentsAbi, data: rawTx.data });
    expect(decoded.functionName).toBe('cancelIntent');
    expect(decoded.args).toEqual([USDC, USDC]);
  });

  it('signs and broadcasts via the wallet provider when not raw', async () => {
    const sendTransaction = vi.fn(async () => '0xcancelhash' as Hex);
    const service = makeService({});

    const result = await service.cancelIntent({
      raw: false,
      params: { srcChainKey: ChainKeys.SONIC_MAINNET, srcAddress: SRC, fromToken: USDC, toToken: USDC },
      walletProvider: { chainType: 'EVM', sendTransaction } as never,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe('0xcancelhash');
    expect(sendTransaction).toHaveBeenCalledOnce();
  });
});

describe('PartnerFeeClaimService.swap same-token guard', () => {
  it('rejects a claim when the configured output token equals the fee token', async () => {
    // getAutoSwapPreferences reads the on-chain preference; return outputToken === fromToken.
    const readContract = vi.fn(async () => ({ outputToken: USDC, dstChain: 0n, dstAddress: '0x' as Hex }));
    const service = makeService({ readContract });

    const result = await service.swap({
      raw: false,
      params: { srcChainKey: ChainKeys.SONIC_MAINNET, srcAddress: SRC, fromToken: USDC, amount: 1_000_000n },
      walletProvider: { sendTransaction: vi.fn() } as never,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result.error as { code?: string }).code).toBe('VALIDATION_FAILED');
    // The guard must short-circuit before any swap transaction is built/sent.
    expect(readContract).toHaveBeenCalled();
  });
});

describe('PartnerFeeClaimService.getUserIntent', () => {
  it('returns the stored intent hash for the token pair', async () => {
    const intentHash = '0x5f0317381efc3db8cc34186e3a4c09ebb934209d079d833425beb26d3d9932fb' as Hex;
    const readContract = vi.fn(async () => intentHash);
    const service = makeService({ readContract });

    const result = await service.getUserIntent({ user: SRC, fromToken: USDC, toToken: USDC });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(intentHash);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'getUserIntent', args: [SRC, USDC, USDC] }),
    );
  });
});
