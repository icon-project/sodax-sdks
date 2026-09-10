/** Valid fixture StrKeys; nothing is submitted. */
export const MOCK_SPONSOR_ACCOUNT = 'GAB7XLKJRXOB4JDAEFZOC26D2KQLFLUVPMXPVQLXLV6GQCRGBQHLX7GY';
export const MOCK_ACTIVE_ACCOUNT = 'GCANTVOZ5MPOXGRICEBJYMSRYQJSSGC4K5WTVZD3NJBYUEEAC4NWZX64';

// Must match the pre-wallet-prompt mainnet assertion.
export const STELLAR_PUBLIC_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
export const STELLAR_TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

/** Fabricated but correctly sized transaction hash. */
export const MOCK_TX_HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

export const MOCK_SPONSOR_SEQUENCE = '4218906543210';

export const MOCK_SPONSOR_CONFIG = {
  sponsorAccount: MOCK_SPONSOR_ACCOUNT,
  networkPassphrase: STELLAR_PUBLIC_PASSPHRASE,
  minTotalFeeStroops: '3000',
  maxTotalFeeStroops: '10000',
  operationCount: 3,
  minPerOperationFeeStroops: '1000',
  maxPerOperationFeeStroops: '3333',
  recommendedPerOperationFeeStroops: '1000',
  maxTimeboundSeconds: 3600,
  requiredStartingBalance: '0',
};

export const DOMAIN_CODES = [
  'INVALID_SPONSOR_XDR',
  'INVALID_RESERVE_DATA',
  'SPONSOR_SEQUENCE_CONFLICT',
  'SPONSOR_TRANSACTION_REJECTED',
  'HORIZON_UNAVAILABLE',
  'SPONSOR_RATE_LIMITED',
  'SPONSOR_BUDGET_EXHAUSTED',
];

/** Holds the socket open so the SDK timeout fires. */
export const HANG = 'hang';

const ok = body => ({ status: 200, body });

/** Domain-coded body; classifier membership-tests `error`. */
const domainError = (status, code, message, extra = {}) => ({
  status,
  body: { statusCode: status, error: code, message, ...extra },
});

/** Framework exception where `error` is a label, not a domain code. */
const labelError = (status, label, message) => ({
  status,
  body: { statusCode: status, error: label, message },
});

/** Matches service paths that omit the `error` field. */
const bareError = (status, message) => ({
  status,
  body: { statusCode: status, message },
});

const CONFIG_SCENARIOS = {
  ok: () => ok(MOCK_SPONSOR_CONFIG),

  'config-401': () => labelError(401, 'Unauthorized', 'Missing x-api-key'),
  'config-500': () => labelError(500, 'Internal Server Error', 'sponsor config unavailable'),

  // Schema rejection drops HTTP status before classification.
  'config-invalid-shape': () => ok({ sponsorAccount: MOCK_SPONSOR_ACCOUNT, networkPassphrase: 'x' }),

  'config-testnet': () => ok({ ...MOCK_SPONSOR_CONFIG, networkPassphrase: STELLAR_TESTNET_PASSPHRASE }),

  // Missing per-operation fields must be rejected, never derived from totals.
  'config-missing-per-op-band': () => {
    const {
      operationCount: _oc,
      minPerOperationFeeStroops: _min,
      maxPerOperationFeeStroops: _max,
      recommendedPerOperationFeeStroops: _rec,
      ...withoutPerOpBand
    } = MOCK_SPONSOR_CONFIG;
    return ok(withoutPerOpBand);
  },

  'config-bad-fee-band': () => ok({ ...MOCK_SPONSOR_CONFIG, minTotalFeeStroops: '10000', maxTotalFeeStroops: '3000' }),
  'config-fee-out-of-band': () => ok({ ...MOCK_SPONSOR_CONFIG, recommendedPerOperationFeeStroops: '50' }),
  'config-op-count-mismatch': () => ok({ ...MOCK_SPONSOR_CONFIG, operationCount: 4 }),
  'config-zero-timebound': () => ok({ ...MOCK_SPONSOR_CONFIG, maxTimeboundSeconds: 0 }),
  'config-bad-sponsor-account': () => ok({ ...MOCK_SPONSOR_CONFIG, sponsorAccount: 'not-a-stellar-account' }),

  [HANG]: () => HANG,
};

