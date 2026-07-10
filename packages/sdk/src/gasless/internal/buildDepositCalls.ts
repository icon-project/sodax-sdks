import type { Address, Hex } from '@sodax/types';
import { Erc20Service } from '../../shared/services/erc-20/Erc20Service.js';
import type { SpokeService } from '../../shared/services/spoke/SpokeService.js';
import type { ConfigService } from '../../shared/config/ConfigService.js';
import type { RelayExtraData } from '../../shared/types/types.js';
import type { GaslessDepositParams } from '../GaslessTypes.js';

/** A single call in the atomic batch: viem `Call` shape (`{ to, data, value }`). */
export type GaslessCall = { to: Address; data: Hex; value: bigint };

/**
 * Build the two calls of a gasless deposit — `approve(assetManager, amount)` then
 * `assetManager.transfer(token, to, amount, data)` — reusing the existing encoders rather than
 * re-deriving calldata. Order matters: approve must precede transfer.
 *
 * The transfer leaf is produced via {@link EvmSpokeService.deposit} in raw mode so the exact
 * calldata (and any chain-specific value handling) stays in one place; for ERC20 tokens its
 * `value` is `0n`.
 */
export async function buildDepositCalls(
  spoke: SpokeService,
  config: ConfigService,
  params: GaslessDepositParams,
): Promise<{ calls: [GaslessCall, GaslessCall]; relayData: RelayExtraData }> {
  const assetManager = config.getChainConfig(params.srcChainKey).addresses.assetManager;

  const transferTx = await spoke.evm.deposit<true>({
    srcChainKey: params.srcChainKey,
    srcAddress: params.srcAddress,
    to: params.to,
    token: params.token,
    amount: params.amount,
    data: params.data,
    raw: true,
  });

  const approve = Erc20Service.encodeApprove(params.token, assetManager, params.amount);

  const calls: [GaslessCall, GaslessCall] = [
    { to: approve.address, data: approve.data, value: approve.value },
    { to: transferTx.to, data: transferTx.data, value: transferTx.value },
  ];

  return { calls, relayData: { address: params.to, payload: params.data } };
}
