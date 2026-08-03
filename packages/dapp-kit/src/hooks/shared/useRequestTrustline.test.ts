import { ChainKeys } from '@sodax/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invalidateQueries = vi.fn();

// The hook is a pure options builder around useSafeMutation, so stubbing the three
// React-side imports lets the real onSuccess run without a DOM.
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('./useSodaxContext.js', () => ({
  useSodaxContext: () => ({ sodax: { spoke: { stellar: { requestTrustline: vi.fn() } } } }),
}));
vi.mock('./useSafeMutation.js', () => ({ useSafeMutation: (options: unknown) => options }));

const { useRequestTrustline } = await import('./useRequestTrustline.js');

const TOKEN = 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

type OnSuccess = (data: string, vars: unknown, ctx: unknown) => Promise<void>;

const vars = (getWalletAddress: () => Promise<string>) => ({
  token: TOKEN,
  amount: 1_000_000n,
  srcChainKey: ChainKeys.STELLAR_MAINNET,
  walletProvider: { getWalletAddress } as never,
});

const onSuccessOf = (): OnSuccess => (useRequestTrustline() as unknown as { onSuccess: OnSuccess }).onSuccess;

const invalidatedKeys = () => invalidateQueries.mock.calls.map(([arg]) => arg.queryKey);

beforeEach(() => {
  invalidateQueries.mockReset();
});

describe('useRequestTrustline — invalidation after a broadcast trustline', () => {
  it('invalidates the account-scoped keys when the address is readable', async () => {
    await onSuccessOf()('hash', vars(async () => ADDRESS), undefined);

    expect(invalidatedKeys()).toEqual([
      ['shared', 'stellarTrustlineCheck', ChainKeys.STELLAR_MAINNET, TOKEN, ADDRESS],
      ['sponsoring', 'stellarAccountStatus', ADDRESS],
      ['shared', 'xBalances', ChainKeys.STELLAR_MAINNET],
    ]);
  });

  it('SURVIVES a wallet that fails right after signing, and still invalidates', async () => {
    // The trustline is already on-chain here: throwing would report success as an
    // error and leave the gate showing "needs a trustline" until a manual refetch.
    const rejecting = vars(async () => {
      throw new Error('wallet is locked');
    });

    await expect(onSuccessOf()('hash', rejecting, undefined)).resolves.toBeUndefined();

    // Falls back to the whole prefix, because the account is no longer identifiable.
    expect(invalidatedKeys()).toEqual([
      ['shared', 'stellarTrustlineCheck'],
      ['sponsoring', 'stellarAccountStatus'],
      ['shared', 'xBalances', ChainKeys.STELLAR_MAINNET],
    ]);
  });
});
