import { DEFAULT_SPONSORING_API_ENDPOINT, type HttpUrl } from '@sodax/types';

/** The lab defaults to the mock so a diagnostic click cannot spend real XLM. */
export type LabTarget = 'mock' | 'localBackend' | 'realMainnet' | 'custom';

export type LabConfig = {
  target: LabTarget;
  customBaseUrl: string;
  /** Empty sends no API key, enabling the genuine 401 path. */
  apiKey: string;
  timeoutMs: number;
  mockHorizon: boolean;
};

export type ResolvedLabTargets = {
  sponsoringBaseUrl: HttpUrl | undefined;
  effectiveSponsoringBaseUrl: string;
  horizonRpcUrl: string;
  /** Always real mainnet; the mock has no Soroban RPC. */
  sorobanRpcUrl: string;
  isMock: boolean;
  /** Derived from the resolved URL so fallback to production still trips mainnet guards. */
  isRealMainnet: boolean;
  isUnresolved: boolean;
  /** Blocks writes built from mock state that would submit to real mainnet. */
  blocksSpokeWrites: boolean;
  /** Changes must clear React Query because sponsoring query keys omit the base URL. */
  fingerprint: string;
};

export const LOCAL_BACKEND_BASE_URL = 'http://localhost:3011';

const MOCK_SPONSOR_PATH = '/__sponsor';
const MOCK_HORIZON_PATH = '/__horizon';

const STORAGE_KEY = 'sodax.stellar-lab.v1';

export const DEFAULT_LAB_TIMEOUT_MS = 30_000;

export const MIN_LAB_TIMEOUT_MS = 200;

export function isHttpUrl(value: string): value is HttpUrl {
  return value.startsWith('http://') || value.startsWith('https://');
}

/** Match SDK normalization so a trailing slash cannot bypass the mainnet guard. */
function normalizeBaseUrl(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

/** Non-lab builds use env/default targets, never the lab's dev-proxy path. */
export function resolveAppTargets(defaultHorizonRpcUrl: string, defaultSorobanRpcUrl: string): ResolvedLabTargets {
  const sponsoringBaseUrl = readEnvBaseUrl();
  const effectiveSponsoringBaseUrl = sponsoringBaseUrl ?? DEFAULT_SPONSORING_API_ENDPOINT;

  return {
    sponsoringBaseUrl,
    effectiveSponsoringBaseUrl,
    horizonRpcUrl: defaultHorizonRpcUrl,
    sorobanRpcUrl: defaultSorobanRpcUrl,
    isMock: false,
    isRealMainnet: effectiveSponsoringBaseUrl === DEFAULT_SPONSORING_API_ENDPOINT,
    isUnresolved: false,
    blocksSpokeWrites: false,
    fingerprint: `app|${effectiveSponsoringBaseUrl}|${defaultHorizonRpcUrl}`,
  };
}

export function resolveLabTargets(
  config: LabConfig,
  origin: string,
  defaultHorizonRpcUrl: string,
  defaultSorobanRpcUrl: string,
): ResolvedLabTargets {
  const isMock = config.target === 'mock';
  const sponsoringBaseUrl = resolveSponsoringBaseUrl(config, origin);
  const effectiveSponsoringBaseUrl = sponsoringBaseUrl ?? DEFAULT_SPONSORING_API_ENDPOINT;

  // Mock Horizon is valid only with the mock sponsoring API.
  const mockHorizonActive = isMock && config.mockHorizon;
  const horizonRpcUrl = mockHorizonActive ? `${origin}${MOCK_HORIZON_PATH}` : defaultHorizonRpcUrl;

  return {
    sponsoringBaseUrl,
    effectiveSponsoringBaseUrl,
    horizonRpcUrl,
    sorobanRpcUrl: defaultSorobanRpcUrl,
    isMock,
    isRealMainnet: effectiveSponsoringBaseUrl === DEFAULT_SPONSORING_API_ENDPOINT,
    isUnresolved: config.target === 'custom' && sponsoringBaseUrl === undefined,
    blocksSpokeWrites: mockHorizonActive,
    fingerprint: `${config.target}|${effectiveSponsoringBaseUrl}|${horizonRpcUrl}|${config.apiKey ? 'keyed' : 'keyless'}|${config.timeoutMs}`,
  };
}

function resolveSponsoringBaseUrl(config: LabConfig, origin: string): HttpUrl | undefined {
  switch (config.target) {
    case 'mock': {
      const mockUrl = `${origin}${MOCK_SPONSOR_PATH}`;
      return isHttpUrl(mockUrl) ? mockUrl : undefined;
    }
    case 'localBackend':
      return LOCAL_BACKEND_BASE_URL;
    case 'realMainnet':
      return undefined;
    case 'custom': {
      const custom = normalizeBaseUrl(config.customBaseUrl);
      return isHttpUrl(custom) ? custom : undefined;
    }
  }
}

export function defaultLabConfig(): LabConfig {
  return {
    target: 'mock',
    customBaseUrl: '',
    apiKey: readEnvApiKey(),
    timeoutMs: DEFAULT_LAB_TIMEOUT_MS,
    mockHorizon: true,
  };
}

export function readEnvApiKey(): string {
  const value = import.meta.env.VITE_SPONSORING_API_KEY;
  return typeof value === 'string' ? value : '';
}

function readEnvBaseUrl(): HttpUrl | undefined {
  const value = import.meta.env.VITE_SPONSORING_API_BASE_URL;
  if (typeof value !== 'string') return undefined;
  const normalized = normalizeBaseUrl(value);
  return isHttpUrl(normalized) ? normalized : undefined;
}

export function clampTimeoutMs(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LAB_TIMEOUT_MS;
  return Math.max(MIN_LAB_TIMEOUT_MS, Math.floor(value));
}

/** API keys are never persisted to localStorage. */
export function loadLabConfig(): LabConfig {
  const fallback = defaultLabConfig();
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    const stored = parsed as Partial<Record<keyof LabConfig, unknown>>;
    return {
      target: isLabTarget(stored.target) ? stored.target : fallback.target,
      customBaseUrl: typeof stored.customBaseUrl === 'string' ? stored.customBaseUrl : fallback.customBaseUrl,
      apiKey: fallback.apiKey,
      timeoutMs: typeof stored.timeoutMs === 'number' ? clampTimeoutMs(stored.timeoutMs) : fallback.timeoutMs,
      mockHorizon: typeof stored.mockHorizon === 'boolean' ? stored.mockHorizon : fallback.mockHorizon,
    };
  } catch {
    return fallback;
  }
}

export function saveLabConfig(config: LabConfig): void {
  try {
    const { apiKey: _apiKey, ...persisted } = config;
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {}
}

function isLabTarget(value: unknown): value is LabTarget {
  return value === 'mock' || value === 'localBackend' || value === 'realMainnet' || value === 'custom';
}

export const TARGET_LABELS: Record<LabTarget, string> = {
  mock: 'Mock server',
  localBackend: 'Local backend',
  realMainnet: 'Real mainnet',
  custom: 'Custom',
};
