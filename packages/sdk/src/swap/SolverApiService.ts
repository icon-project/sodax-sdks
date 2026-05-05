import invariant from 'tiny-invariant';
import { retry } from '../shared/utils/shared-utils.js';
import type { ConfigService } from '../shared/config/ConfigService.js';
import {
  SolverIntentErrorCode,
  type Result,
  type SolverConfig,
  type SolverErrorResponse,
  type SolverExecutionRequest,
  type SolverExecutionResponse,
  type SolverIntentQuoteRequest,
  type SolverIntentQuoteResponse,
  type SolverIntentQuoteResponseRaw,
  type SolverIntentStatusRequest,
  type SolverIntentStatusResponse,
} from '@sodax/types';

/**
 * Stateless HTTP client for the SODAX solver API.
 *
 * All methods are `static` — this class is never instantiated and holds no state.
 * It encapsulates the three solver API endpoints:
 * - `/quote`    — get a price quote for a token swap
 * - `/execute`  — notify the solver that an intent is live on the hub chain
 * - `/status`   — poll the execution status of a submitted intent
 *
 * `SwapService` delegates all solver API communication to this class. External callers
 * should use `SwapService` rather than calling `SolverApiService` directly.
 */
export class SolverApiService {
  private constructor() {}

  /**
   * Requests a price quote from the solver API (`POST /quote`).
   *
   * Validates that both tokens are supported by the active config, translates spoke-chain token
   * addresses to their hub (Sonic) equivalents, then forwards the request to the solver.
   * The returned `quoted_amount` is in the destination token's smallest unit.
   *
   * @param payload - Quote request with source/destination tokens, chain IDs, amount, and quote type.
   * @param config - Solver endpoint and contract configuration.
   * @param configService - Used to validate tokens and resolve hub asset addresses.
   * @returns A `Result` containing `{ quoted_amount: bigint }` on success, or a
   *   `SolverErrorResponse` (with a `SolverIntentErrorCode`) on failure.
   * @throws Invariant errors for empty fields or unsupported token addresses (thrown before the async request).
   */
  public static async getQuote(
    payload: SolverIntentQuoteRequest,
    config: SolverConfig,
    configService: ConfigService,
  ): Promise<Result<SolverIntentQuoteResponse, SolverErrorResponse>> {
    invariant(payload.token_src.length > 0, 'Empty token_src');
    invariant(payload.token_src_blockchain_id.length > 0, 'Empty token_src_blockchain_id');
    invariant(payload.token_dst.length > 0, 'Empty token_dst');
    invariant(payload.token_dst_blockchain_id.length > 0, 'Empty token_dst_blockchain_id');
    invariant(payload.amount > 0n, 'amount must be greater than 0');
    invariant(
      configService.isValidOriginalAssetAddress(payload.token_src_blockchain_id, payload.token_src),
      'unsupported token_src for src chain',
    );
    invariant(
      configService.isValidOriginalAssetAddress(payload.token_dst_blockchain_id, payload.token_dst),
      'unsupported token_dst for dst chain',
    );

    const tokenSrc = configService.getSpokeTokenFromOriginalAssetAddress(
      payload.token_src_blockchain_id,
      payload.token_src,
    )?.hubAsset;
    const tokenDst = configService.getSpokeTokenFromOriginalAssetAddress(
      payload.token_dst_blockchain_id,
      payload.token_dst,
    )?.hubAsset;

    invariant(tokenSrc, 'hub asset not found for token_src');
    invariant(tokenDst, 'hub asset not found for token_dst');

    try {
      const response = await fetch(`${config.solverApiEndpoint}/quote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token_src: tokenSrc,
          token_dst: tokenDst,
          amount: payload.amount.toString(),
          quote_type: payload.quote_type,
        }),
      });

      if (!response.ok) {
        return {
          ok: false,
          error: await response.json(),
        };
      }

      const quoteResponse: SolverIntentQuoteResponseRaw = await response.json();

      return {
        ok: true,
        value: {
          quoted_amount: BigInt(quoteResponse.quoted_amount),
        } satisfies SolverIntentQuoteResponse,
      };
    } catch (e: unknown) {
      console.error(`[SolverApiService.getQuote] failed. Details: ${JSON.stringify(e)}`);
      return {
        ok: false,
        error: {
          detail: {
            code: SolverIntentErrorCode.UNKNOWN,
            message: e ? JSON.stringify(e) : 'Unknown error',
          },
        },
      };
    }
  }

  /**
   * Notifies the solver that an intent is live on the hub chain (`POST /execute`).
   *
   * The request body contains only `intent_tx_hash` — the hub-chain transaction hash where
   * the intent was registered. The solver uses this to locate and start filling the intent.
   * The request is retried automatically on transient network failures.
   *
   * @param request - Object containing `intent_tx_hash` (the hub-chain tx hash of the created intent).
   * @param config - Solver endpoint configuration.
   * @returns A `Result` containing `{ answer: 'OK', intent_hash: Hex }` on success.
   */
  public static async postExecution(
    request: SolverExecutionRequest,
    config: SolverConfig,
  ): Promise<Result<SolverExecutionResponse, SolverErrorResponse>> {
    try {
      const response = await retry(() =>
        fetch(`${config.solverApiEndpoint}/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        }),
      );

      if (!response.ok) {
        return {
          ok: false,
          error: await response.json(),
        };
      }

      return {
        ok: true,
        value: await response.json(),
      };
    } catch (e: unknown) {
      console.error(`[SolverApiService.postExecution] failed. Details: ${JSON.stringify(e)}`);
      return {
        ok: false,
        error: {
          detail: {
            code: SolverIntentErrorCode.UNKNOWN,
            message: e ? JSON.stringify(e) : 'Unknown error',
          },
        },
      };
    }
  }

  /**
   * Polls the solver API for the current execution status of an intent (`POST /status`).
   *
   * @param request - Object containing `intent_tx_hash` — the hub-chain tx hash of the intent.
   * @param config - Solver endpoint configuration.
   * @returns A `Result` containing `{ status: SolverIntentStatusCode, fill_tx_hash?: string }`.
   *   `fill_tx_hash` is set only when `status === SolverIntentStatusCode.SOLVED (3)`.
   * @throws Invariant error if `intent_tx_hash` is empty (thrown before the async request).
   */
  public static async getStatus(
    request: SolverIntentStatusRequest,
    config: SolverConfig,
  ): Promise<Result<SolverIntentStatusResponse, SolverErrorResponse>> {
    invariant(request.intent_tx_hash.length > 0, 'Empty intent_tx_hash');
    try {
      const response = await fetch(`${config.solverApiEndpoint}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        return {
          ok: false,
          error: await response.json(),
        };
      }

      return {
        ok: true,
        value: await response.json(),
      };
    } catch (e: unknown) {
      console.error(`[SolverApiService.getStatus] failed. Details: ${JSON.stringify(e)}`);
      return {
        ok: false,
        error: {
          detail: {
            code: SolverIntentErrorCode.UNKNOWN,
            message: e ? JSON.stringify(e) : 'Unknown error',
          },
        },
      };
    }
  }
}
