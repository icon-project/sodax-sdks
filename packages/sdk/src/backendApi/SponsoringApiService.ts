import type {
  IStellarSponsoringApi,
  Result,
  SodaxLogger,
  StellarSponsoredAccountRequest,
  StellarSponsoredAccountResponse,
  StellarSponsorConfig,
  SponsoringApiConfig,
} from '@sodax/types';
import { SPONSORING_API_STELLAR_BASE_PATH } from '@sodax/types';

import * as v from 'valibot';
import {
  apiKeyHeader,
  makeRequest,
  mergeHeaders,
  resolveRequestConfig,
  toExternalApiError,
  toInvalidResponseShapeError,
  type RequestConfig,
  type RequestOverrideConfig,
} from './api-utils.js';
import * as schemas from './sponsoringApiSchemas.js';
import type { SodaxError } from '../errors/SodaxError.js';
import { consoleLogger } from '../shared/logger.js';

/** Result-wrapped {@link IStellarSponsoringApi} with per-request overrides. */
type ResultifiedSponsoringApi = {
  [K in keyof IStellarSponsoringApi]: IStellarSponsoringApi[K] extends (...args: infer A) => Promise<infer R>
    ? (...args: [...A, config?: RequestOverrideConfig]) => Promise<Result<R, SodaxError<'EXTERNAL_API_ERROR'>>>
    : never;
};

/**
 * Uncached HTTP client for the sponsoring API. Stellar orchestration and
 * config caching belong to `SponsoringService`.
 *
 * Transport errors use `feature: 'backend'`; only the user-facing orchestrator
 * uses `feature: 'sponsoring'`.
 */
export class SponsoringApiService implements ResultifiedSponsoringApi {
  private readonly config: SponsoringApiConfig;
  private readonly headers: Record<string, string>;
  private readonly logger: SodaxLogger;

  constructor(config: SponsoringApiConfig, logger: SodaxLogger = consoleLogger) {
    this.config = config;
    // Explicit headers may override the `apiKey` convenience option, whatever casing they use.
    this.headers = mergeHeaders(apiKeyHeader(config.apiKey), config.headers);
    this.logger = logger;
  }

  /**
   * Validate a response while preserving HTTP failures on `error.cause` for
   * sponsor-error classification.
   */
  private async request<S extends v.GenericSchema>(
    endpoint: string,
    config: RequestConfig,
    schema: S,
  ): Promise<Result<v.InferOutput<S>, SodaxError<'EXTERNAL_API_ERROR'>>> {
    try {
      const raw = await makeRequest<unknown>({
        endpoint,
        config: resolveRequestConfig(config, { ...this.config, headers: this.headers }),
        logger: this.logger,
        serviceLabel: 'SponsoringApiService',
      });
      const parsed = v.safeParse(schema, raw);
      if (!parsed.success) {
        return {
          ok: false,
          error: toInvalidResponseShapeError({
            api: 'sponsoring',
            feature: 'backend',
            endpoint,
            issues: v.flatten(parsed.issues),
          }),
        };
      }
      return { ok: true, value: parsed.output };
    } catch (error) {
      // `makeRequest` already logged this failure under the same service label — don't double-log.
      return { ok: false, error: toExternalApiError({ api: 'sponsoring', feature: 'backend', endpoint, error }) };
    }
  }

  /** Fetch build parameters, including the rotatable sponsor account. */
  public async getStellarSponsorConfig(
    config?: RequestOverrideConfig,
  ): Promise<Result<StellarSponsorConfig, SodaxError<'EXTERNAL_API_ERROR'>>> {
    return this.request(
      `${SPONSORING_API_STELLAR_BASE_PATH}/config`,
      { ...config, method: 'GET' },
      schemas.StellarSponsorConfigSchema,
    );
  }

  /**
   * Submit a client-signed transaction for sponsor co-signing. An
   * `alreadyActive` response is also successful.
   */
  public async createStellarSponsoredAccount(
    body: StellarSponsoredAccountRequest,
    config?: RequestOverrideConfig,
  ): Promise<Result<StellarSponsoredAccountResponse, SodaxError<'EXTERNAL_API_ERROR'>>> {
    return this.request(
      `${SPONSORING_API_STELLAR_BASE_PATH}/accounts`,
      // The endpoint rejects extra fields.
      { ...config, method: 'POST', body: JSON.stringify({ data: body.data }) },
      schemas.StellarSponsoredAccountResponseSchema,
    );
  }

  public setHeaders(headers: Record<string, string>): void {
    Object.entries(headers).forEach(([key, value]) => {
      this.headers[key] = value;
    });
  }

  public getBaseURL(): string {
    return this.config.baseURL;
  }
}