const ACCOUNT_SCENARIOS = {
  ok: () => ok({ hash: MOCK_TX_HASH, alreadyActive: false }),
  submitted: () => ok({ hash: MOCK_TX_HASH, alreadyActive: false }),

  'already-active': () => ok({ hash: null, alreadyActive: true }),

  uncorrelated: () => ok({ hash: null, alreadyActive: false }),

  '400-invalid-xdr': () => domainError(400, 'INVALID_SPONSOR_XDR', 'transaction is not signed by the created account'),
  '400-validation': () => labelError(400, 'Bad Request', 'data must be shorter than or equal to 4096 characters'),

  401: () => labelError(401, 'Unauthorized', 'Missing x-api-key'),

  409: () =>
    domainError(409, 'SPONSOR_SEQUENCE_CONFLICT', 'sponsor sequence was consumed by another request', {
      sponsorSequence: MOCK_SPONSOR_SEQUENCE,
    }),
  '409-no-sequence': () => domainError(409, 'SPONSOR_SEQUENCE_CONFLICT', 'sponsor sequence conflict'),
  '409-bad-sequence': () =>
    domainError(409, 'SPONSOR_SEQUENCE_CONFLICT', 'sponsor sequence conflict', { sponsorSequence: 'abc' }),

  '409-then-submitted': attempt =>
    attempt === 0 ? ACCOUNT_SCENARIOS[409]() : ok({ hash: MOCK_TX_HASH, alreadyActive: false }),
  '409-then-already-active': attempt =>
    attempt === 0 ? ACCOUNT_SCENARIOS[409]() : ok({ hash: null, alreadyActive: true }),

  422: () => domainError(422, 'SPONSOR_TRANSACTION_REJECTED', 'tx_bad_seq'),

  '429-throttle': () => bareError(429, 'ThrottlerException: Too Many Requests'),
  // Body timing survives browsers that hide Retry-After without CORS exposure.
  '429-quota': () => domainError(429, 'SPONSOR_RATE_LIMITED', 'per-key quota exhausted', { retryAfterSeconds: 42 }),
  '429-bad-retry-after': () =>
    domainError(429, 'SPONSOR_RATE_LIMITED', 'per-key quota exhausted', { retryAfterSeconds: -1 }),

  500: () => domainError(500, 'INVALID_RESERVE_DATA', 'reserve data is inconsistent'),

  '503-budget': () => domainError(503, 'SPONSOR_BUDGET_EXHAUSTED', 'sponsor balance below the solvency floor'),
  '503-horizon': () => domainError(503, 'HORIZON_UNAVAILABLE', 'horizon submit timed out'),
  '503-draining': () => labelError(503, 'Service Unavailable', 'coordinator is draining'),

  '503-horizon-then-submitted': attempt =>
    attempt === 0 ? ACCOUNT_SCENARIOS['503-horizon']() : ok({ hash: MOCK_TX_HASH, alreadyActive: false }),

  '451-unmapped': () => labelError(451, 'Unavailable For Legal Reasons', 'blocked in this jurisdiction'),

  [HANG]: () => HANG,
};

/**
 * Empty names clear sticky headers. Other-endpoint names pass because one request config reaches both
 * activation calls; unknown names still fail.
 */
export function resolveScenario(endpoint, name, attempt = 0) {
  const table = endpoint === 'config' ? CONFIG_SCENARIOS : ACCOUNT_SCENARIOS;
  const other = endpoint === 'config' ? ACCOUNT_SCENARIOS : CONFIG_SCENARIOS;
  const key = name && name.length > 0 ? name : 'ok';

  // Reject inherited function names before invoking a scenario builder.
  if (!Object.hasOwn(table, key)) {
    if (Object.hasOwn(other, key)) return table.ok(attempt);
    return {
      status: 418,
      body: { statusCode: 418, message: `unknown mock scenario "${key}" for the ${endpoint} endpoint` },
    };
  }
  return table[key](attempt);
}

export function scenarioNames() {
  return { config: Object.keys(CONFIG_SCENARIOS), accounts: Object.keys(ACCOUNT_SCENARIOS) };
}

export function isScripted(endpoint, name) {
  const table = endpoint === 'config' ? CONFIG_SCENARIOS : ACCOUNT_SCENARIOS;
  return typeof name === 'string' && name.includes('-then-') && Object.hasOwn(table, name);
}

/** Match the service's body and fee-bump validation without a Stellar dependency. */
export function validateAccountRequest(body) {
  if (typeof body !== 'object' || body === null) return 'body must be an object';
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'data') return 'body must contain exactly the `data` field';
  const { data } = body;
  if (typeof data !== 'string' || data.length === 0) return 'data must be a non-empty base64 string';
  if (data.length > 4096) return 'data must be shorter than or equal to 4096 characters';

  let raw;
  try {
    raw = Buffer.from(data, 'base64');
  } catch {
    return 'data must be valid base64';
  }
  if (raw.length < 4) return 'data is too short to be a transaction envelope';
  if (raw.readUInt32BE(0) === 5) return 'fee-bump envelopes are not accepted';
  return undefined;
}
