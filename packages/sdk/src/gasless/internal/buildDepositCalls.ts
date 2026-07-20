import type { Address, Hex } from '@sodax/types';
import { Erc20Service } from '../../shared/services/erc-20/Erc20Service.js';
import type { SpokeService } from '../../shared/services/spoke/SpokeService.js';
import type { ConfigService } from '../../shared/config/ConfigService.js';
import type { RelayExtraData } from '../../shared/types/types.js';
import type { GaslessBatchInput } from '../GaslessTypes.js';

/** A single call in the atomic batch: viem `Call` shape (`{ to, data, value }`). */
export type GaslessCall = { to: Address; data: Hex; value: bigint };

/** Build the two calls of a gasless deposit — `approve(assetManager, amount)` then `assetManager.transfer(token, to, amount, data)` (order matters) — reusing the existing encoders; the transfer leaf comes from {@link EvmSpokeService.deposit} in raw mode. */
export async function buildDepositCalls(
  spoke: SpokeService,
  config: ConfigService,
  params: GaslessBatchInput,
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
