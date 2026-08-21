import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACCOUNT_PROFILES,
  accountRecord,
  initialHorizonState,
  lockedReserveXlm,
  notFoundBody,
  resolveAccount,
} from './horizon.mjs';
import {
  DOMAIN_CODES,
  HANG,
  MOCK_SPONSOR_ACCOUNT,
  MOCK_SPONSOR_CONFIG,
  STELLAR_PUBLIC_PASSPHRASE,
  isScripted,
  resolveScenario,
  scenarioNames,
  validateAccountRequest,
} from './scenarios.mjs';

const names = scenarioNames();

const CLASSIFIED_STATUSES = new Set([200, 400, 401, 409, 418, 422, 429, 500, 503]);

describe('scenario catalog', () => {
  it('every scenario resolves to a response or the hang sentinel', () => {
    for (const endpoint of ['config', 'accounts']) {
      for (const name of names[endpoint]) {
        const outcome = resolveScenario(endpoint, name);
        if (outcome === HANG) continue;
        assert.equal(typeof outcome.status, 'number', `${endpoint}/${name} has no status`);
        assert.ok(outcome.body !== undefined, `${endpoint}/${name} has no body`);
      }
    }
  });

  it('an error body repeats its own status in statusCode', () => {
    for (const endpoint of ['config', 'accounts']) {
      for (const name of names[endpoint]) {
        const outcome = resolveScenario(endpoint, name);
        if (outcome === HANG || outcome.status < 400) continue;
        assert.equal(outcome.body.statusCode, outcome.status, `${endpoint}/${name} statusCode disagrees with status`);
        assert.equal(typeof outcome.body.message, 'string', `${endpoint}/${name} has no message`);
      }
    }
  });

  it('a present `error` field is either one of the seven domain codes or a human label', () => {
    // Preserve the domain-code versus framework-label distinction.
    const labels = new Set([
      'Unauthorized',
      'Bad Request',
      'Service Unavailable',
      'Internal Server Error',
      'Unavailable For Legal Reasons',
    ]);
    for (const endpoint of ['config', 'accounts']) {
      for (const name of names[endpoint]) {
        const outcome = resolveScenario(endpoint, name);
        if (outcome === HANG || outcome.status < 400) continue;
        const { error } = outcome.body;
        if (error === undefined) continue;
        assert.ok(
          DOMAIN_CODES.includes(error) || labels.has(error),
          `${endpoint}/${name} error "${error}" is neither a domain code nor a known framework label`,
        );
      }
    }
  });

  it('only known statuses are emitted, so no scenario lands in an unintended classifier arm', () => {
    for (const endpoint of ['config', 'accounts']) {
      for (const name of names[endpoint]) {
        const outcome = resolveScenario(endpoint, name);
        if (outcome === HANG) continue;
        if (name === '451-unmapped') {
          assert.equal(outcome.status, 451, 'the unmapped scenario must stay outside the classifier table');
          continue;
        }
        assert.ok(CLASSIFIED_STATUSES.has(outcome.status), `${endpoint}/${name} emits unexpected ${outcome.status}`);
      }
    }
  });

  it('an unknown name is a 418, not a silent ok', () => {
    const outcome = resolveScenario('accounts', 'no-such-scenario');
    assert.equal(outcome.status, 418);
    assert.match(outcome.body.message, /unknown mock scenario/);
  });

  it('a name owned by the OTHER endpoint resolves to ok, not 418', () => {
    // One request config reaches both endpoints during activation.
    for (const name of ['submitted', 'already-active', '409-then-submitted', 'uncorrelated']) {
      assert.equal(resolveScenario('config', name).status, 200, `config + ${name} should fall back to ok`);
    }
    assert.equal(resolveScenario('accounts', 'config-testnet').status, 200);
  });

  it('an inherited Object.prototype member is a 418, never invoked', () => {
    // Inherited names must never be invoked as builders.
    for (const key of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      for (const endpoint of ['config', 'accounts']) {
        assert.equal(resolveScenario(endpoint, key).status, 418, `${endpoint} + ${key} must be a 418`);
      }
    }
  });

  it('an absent or empty name resolves to ok — setHeaders cannot unset a header', () => {
    for (const empty of [undefined, '']) {
      assert.equal(resolveScenario('config', empty).status, 200);
      assert.equal(resolveScenario('accounts', empty).status, 200);
    }
  });
});

