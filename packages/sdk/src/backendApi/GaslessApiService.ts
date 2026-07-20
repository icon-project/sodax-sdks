import type {
  GaslessApiConfig,
  GaslessApiErrorCode,
  GaslessCapabilitiesRequest,
  GaslessCapabilitiesResponse,
  GaslessPrepareRequest,
  GaslessPrepareResponse,
  GaslessSubmitRequest,
  GaslessSubmitResponse,
  IGaslessApi,
  Result,
  SodaxLogger,
} from '@sodax/types';
import * as v from 'valibot';

import { type RequestOverrideConfig, type ResultifiedWithConfig, makeRequest } from './api-utils.js';
import { isGaslessApiErrorCode } from '../gasless/errors.js';
import {
  GaslessCapabilitiesResponseSchema,
  GaslessPrepareResponseSchema,
  GaslessSubmitResponseSchema,
} from './gaslessApiSchemas.js';
import { SodaxError } from '../errors/SodaxError.js';
import { consoleLogger } from '../shared/logger.js';

/** {@link IGaslessApi} with every method returning `Result<T>` + an optional trailing `RequestOverrideConfig`; implemented here (not `IGaslessApi`) because the backend layer returns `{ ok: false }` instead of throwing, yet stays assignable to the brain's `ResultifiedGaslessApi`. */
type ResultifiedGaslessApiOverHttp = ResultifiedWithConfig<IGaslessApi>;

/** HTTP client for the backend Gasless API (`/gasless/*`) — the brain's `getCapabilities`/`prepare`/`submit` contract over HTTP for a dApp with no Pimlico key (no key, no viem). All methods return `Promise<Result<T>>` (never throw); failures become a canonical `SodaxError<'EXTERNAL_API_ERROR'>` (`feature: 'backend'`, `context.api: 'gasless'`) with any wire `code` on `context.code`. Reachable as `sodax.api.gasless`. */
export class GaslessApiService implements ResultifiedGaslessApiOverHttp {
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
        serviceLabel: 'GaslessApiService',
      });
      const parsed = v.safeParse(schema, raw);
      if (!parsed.success) {
        return {
          ok: false,
          error: new SodaxError('EXTERNAL_API_ERROR', `Invalid response shape from gasless API for ${endpoint}`, {
            feature: 'backend',
            context: { api: 'gasless', endpoint, reason: 'invalid_response_shape', issues: v.flatten(parsed.issues) },
          }),
        };
      }
      return { ok: true, value: parsed.output };
    } catch (error) {
      const { status, code } = extractHttpError(error);
      this.logger.error(`[GaslessApiService] Request to ${endpoint} failed`, error);
      return {
        ok: false,
        error: new SodaxError('EXTERNAL_API_ERROR', error instanceof Error ? error.message : `Request to ${endpoint} failed`, {
          feature: 'backend',
          cause: error,
          context: { api: 'gasless', endpoint, ...(status !== undefined ? { status } : {}), ...(code ? { code } : {}) },
        }),
      };
    }
  }

  public async getCapabilities(
    body: GaslessCapabilitiesRequest,
    config?: RequestOverrideConfig,
  ): Promise<Result<GaslessCapabilitiesResponse>> {
    return this.post('/gasless/capabilities', body, GaslessCapabilitiesResponseSchema, config);
  }

  public async prepare(
    body: GaslessPrepareRequest,
    config?: RequestOverrideConfig,
  ): Promise<Result<GaslessPrepareResponse>> {
    return this.post('/gasless/prepare', body, GaslessPrepareResponseSchema, config);
  }

  public async submit(body: GaslessSubmitRequest, config?: RequestOverrideConfig): Promise<Result<GaslessSubmitResponse>> {
    return this.post('/gasless/submit', body, GaslessSubmitResponseSchema, config);
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

/** Best-effort extraction of the HTTP status + wire {@link GaslessApiErrorCode} from a {@link makeRequest} transport error (`cause.message` is `HTTP <status>: <body>`); a parse failure yields no code. */
function extractHttpError(error: unknown): { status?: number; code?: GaslessApiErrorCode } {
  const causeMessage = error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined;
  const match = causeMessage ? /^HTTP (\d+): ([\s\S]*)$/.exec(causeMessage) : null;
  if (!match) return {};
  const status = Number(match[1]);
  try {
    const { code } = JSON.parse(match[2] ?? '') as { code?: unknown };
    return isGaslessApiErrorCode(code) ? { status, code } : { status };
  } catch {
    return { status };
  }
}
