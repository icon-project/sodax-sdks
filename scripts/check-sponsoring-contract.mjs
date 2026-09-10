#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const DEFAULT_SPEC = 'http://localhost:3011/docs-json';
const specArgIndex = process.argv.indexOf('--spec');
const specSource = specArgIndex === -1 ? DEFAULT_SPEC : process.argv[specArgIndex + 1];

// Hand-authored types preserve the hash/alreadyActive correlation OpenAPI cannot express.
const EXPECTED = {
  StellarSponsorConfig: {
    schema: 'SponsorConfigResponseDto',
    required: [
      'sponsorAccount',
      'networkPassphrase',
      'minTotalFeeStroops',
      'maxTotalFeeStroops',
      'operationCount',
      'minPerOperationFeeStroops',
      'maxPerOperationFeeStroops',
      'recommendedPerOperationFeeStroops',
      'maxTimeboundSeconds',
      'requiredStartingBalance',
    ],
    optional: [],
  },
  StellarSponsoredAccountResponse: {
    schema: 'SponsorAccountResponseDto',
    required: ['hash', 'alreadyActive'],
    optional: [],
  },
  SponsoringApiErrorResponse: {
    schema: 'SponsorErrorResponseDto',
    required: ['statusCode', 'message'],
    optional: ['error', 'retryAfterSeconds', 'sponsorSequence'],
  },
};

const EXPECTED_OPERATIONS = [
  { method: 'get', path: '/sponsorships/stellar/config', success: '200', classified: ['401', '429', '500'] },
  {
    method: 'post',
    path: '/sponsorships/stellar/accounts',
    success: '200',
    classified: ['400', '401', '409', '422', '429', '500', '503'],
  },
];

const CLASSIFIED_STATUSES = new Set(['400', '401', '409', '422', '429', '500', '503']);

const EXPECTED_ERROR_CODES = [
  'INVALID_SPONSOR_XDR',
  'INVALID_RESERVE_DATA',
  'SPONSOR_SEQUENCE_CONFLICT',
  'SPONSOR_TRANSACTION_REJECTED',
  'HORIZON_UNAVAILABLE',
  'SPONSOR_RATE_LIMITED',
  'SPONSOR_BUDGET_EXHAUSTED',
];

async function loadSpec(source) {
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`GET ${source} → HTTP ${response.status}`);
    return response.json();
  }
  return JSON.parse(await readFile(source, 'utf8'));
}

const problems = [];
const notes = [];

const spec = await loadSpec(specSource).catch(error => {
  console.error(`check-sponsoring-contract: could not read the spec from ${specSource}`);
  console.error(`  ${error.message}`);
  console.error('  Start a local sponsoring-api, or pass --spec <url|path>.');
  process.exit(2);
});

const schemas = spec?.components?.schemas ?? {};

for (const [sdkType, expected] of Object.entries(EXPECTED)) {
  const schema = schemas[expected.schema];
  if (!schema) {
    problems.push(`${expected.schema} is absent from the spec (SDK type ${sdkType} has nothing to check against)`);
    continue;
  }

  const specProps = Object.keys(schema.properties ?? {});
  const specRequired = new Set(schema.required ?? []);
  const ours = [...expected.required, ...expected.optional];

  for (const field of ours) {
    if (!specProps.includes(field)) problems.push(`${expected.schema}.${field}: in the SDK type, absent from the spec`);
  }
  for (const field of specProps) {
    if (!ours.includes(field)) problems.push(`${expected.schema}.${field}: in the spec, absent from the SDK type`);
  }
  for (const field of expected.required) {
    if (specProps.includes(field) && !specRequired.has(field)) {
      problems.push(`${expected.schema}.${field}: required in the SDK type, optional in the spec`);
    }
  }
  for (const field of expected.optional) {
    if (specRequired.has(field)) {
      // Throttler and fallback responses can omit fields required by the OpenAPI schema.
      notes.push(`${expected.schema}.${field}: required in the spec, optional in the SDK type`);
    }
  }
}

const specPaths = spec?.paths ?? {};

for (const operation of EXPECTED_OPERATIONS) {
  const label = `${operation.method.toUpperCase()} ${operation.path}`;
  // Accept gateway version prefixes and local unprefixed routes.
  const key = Object.keys(specPaths).find(path => path === operation.path || path.endsWith(operation.path));
  if (!key) {
    problems.push(`${label}: absent from the spec`);
    continue;
  }

  const responses = specPaths[key]?.[operation.method]?.responses;
  if (!responses) {
    problems.push(`${label}: the spec declares no responses for this method`);
    continue;
  }

  const declared = Object.keys(responses).filter(status => /^\d{3}$/.test(status));
  const success = declared.filter(status => status.startsWith('2'));

  if (!success.includes(operation.success)) {
    problems.push(
      `${label}: the SDK expects ${operation.success}, the spec declares ${success.join(', ') || 'no 2xx'}`,
    );
  }
  for (const status of success.filter(status => status !== operation.success)) {
    notes.push(`${label}: the spec also declares ${status}; the SDK is written against ${operation.success}`);
  }
  for (const status of operation.classified.filter(status => !declared.includes(status))) {
    // Keep known undeclared statuses as notes until the backend declarations land.
    notes.push(`${label}: the SDK classifies ${status}, the spec declares no ${status} response`);
  }
  for (const status of declared) {
    if (status.startsWith('2') || CLASSIFIED_STATUSES.has(status)) continue;
    problems.push(`${label}: the spec declares ${status}, which the SDK's classifier has no arm for (terminal abort)`);
  }
}

const errorSchema = schemas[EXPECTED.SponsoringApiErrorResponse.schema];
const specCodes = errorSchema?.properties?.error?.enum;
if (Array.isArray(specCodes)) {
  const missing = EXPECTED_ERROR_CODES.filter(code => !specCodes.includes(code));
  const extra = specCodes.filter(code => !EXPECTED_ERROR_CODES.includes(code));
  if (missing.length) problems.push(`error enum: in the SDK union, absent from the spec — ${missing.join(', ')}`);
  if (extra.length) problems.push(`error enum: in the spec, absent from the SDK union — ${extra.join(', ')}`);
}

for (const note of notes) console.warn(`note: ${note}`);

if (problems.length > 0) {
  console.error(`\ncheck-sponsoring-contract: ${problems.length} drift(s) against ${specSource}`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error('\nUpdate packages/types/src/backend/sponsoringApi.ts, or raise the difference with the backend team.');
  process.exit(1);
}

console.log(`check-sponsoring-contract: OK — SDK sponsoring types match ${specSource}`);
