import { MOCK_SPONSOR_ACCOUNT, MOCK_SPONSOR_SEQUENCE } from './scenarios.mjs';

const BASE_RESERVE_XLM = 0.5;

/** `numSponsored` models an account whose reserve is held by its sponsor. */
export function accountRecord({
  accountId,
  sequence = '1',
  balanceXlm = '0.0000000',
  subentryCount = 0,
  numSponsoring = 0,
  numSponsored = 0,
  sellingLiabilities,
}) {
  return {
    id: accountId,
    account_id: accountId,
    sequence,
    subentry_count: subentryCount,
    num_sponsoring: numSponsoring,
    num_sponsored: numSponsored,
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    flags: { auth_required: false, auth_revocable: false, auth_immutable: false, auth_clawback_enabled: false },
    balances: [
      {
        asset_type: 'native',
        balance: balanceXlm,
        buying_liabilities: '0.0000000',
        ...(sellingLiabilities ? { selling_liabilities: sellingLiabilities } : { selling_liabilities: '0.0000000' }),
      },
    ],
    signers: [{ weight: 1, key: accountId, type: 'ed25519_public_key' }],
    data: {},
  };
}

export function notFoundBody(accountId) {
  return {
    type: 'https://stellar.org/horizon-errors/not_found',
    title: 'Resource Missing',
    status: 404,
    detail: 'The resource at the url requested was not found.',
    extras: { account_id: accountId },
  };
}

export const ACCOUNT_PROFILES = {
  'sponsored-empty': accountId => accountRecord({ accountId, numSponsored: 2, balanceXlm: '0.0000000' }),
  funded: accountId => accountRecord({ accountId, balanceXlm: '5.0000000', numSponsored: 2 }),
  'reserve-locked': accountId => accountRecord({ accountId, balanceXlm: '1.0000000' }),
  'one-trustline': accountId => accountRecord({ accountId, balanceXlm: '1.2000000', subentryCount: 1 }),
  'selling-liabilities': accountId =>
    accountRecord({ accountId, balanceXlm: '3.0000000', numSponsored: 2, sellingLiabilities: '2.9000000' }),
};

export const DEFAULT_ACCOUNT_PROFILE = 'sponsored-empty';

export function sponsorRecord() {
  return accountRecord({
    accountId: MOCK_SPONSOR_ACCOUNT,
    sequence: MOCK_SPONSOR_SEQUENCE,
    balanceXlm: '250.0000000',
  });
}

export function resolveAccount(accountId, state) {
  if (state.mode === 'down') {
    return {
      status: 503,
      body: { type: 'https://stellar.org/horizon-errors/server_error', title: 'Server Error', status: 503 },
    };
  }

  if (accountId === MOCK_SPONSOR_ACCOUNT) return { status: 200, body: sponsorRecord() };

  if (!state.activeAccounts.includes(accountId)) return { status: 404, body: notFoundBody(accountId) };

  // Reject inherited function names before invoking a profile builder.
  const profile = Object.hasOwn(ACCOUNT_PROFILES, state.profile)
    ? ACCOUNT_PROFILES[state.profile]
    : ACCOUNT_PROFILES[DEFAULT_ACCOUNT_PROFILE];
  return { status: 200, body: profile(accountId) };
}

export function initialHorizonState() {
  return { activeAccounts: [], profile: DEFAULT_ACCOUNT_PROFILE, mode: 'ok' };
}

export function lockedReserveXlm(record) {
  const units = Math.max(
    0,
    2 + (record.subentry_count ?? 0) + (record.num_sponsoring ?? 0) - (record.num_sponsored ?? 0),
  );
  return units * BASE_RESERVE_XLM;
}
