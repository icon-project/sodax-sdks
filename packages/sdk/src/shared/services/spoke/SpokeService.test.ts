/**
 * Tests for the chain-agnostic balance router on SpokeService — `getWalletBalance` /
 * `getWalletBalances`. These mirror the `getDeposit` router: they dispatch by chain type to the
 * per-chain spoke service and translate a thrown error into an unsuccessful `Result` instead of
 * propagating it. Per-chain read behaviour is covered by each `*SpokeService.test.ts`; here we
 * only assert routing, the chain-key guard, and the Result contract, so the target service method
 * is spied.
 *
 * Both routers hand-duplicate the same 10-arm switch, so the dispatch table below asserts not just
 * that the right service was called but that no OTHER service was — a copy-paste slip between two
 * arms is otherwise invisible.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChainKeys, spokeChainConfig, type Address, type IconAddress, type Hex, type XToken } from '@sodax/types';
import { Sodax } from '../../entities/Sodax.js';
import type { WalletBalanceMap } from './balance-utils.js';

const sodax = new Sodax();
const spoke = sodax.spoke;

const ARB = ChainKeys.ARBITRUM_MAINNET;
const SRC: Address = '0x1111111111111111111111111111111111111111';

const xtoken = (address: Address): XToken => ({
  symbol: 'TKN',
  name: 'TKN',
  decimals: 18,
  address,
  chainKey: ARB,
  hubAsset: address,
  vault: address,
});

/** First real token of a chain, so the router's `token.chainKey === srcChainKey` guard passes. */
const firstToken = (chainKey: keyof typeof spokeChainConfig): XToken => {
  const token = Object.values(spokeChainConfig[chainKey].supportedTokens)[0];
  if (!token) throw new Error(`no supported tokens configured for ${chainKey}`);
  return token;
};

afterEach(() => {
  vi.restoreAllMocks();
});

// =========================================================================
// 1. Dispatch table — every chain-type arm of both routers
// =========================================================================

/**
 * One spy pair per chain service, so a route can assert the other nine stayed untouched. Every spy
 * is stubbed: an un-stubbed `spyOn` calls through, and these methods open real RPC connections.
 */
const stub = <S extends { getWalletBalance: unknown; getWalletBalances: unknown }>(service: S) =>
  [
    vi.spyOn(service as { getWalletBalance: () => Promise<bigint> }, 'getWalletBalance').mockResolvedValue(0n),
    vi
      .spyOn(service as { getWalletBalances: () => Promise<WalletBalanceMap> }, 'getWalletBalances')
      .mockResolvedValue({}),
  ] as const;

const spyEveryService = () => ({
  evm: stub(spoke.evm),
  sonic: stub(spoke.sonic),
  injective: stub(spoke.injective),
  icon: stub(spoke.icon),
  sui: stub(spoke.sui),
  solana: stub(spoke.solana),
  stellar: stub(spoke.stellar),
  bitcoin: stub(spoke.bitcoin),
  near: stub(spoke.near),
  stacks: stub(spoke.stacks),
});

type ServiceName = keyof ReturnType<typeof spyEveryService>;

