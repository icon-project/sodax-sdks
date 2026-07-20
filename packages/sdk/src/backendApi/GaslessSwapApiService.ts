import type {
  CreateIntentParamsV2,
  GaslessApiConfig,
  GaslessCapabilitiesRequest,
  GaslessCapabilitiesResponse,
  GaslessSubmitRequest,
  GaslessSubmitResponse,
  GaslessSwapApiErrorCode,
  GaslessSwapBuildCallsResponse,
  GaslessSwapCompleteRequest,
  GaslessSwapPrepareResponse,
  IGaslessSwapApi,
  Result,
  SodaxLogger,
  SubmitTxResponseV2,
  SubmitTxStatusQueryV2,
  SubmitTxStatusResponseV2,
} from '@sodax/types';
import * as v from 'valibot';

import { type RequestOverrideConfig, type ResultifiedWithConfig, makeRequest } from './api-utils.js';
import { isGaslessSwapApiErrorCode } from '../gaslessSwap/errors.js';
import { GaslessCapabilitiesResponseSchema, GaslessSubmitResponseSchema } from './gaslessApiSchemas.js';
import {
  GaslessSwapBuildCallsResponseSchema,
  GaslessSwapPrepareResponseSchema,
  SubmitTxResponseV2Schema,
  SubmitTxStatusResponseV2Schema,
} from './gaslessSwapApiSchemas.js';
import { SodaxError } from '../errors/SodaxError.js';
import { consoleLogger } from '../shared/logger.js';

/** {@link IGaslessSwapApi} with every method returning `Result<T>` + an optional trailing `RequestOverrideConfig`; implemented here (not `IGaslessSwapApi`) because the backend layer returns `{ ok: false }` instead of throwing, yet stays assignable to the brain's `Resultified<IGaslessSwapApi>`. */
type ResultifiedGaslessSwapApiOverHttp = ResultifiedWithConfig<IGaslessSwapApi>;

/**
 * HTTP client for the backend gasless-SWAP API (`/gasless-swap/*`) — the swap-aware gasless contract over
 * HTTP for a dApp with no Pimlico key (no key, no viem). The backend implements {@link IGaslessSwapApi},
 * composing the core SDK internally; this client just POSTs/parses the JSON-safe DTOs against ONE base URL
 * (the gasless backend, `resolveGaslessApiConfig`). All methods return `Promise<Result<T>>` (never throw);
 * failures become a canonical `SodaxError<'EXTERNAL_API_ERROR'>` (`feature: 'backend'`,
 * `context.api: 'gasless-swap'`) with any wire `code` on `context.code`. Reachable as `sodax.api.gaslessSwap`.
 *
 * Mode A's wallet-bound `sendCalls` is off this interface — a browser Mode-A consumer still needs the
 * in-process gasless brain (`sodax.gasless`) present to run the wallet step after `buildSwapCalls`.
 */
export class GaslessSwapApiService implements ResultifiedGaslessSwapApiOverHttp {
  private readonly config: GaslessApiConfig;
  private readonly headers: Record<string, string>;
  private readonly logger: SodaxLogger;

  constructor(config: GaslessApiConfig, logger: SodaxLogger = consoleLogger) {
    this.config = config;
    this.headers = { ...config.headers };
    this.logger = logger;
  }