describe('config scenarios', () => {
  it('ok publishes the public network passphrase, or the flow aborts before any wallet prompt', () => {
    assert.equal(resolveScenario('config', 'ok').body.networkPassphrase, STELLAR_PUBLIC_PASSPHRASE);
  });

  it('ok publishes a valid-looking ed25519 sponsor account', () => {
    assert.match(resolveScenario('config', 'ok').body.sponsorAccount, /^G[A-Z2-7]{55}$/);
  });

  it('config-missing-per-op-band omits exactly the four per-operation fields', () => {
    const body = resolveScenario('config', 'config-missing-per-op-band').body;
    for (const field of [
      'operationCount',
      'minPerOperationFeeStroops',
      'maxPerOperationFeeStroops',
      'recommendedPerOperationFeeStroops',
    ]) {
      assert.equal(field in body, false, `config-missing-per-op-band still carries ${field}`);
    }
    for (const field of ['sponsorAccount', 'networkPassphrase', 'minTotalFeeStroops', 'requiredStartingBalance']) {
      assert.ok(field in body, `config-missing-per-op-band dropped ${field}`);
    }
  });

  it('config-testnet differs from ok only in the passphrase', () => {
    const body = resolveScenario('config', 'config-testnet').body;
    assert.notEqual(body.networkPassphrase, STELLAR_PUBLIC_PASSPHRASE);
    assert.equal(body.sponsorAccount, MOCK_SPONSOR_CONFIG.sponsorAccount);
  });

  it('requiredStartingBalance is "0" — the sponsor covers the reserve, not the balance', () => {
    assert.equal(resolveScenario('config', 'ok').body.requiredStartingBalance, '0');
  });
});

describe('account scenarios', () => {
  it('the fabricated hash is a well-formed 32-byte Stellar tx hash', () => {
    assert.match(resolveScenario('accounts', 'submitted').body.hash, /^[0-9a-f]{64}$/);
  });

  it('submitted and already-active both satisfy the hash/alreadyActive correlation', () => {
    const submitted = resolveScenario('accounts', 'submitted').body;
    assert.equal(submitted.alreadyActive, false);
    assert.equal(typeof submitted.hash, 'string');

    const already = resolveScenario('accounts', 'already-active').body;
    assert.equal(already.alreadyActive, true);
    assert.equal(already.hash, null);
  });

  it('uncorrelated violates the correlation on purpose, so the schema rejects it', () => {
    const body = resolveScenario('accounts', 'uncorrelated').body;
    assert.equal(body.hash, null);
    assert.equal(body.alreadyActive, false);
  });

  it('the 409 variants cover all three sponsorSequence shapes the classifier discriminates', () => {
    assert.match(resolveScenario('accounts', '409').body.sponsorSequence, /^\d+$/);
    assert.equal('sponsorSequence' in resolveScenario('accounts', '409-no-sequence').body, false);
    assert.equal(resolveScenario('accounts', '409-bad-sequence').body.sponsorSequence, 'abc');
  });

  it('the 429 variants cover quota (coded, with a hint), throttle (bare) and a rejected hint', () => {
    const quota = resolveScenario('accounts', '429-quota').body;
    assert.equal(quota.error, 'SPONSOR_RATE_LIMITED');
    assert.ok(quota.retryAfterSeconds > 0);

    const throttle = resolveScenario('accounts', '429-throttle').body;
    assert.equal('error' in throttle, false, 'the per-IP throttle 429 carries no domain code');
    assert.equal('retryAfterSeconds' in throttle, false);

    assert.ok(resolveScenario('accounts', '429-bad-retry-after').body.retryAfterSeconds <= 0);
  });

  it('the two 503 codes are the ones that split the classifier', () => {
    assert.equal(resolveScenario('accounts', '503-budget').body.error, 'SPONSOR_BUDGET_EXHAUSTED');
    assert.equal(resolveScenario('accounts', '503-horizon').body.error, 'HORIZON_UNAVAILABLE');
    assert.equal(DOMAIN_CODES.includes(resolveScenario('accounts', '503-draining').body.error), false);
  });

  it('401 carries the framework LABEL, not a domain code and not nothing', () => {
    for (const [endpoint, name] of [
      ['accounts', '401'],
      ['config', 'config-401'],
    ]) {
      const body = resolveScenario(endpoint, name).body;
      assert.equal(body.error, 'Unauthorized', `${endpoint}/${name} must carry the Unauthorized label`);
      assert.equal(DOMAIN_CODES.includes(body.error), false);
    }
  });
});

describe('scripted scenarios', () => {
  it('409-then-submitted conflicts once, then succeeds', () => {
    assert.equal(resolveScenario('accounts', '409-then-submitted', 0).status, 409);
    assert.equal(resolveScenario('accounts', '409-then-submitted', 1).status, 200);
    assert.equal(resolveScenario('accounts', '409-then-submitted', 1).body.alreadyActive, false);
  });

  it('409-then-already-active resolves to the alreadyActive success', () => {
    assert.equal(resolveScenario('accounts', '409-then-already-active', 0).status, 409);
    assert.equal(resolveScenario('accounts', '409-then-already-active', 1).body.alreadyActive, true);
  });

  it('503-horizon-then-submitted fails once then accepts the identical payload', () => {
    const first = resolveScenario('accounts', '503-horizon-then-submitted', 0);
    assert.equal(first.status, 503);
    assert.equal(first.body.error, 'HORIZON_UNAVAILABLE');
    assert.equal(resolveScenario('accounts', '503-horizon-then-submitted', 1).status, 200);
  });

  it('isScripted identifies exactly the attempt-dependent scenarios', () => {
    const scripted = names.accounts.filter(name => isScripted('accounts', name));
    assert.deepEqual(scripted.toSorted(), [
      '409-then-already-active',
      '409-then-submitted',
      '503-horizon-then-submitted',
    ]);
  });

  it('an unscripted scenario ignores the attempt count', () => {
    for (const attempt of [0, 1, 5]) {
      assert.equal(resolveScenario('accounts', '422', attempt).status, 422);
    }
  });
});