// `srcAddress` is typed per chain family by `GetAddressType`; each row supplies a value of the
// declared type. (Solana, Stellar, Sui and NEAR declare `Hex`/`Address` even though their real
// addresses are not 0x-prefixed — a pre-existing type wart, harmless here because the per-chain
// service is spied and never parses the value.)
const ROUTES: readonly {
  service: ServiceName;
  callOne: () => Promise<unknown>;
  callMany: () => Promise<unknown>;
}[] = [
  {
    // Sonic is also an EVM chain, so the hub short-circuit must win over the EVM arm.
    service: 'sonic',
    callOne: () =>
      spoke.getWalletBalance({
        srcChainKey: ChainKeys.SONIC_MAINNET,
        srcAddress: SRC,
        token: firstToken(ChainKeys.SONIC_MAINNET),
      }),
    callMany: () =>
      spoke.getWalletBalances({
        srcChainKey: ChainKeys.SONIC_MAINNET,
        srcAddress: SRC,
        tokens: [firstToken(ChainKeys.SONIC_MAINNET)],
      }),
  },
  {
    service: 'evm',
    callOne: () => spoke.getWalletBalance({ srcChainKey: ARB, srcAddress: SRC, token: firstToken(ARB) }),
    callMany: () => spoke.getWalletBalances({ srcChainKey: ARB, srcAddress: SRC, tokens: [firstToken(ARB)] }),
  },
  {
    service: 'injective',
    callOne: () =>
      spoke.getWalletBalance({
        srcChainKey: ChainKeys.INJECTIVE_MAINNET,
        srcAddress: 'inj1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
        token: firstToken(ChainKeys.INJECTIVE_MAINNET),
      }),
    callMany: () =>
      spoke.getWalletBalances({
        srcChainKey: ChainKeys.INJECTIVE_MAINNET,
        srcAddress: 'inj1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
        tokens: [firstToken(ChainKeys.INJECTIVE_MAINNET)],
      }),
  },
  {
    service: 'stellar',
    callOne: () =>
      spoke.getWalletBalance({
        srcChainKey: ChainKeys.STELLAR_MAINNET,
        srcAddress: SRC as Hex,
        token: firstToken(ChainKeys.STELLAR_MAINNET),
      }),
    callMany: () =>
      spoke.getWalletBalances({
        srcChainKey: ChainKeys.STELLAR_MAINNET,
        srcAddress: SRC as Hex,
        tokens: [firstToken(ChainKeys.STELLAR_MAINNET)],
      }),
  },
  {
    service: 'sui',
    callOne: () =>
      spoke.getWalletBalance({
        srcChainKey: ChainKeys.SUI_MAINNET,
        srcAddress: SRC as Hex,
        token: firstToken(ChainKeys.SUI_MAINNET),
      }),
    callMany: () =>
      spoke.getWalletBalances({
        srcChainKey: ChainKeys.SUI_MAINNET,
        srcAddress: SRC as Hex,
        tokens: [firstToken(ChainKeys.SUI_MAINNET)],
      }),
  },
  {
    service: 'icon',
    callOne: () =>
      spoke.getWalletBalance({
        srcChainKey: ChainKeys.ICON_MAINNET,
        srcAddress: 'hx0000000000000000000000000000000000000001' as IconAddress,
        token: firstToken(ChainKeys.ICON_MAINNET),
      }),
    callMany: () =>
      spoke.getWalletBalances({
        srcChainKey: ChainKeys.ICON_MAINNET,
        srcAddress: 'hx0000000000000000000000000000000000000001' as IconAddress,
        tokens: [firstToken(ChainKeys.ICON_MAINNET)],
      }),
  },
  {
    service: 'solana',
    callOne: () =>
      spoke.getWalletBalance({
        srcChainKey: ChainKeys.SOLANA_MAINNET,
        srcAddress: SRC as Hex,
        token: firstToken(ChainKeys.SOLANA_MAINNET),
      }),
    callMany: () =>
      spoke.getWalletBalances({
        srcChainKey: ChainKeys.SOLANA_MAINNET,
        srcAddress: SRC as Hex,
        tokens: [firstToken(ChainKeys.SOLANA_MAINNET)],
      }),
  },
  {
    service: 'stacks',
    callOne: () =>
      spoke.getWalletBalance({
        srcChainKey: ChainKeys.STACKS_MAINNET,
        srcAddress: 'SP000000000000000000002Q6VF78',
        token: firstToken(ChainKeys.STACKS_MAINNET),
      }),
    callMany: () =>
      spoke.getWalletBalances({
        srcChainKey: ChainKeys.STACKS_MAINNET,
        srcAddress: 'SP000000000000000000002Q6VF78',
        tokens: [firstToken(ChainKeys.STACKS_MAINNET)],
      }),
  },
  {
    service: 'bitcoin',
    callOne: () =>
      spoke.getWalletBalance({
        srcChainKey: ChainKeys.BITCOIN_MAINNET,
        srcAddress: 'bc1q5q3xczsl9zlt0gjys5khjknfp40zfdmkme9ene',
        token: firstToken(ChainKeys.BITCOIN_MAINNET),
      }),
    callMany: () =>
      spoke.getWalletBalances({
        srcChainKey: ChainKeys.BITCOIN_MAINNET,
        srcAddress: 'bc1q5q3xczsl9zlt0gjys5khjknfp40zfdmkme9ene',
        tokens: [firstToken(ChainKeys.BITCOIN_MAINNET)],
      }),
  },
  {
    service: 'near',
    callOne: () =>
      spoke.getWalletBalance({
        srcChainKey: ChainKeys.NEAR_MAINNET,
        srcAddress: SRC,
        token: firstToken(ChainKeys.NEAR_MAINNET),
      }),
    callMany: () =>
      spoke.getWalletBalances({
        srcChainKey: ChainKeys.NEAR_MAINNET,
        srcAddress: SRC,
        tokens: [firstToken(ChainKeys.NEAR_MAINNET)],
      }),
  },
];