  /** POST `body` to `endpoint`, validate the JSON response against `schema`, and wrap in `Result<T>`; a transport failure or a schema-invalid 2xx body both become a canonical `SodaxError<'EXTERNAL_API_ERROR'>`. */
  private async post<S extends v.GenericSchema>(
    endpoint: string,
    body: unknown,
    schema: S,
    overrideConfig?: RequestOverrideConfig,
  ): Promise<Result<v.InferOutput<S>, SodaxError<'EXTERNAL_API_ERROR'>>> {
    try {
      const raw = await makeRequest<unknown>({
        endpoint,
        config: {
          method: 'POST',
          body: JSON.stringify(body),
          baseURL: this.config.baseURL,
          timeout: this.config.timeout,
          headers: this.headers,
        },
        overrideConfig,
        logger: this.logger,
        serviceLabel: 'GaslessSwapApiService',
      });
      const parsed = v.safeParse(schema, raw);
      if (!parsed.success) {
        return {
          ok: false,
          error: new SodaxError('EXTERNAL_API_ERROR', `Invalid response shape from gasless-swap API for ${endpoint}`, {
            feature: 'backend',
            context: {
              api: 'gasless-swap',
              endpoint,
              reason: 'invalid_response_shape',
              issues: v.flatten(parsed.issues),
            },
          }),
        };
      }
      return { ok: true, value: parsed.output };
    } catch (error) {
      const { status, code } = extractHttpError(error);
      this.logger.error(`[GaslessSwapApiService] Request to ${endpoint} failed`, error);
      return {
        ok: false,
        error: new SodaxError(
          'EXTERNAL_API_ERROR',
          error instanceof Error ? error.message : `Request to ${endpoint} failed`,
          {
            feature: 'backend',
            cause: error,
            context: { api: 'gasless-swap', endpoint, ...(status !== undefined ? { status } : {}), ...(code ? { code } : {}) },
          },
        ),
      };
    }
  }

  public async getCapabilities(
    body: GaslessCapabilitiesRequest,
    config?: RequestOverrideConfig,
  ): Promise<Result<GaslessCapabilitiesResponse>> {
    return this.post('/gasless-swap/capabilities', body, GaslessCapabilitiesResponseSchema, config);
  }

  public async prepareSwap(
    body: CreateIntentParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<GaslessSwapPrepareResponse>> {
    return this.post('/gasless-swap/prepare', body, GaslessSwapPrepareResponseSchema, config);
  }

  public async submitSwap(
    body: GaslessSubmitRequest,
    config?: RequestOverrideConfig,
  ): Promise<Result<GaslessSubmitResponse>> {
    return this.post('/gasless-swap/submit', body, GaslessSubmitResponseSchema, config);
  }

  public async buildSwapCalls(
    body: CreateIntentParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<GaslessSwapBuildCallsResponse>> {
    return this.post('/gasless-swap/build-calls', body, GaslessSwapBuildCallsResponseSchema, config);
  }

  public async completeSwap(
    body: GaslessSwapCompleteRequest,
    config?: RequestOverrideConfig,
  ): Promise<Result<SubmitTxResponseV2>> {
    return this.post('/gasless-swap/complete', body, SubmitTxResponseV2Schema, config);
  }

  public async getSwapCompletionStatus(
    query: SubmitTxStatusQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<SubmitTxStatusResponseV2>> {
    return this.post('/gasless-swap/completion-status', query, SubmitTxStatusResponseV2Schema, config);
  }

  /** Merge headers (e.g. opaque auth tokens) into every subsequent request. */
  public setHeaders(headers: Record<string, string>): void {
    for (const [key, value] of Object.entries(headers)) {
      this.headers[key] = value;
    }
  }

  /** Return the base URL the service is currently pointing at. */
  public getBaseURL(): string {
    return this.config.baseURL;
  }
}

/** Best-effort extraction of the HTTP status + wire {@link GaslessSwapApiErrorCode} from a {@link makeRequest} transport error (`cause.message` is `HTTP <status>: <body>`); a parse failure yields no code. */
function extractHttpError(error: unknown): { status?: number; code?: GaslessSwapApiErrorCode } {
  const causeMessage = error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined;
  const match = causeMessage ? /^HTTP (\d+): ([\s\S]*)$/.exec(causeMessage) : null;
  if (!match) return {};
  const status = Number(match[1]);
  try {
    const { code } = JSON.parse(match[2] ?? '') as { code?: unknown };
    return isGaslessSwapApiErrorCode(code) ? { status, code } : { status };
  } catch {
    return { status };
  }
}
