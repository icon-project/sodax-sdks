import type { Address, HttpUrl } from '@sodax/dapp-kit';
import { readJson, writeJson } from './storage';

// Persisted "Sodax Settings" overrides (the header modal). `null` = unset — the effective
// value falls back to the env solver config, a VITE_* var, or the SDK packaged default.
export type SodaxSettings = {
  /** null = Auto: backend submit-tx on, except off on Staging (see gh-401). */
  useBackendSubmitTx: boolean | null;
  solverApiEndpoint: HttpUrl | null;
  intentsContract: Address | null;
  protocolIntentsContract: Address | null;
  /** Gateway root incl. version prefix → `api.baseApiConfig.baseURL`. */
  apiBaseUrl: HttpUrl | null;
  swapsApiBaseUrl: HttpUrl | null;
  /** Instance-wide `x-api-key` → `SodaxOptions.apiKey`. */
  apiKey: string | null;
  relayerApiEndpoint: HttpUrl | null;
};

export const DEFAULT_SODAX_SETTINGS: SodaxSettings = {
  useBackendSubmitTx: null,
  solverApiEndpoint: null,
  intentsContract: null,
  protocolIntentsContract: null,
  apiBaseUrl: null,
  swapsApiBaseUrl: null,
  apiKey: null,
  relayerApiEndpoint: null,
};

const STORAGE_KEY = 'sodax-demo:sodax-settings';

export function isHttpUrl(value: unknown): value is HttpUrl {
  return typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'));
}

export function isEvmAddress(value: unknown): value is Address {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

/** A set-but-empty env var means "unset" — matching how the SDK treats an empty key or base URL. */
export function nonEmptyEnv(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// The env stays a plain string here — importing the store's enum would create a module cycle.
type StoredPayload = { solverEnvironment?: unknown } & Partial<Record<keyof SodaxSettings, unknown>>;

/** Field-by-field sanitize: an invalid or missing stored value loads as `null` (unset). */
export function loadSodaxSettings(): SodaxSettings {
  const raw = readJson<StoredPayload>(STORAGE_KEY);
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SODAX_SETTINGS };
  }
  return {
    useBackendSubmitTx: typeof raw.useBackendSubmitTx === 'boolean' ? raw.useBackendSubmitTx : null,
    solverApiEndpoint: isHttpUrl(raw.solverApiEndpoint) ? raw.solverApiEndpoint : null,
    intentsContract: isEvmAddress(raw.intentsContract) ? raw.intentsContract : null,
    protocolIntentsContract: isEvmAddress(raw.protocolIntentsContract) ? raw.protocolIntentsContract : null,
    apiBaseUrl: isHttpUrl(raw.apiBaseUrl) ? raw.apiBaseUrl : null,
    swapsApiBaseUrl: isHttpUrl(raw.swapsApiBaseUrl) ? raw.swapsApiBaseUrl : null,
    apiKey: nonEmptyEnv(raw.apiKey) ? raw.apiKey : null,
    relayerApiEndpoint: isHttpUrl(raw.relayerApiEndpoint) ? raw.relayerApiEndpoint : null,
  };
}

export function loadStoredSolverEnv(): 'Production' | 'Staging' {
  const raw = readJson<StoredPayload>(STORAGE_KEY);
  return raw?.solverEnvironment === 'Staging' ? 'Staging' : 'Production';
}

export function saveSodaxSettings(solverEnvironment: string, settings: SodaxSettings): void {
  writeJson(STORAGE_KEY, { solverEnvironment, ...settings });
}

/** True when any field overrides its default — drives the header badge dot. */
export function hasActiveOverrides(settings: SodaxSettings): boolean {
  return Object.values(settings).some(value => value !== null);
}

// Env defaults shared by the provider and the modal's prefilled values. Base URLs include any
// version prefix (a local swaps-api mounting at the bare origin is `http://localhost:3008`).
const swapsApiBaseUrlEnv: unknown = import.meta.env.VITE_SWAPS_API_BASE_URL;
export const envSwapsApiBaseUrl: HttpUrl | undefined = isHttpUrl(swapsApiBaseUrlEnv) ? swapsApiBaseUrlEnv : undefined;

// Instance-wide SODAX API key: `x-api-key` on every backend call, sponsoring included while it
// targets the packaged gateway (VITE_SPONSORING_API_KEY is only for an independently hosted one).
const sodaxApiKeyEnv: unknown = import.meta.env.VITE_SODAX_API_KEY;
export const envSodaxApiKey: string | undefined = nonEmptyEnv(sodaxApiKeyEnv) ? sodaxApiKeyEnv : undefined;