describe.each(ROUTES)('SpokeService balance router → spoke.$service', ({ service, callOne, callMany }) => {
  it('getWalletBalance dispatches to that service and no other', async () => {
    const spies = spyEveryService();

    await callOne();

    for (const [name, [one]] of Object.entries(spies) as [ServiceName, (typeof spies)[ServiceName]][]) {
      expect(one, `spoke.${name}.getWalletBalance`).toHaveBeenCalledTimes(name === service ? 1 : 0);
    }
  });

  it('getWalletBalances dispatches to that service and no other', async () => {
    const spies = spyEveryService();

    await callMany();

    for (const [name, [, many]] of Object.entries(spies) as [ServiceName, (typeof spies)[ServiceName]][]) {
      expect(many, `spoke.${name}.getWalletBalances`).toHaveBeenCalledTimes(name === service ? 1 : 0);
    }
  });
});

// =========================================================================
// 2. Result contract
// =========================================================================

describe('SpokeService.getWalletBalance (chain-agnostic router)', () => {
  it("routes to the chain-type's spoke service and wraps the value in a Result", async () => {
    const spy = vi.spyOn(spoke.evm, 'getWalletBalance').mockResolvedValueOnce(4_200n);
    const params = { srcChainKey: ARB, srcAddress: SRC, token: xtoken(SRC) };

    const result = await spoke.getWalletBalance(params);

    expect(result).toEqual({ ok: true, value: 4_200n });
    expect(spy).toHaveBeenCalledWith(params);
  });

  it('wraps a thrown error in an unsuccessful Result instead of throwing', async () => {
    const boom = new Error('rpc down');
    vi.spyOn(spoke.evm, 'getWalletBalance').mockRejectedValueOnce(boom);

    const result = await spoke.getWalletBalance({ srcChainKey: ARB, srcAddress: SRC, token: xtoken(SRC) });

    expect(result).toEqual({ ok: false, error: boom });
  });
});

describe('SpokeService.getWalletBalances (chain-agnostic router)', () => {
  it("routes to the chain-type's spoke service and wraps the record in a Result", async () => {
    const record = { [SRC]: 1n };
    const spy = vi.spyOn(spoke.evm, 'getWalletBalances').mockResolvedValueOnce(record);
    const params = { srcChainKey: ARB, srcAddress: SRC, tokens: [xtoken(SRC)] };

    const result = await spoke.getWalletBalances(params);

    expect(result).toEqual({ ok: true, value: record });
    expect(spy).toHaveBeenCalledWith(params);
  });

  it('wraps a thrown error in an unsuccessful Result instead of throwing', async () => {
    const boom = new Error('rpc down');
    vi.spyOn(spoke.evm, 'getWalletBalances').mockRejectedValueOnce(boom);

    const result = await spoke.getWalletBalances({ srcChainKey: ARB, srcAddress: SRC, tokens: [xtoken(SRC)] });

    expect(result).toEqual({ ok: false, error: boom });
  });
});
