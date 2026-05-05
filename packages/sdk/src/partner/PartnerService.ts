import type { ConfigService, HubProvider, SpokeService } from '../shared/index.js';
import { PartnerFeeClaimService, type PartnerFeeClaimServiceConstructorParams } from './PartnerFeeClaimService.js';

export type PartnerServiceConfig = {
  feeClaim?: PartnerFeeClaimServiceConstructorParams;
};

export type PartnerServiceConstructorParams = {
  config: ConfigService;
  hubProvider: HubProvider;
  spoke: SpokeService;
};

/**
 * Facade for all partner-related operations in the SODAX SDK.
 *
 * Third-party integrators (partners) use this service to manage fees earned from
 * swap and bridge operations they facilitated. It exposes a `feeClaim` sub-service
 * for on-chain fee claiming and swap-preference configuration, and a `config`
 * reference for chain/token lookups.
 *
 * Instantiated automatically by the `Sodax` class and accessible as `sodax.partners`.
 */
export class PartnerService {
  /** Sub-service for fee balance queries, token approvals, swap-preference management, and on-chain fee claiming. */
  public readonly feeClaim: PartnerFeeClaimService;
  public readonly config: ConfigService;

  constructor({ config, hubProvider, spoke }: PartnerServiceConstructorParams) {
    this.config = config;
    this.feeClaim = new PartnerFeeClaimService({
      config: config,
      hubProvider: hubProvider,
      spoke: spoke,
    });
  }
}
