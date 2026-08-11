import type { Transaction } from '@mysten/sui/transactions';
import type { SuiExecutionResult, SuiGasEstimate, SuiPaginatedCoins, SuiRawTransactionReceipt } from '@sodax/types';

export type SuiWaitForTransactionParams = {
  digest: string;
  timeoutMs: number;
  pollingIntervalMs: number;
};

/**
 * Sui reads in `@sodax/types` vocabulary. Keeps the `@mysten/sui` client out of the SDK's
 * published `.d.ts`, which has no node10 resolution fallback.
 */
export interface SuiTransport {
  readonly endpoint: string;
  getCoins(owner: string, coinType: string, limit?: number): Promise<SuiPaginatedCoins>;
  simulate(tx: Transaction, sender: string): Promise<SuiExecutionResult>;
  estimateGas(tx: Transaction, sender: string): Promise<SuiGasEstimate>;
  fetchLatestPackageId(objectId: string): Promise<string>;
  waitForTransaction(params: SuiWaitForTransactionParams): Promise<SuiRawTransactionReceipt>;
}
