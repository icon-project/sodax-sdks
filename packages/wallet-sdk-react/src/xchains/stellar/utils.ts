import {
  Address,
  Contract,
  type Memo,
  type MemoType,
  type Operation,
  rpc,
  TimeoutInfinite,
  type Transaction,
  type TransactionBuilder,
  scValToBigInt,
} from '@stellar/stellar-sdk';
import type CustomSorobanServer from './CustomSorobanServer.js';

export const STELLAR_RLP_MSG_TYPE = { type: 'symbol' };

// Can be used whenever you need an Address argument for a contract method
export const accountToScVal = (account: string) => new Address(account).toScVal();

export const simulateTx = (
  tx: Transaction<Memo<MemoType>, Operation[]>,
  server: CustomSorobanServer,
): Promise<rpc.Api.SimulateTransactionResponse> => server.simulateTransaction(tx);

export const getTokenBalance = async (
  address: string,
  tokenId: string,
  txBuilder: TransactionBuilder,
  server: CustomSorobanServer,
) => {
  const params = [accountToScVal(address)];
  const contract = new Contract(tokenId);
  const tx = txBuilder
    .addOperation(contract.call('balance', ...params))
    .setTimeout(TimeoutInfinite)
    .build();

  const result = await simulateTx(tx, server);

  // Also throws on restore responses — invalid for read-only balance simulation
  if (!rpc.Api.isSimulationSuccess(result)) {
    throw new Error(`Simulation failed: ${JSON.stringify(result)}`);
  }

  return result.result ? scValToBigInt(result.result.retval) : 0n;
};