describe('request validation', () => {
  const validXdr = Buffer.concat([Buffer.from([0, 0, 0, 2]), Buffer.alloc(32)]).toString('base64');

  it('accepts exactly { data }', () => {
    assert.equal(validateAccountRequest({ data: validXdr }), undefined);
  });

  it('rejects an extra field — the real pipe uses forbidNonWhitelisted', () => {
    assert.match(validateAccountRequest({ data: validXdr, trace: 'x' }), /exactly the `data` field/);
  });

  it('rejects a missing, empty or non-string data field', () => {
    assert.ok(validateAccountRequest({}));
    assert.ok(validateAccountRequest({ data: '' }));
    assert.ok(validateAccountRequest({ data: 42 }));
    assert.ok(validateAccountRequest(null));
  });

  it('rejects a payload over 4096 base64 characters', () => {
    assert.match(validateAccountRequest({ data: 'A'.repeat(4097) }), /4096/);
  });

  it('rejects a fee-bump envelope by its discriminant', () => {
    // First four bytes encode the rejected TX_FEE_BUMP discriminant.
    const feeBump = Buffer.concat([Buffer.from([0, 0, 0, 5]), Buffer.alloc(32)]).toString('base64');
    assert.match(validateAccountRequest({ data: feeBump }), /fee-bump/);
  });
});

describe('horizon double', () => {
  it('the sponsor account always loads — otherwise activation dies before it can POST', () => {
    const { status, body } = resolveAccount(MOCK_SPONSOR_ACCOUNT, initialHorizonState());
    assert.equal(status, 200);
    assert.equal(body.account_id, MOCK_SPONSOR_ACCOUNT);
    assert.match(body.sequence, /^\d+$/, 'sequenceNumber() needs a digit string');
  });

  it('an unlisted account 404s, which is the normal pre-activation state', () => {
    const { status, body } = resolveAccount('GNOPE', initialHorizonState());
    assert.equal(status, 404);
    assert.equal(body.status, 404);
  });

  it('a listed account loads with the selected profile', () => {
    const state = { ...initialHorizonState(), activeAccounts: ['GTEST'], profile: 'funded' };
    const { status, body } = resolveAccount('GTEST', state);
    assert.equal(status, 200);
    assert.equal(body.balances[0].balance, '5.0000000');
  });

  it('mode down makes every read a 503, distinct from a 404', () => {
    const state = { ...initialHorizonState(), mode: 'down', activeAccounts: ['GTEST'] };
    assert.equal(resolveAccount('GTEST', state).status, 503);
    assert.equal(resolveAccount(MOCK_SPONSOR_ACCOUNT, state).status, 503);
  });

  it('an unknown profile falls back rather than throwing', () => {
    const state = { ...initialHorizonState(), activeAccounts: ['GTEST'], profile: 'nope' };
    assert.equal(resolveAccount('GTEST', state).status, 200);
  });

  it('every record carries exactly the fields the reserve math reads', () => {
    for (const [name, build] of Object.entries(ACCOUNT_PROFILES)) {
      const record = build('GTEST');
      const native = record.balances.find(b => b.asset_type === 'native');
      assert.ok(native, `${name} has no native balance entry`);
      assert.match(native.balance, /^\d+(\.\d+)?$/, `${name} balance is not a decimal string`);
      assert.match(native.selling_liabilities, /^\d+(\.\d+)?$/, `${name} selling_liabilities is malformed`);
      assert.equal(typeof record.subentry_count, 'number');
      assert.equal(typeof record.num_sponsoring, 'number');
      assert.equal(typeof record.num_sponsored, 'number');
    }
  });

  it('sponsored-empty exists holding nothing — the post-activation state', () => {
    const record = ACCOUNT_PROFILES['sponsored-empty']('GTEST');
    assert.equal(record.balances[0].balance, '0.0000000');
    assert.equal(lockedReserveXlm(record), 0);
  });

  it('reserve-locked has a balance that total-balance math would wrongly call sufficient', () => {
    const record = ACCOUNT_PROFILES['reserve-locked']('GTEST');
    assert.equal(lockedReserveXlm(record), 1);
    assert.equal(record.balances[0].balance, '1.0000000');
  });

  it('one-trustline locks an extra base reserve for the subentry it already owns', () => {
    assert.equal(lockedReserveXlm(ACCOUNT_PROFILES['one-trustline']('GTEST')), 1.5);
  });

  it('notFoundBody reports the 404 status the SDK keys off', () => {
    assert.equal(notFoundBody('GTEST').status, 404);
  });

  it('accountRecord defaults to an empty, sequence-1 account', () => {
    const record = accountRecord({ accountId: 'GTEST' });
    assert.equal(record.sequence, '1');
    assert.equal(record.balances[0].balance, '0.0000000');
  });
});
