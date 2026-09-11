import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('./server.mjs', import.meta.url));
const API_KEY = 'routing-test-key';
const BOOT_TIMEOUT_MS = 10_000;

/** Minimal body that reaches dispatch without representing a real transaction. */
const VALID_ENVELOPE = Buffer.from([0, 0, 0, 2, 1, 2, 3, 4]).toString('base64');

let child;
let origin;

function boot() {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, MOCK_SPONSORING_PORT: '0', MOCK_SPONSORING_API_KEY: API_KEY },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => reject(new Error('mock server did not report a port in time')), BOOT_TIMEOUT_MS);
    let buffered = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffered += chunk;
      const match = /listening on (http:\/\/localhost:\d+)/.exec(buffered);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', code => {
      clearTimeout(timer);
      reject(new Error(`mock server exited early with code ${code}`));
    });
  });
}

const get = (path, headers = { 'x-api-key': API_KEY }) => fetch(`${origin}${path}`, { headers });
const post = (path, body) =>
  fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('mock server routing', () => {
  before(async () => {
    origin = await boot();
  });

  after(() => {
    child?.kill();
  });

  it('serves the sponsoring routes at the unversioned path', async () => {
    const config = await get('/sponsorships/stellar/config');
    assert.equal(config.status, 200);
    assert.equal((await config.json()).networkPassphrase, 'Public Global Stellar Network ; September 2015');

    const accounts = await post('/sponsorships/stellar/accounts', { data: VALID_ENVELOPE });
    assert.equal(accounts.status, 200);
    assert.equal((await accounts.json()).alreadyActive, false);
  });

  for (const prefix of ['/v1', '/v2']) {
    it(`tolerates a ${prefix} deployment prefix`, async () => {
      const config = await get(`${prefix}/sponsorships/stellar/config`);
      assert.equal(config.status, 200);

      const accounts = await post(`${prefix}/sponsorships/stellar/accounts`, { data: VALID_ENVELOPE });
      assert.equal(accounts.status, 200);
    });
  }

  // Accept exactly one numeric version prefix, not arbitrary paths.
  for (const path of [
    '/v1', // version segment alone
    '/v1/sponsorships/stellar', // prefix without an endpoint
    '/sponsorships/stellar/nope', // unknown endpoint
    '/v1/v1/sponsorships/stellar/config', // doubled prefix
    '/vnext/sponsorships/stellar/config', // non-numeric segment
  ]) {
    it(`404s ${path}`, async () => {
      const response = await get(path);
      assert.equal(response.status, 404);
      assert.match((await response.json()).message, /^Cannot GET /);
    });
  }

  it('rejects a keyless call before routing, under either prefix', async () => {
    for (const path of ['/sponsorships/stellar/config', '/v1/sponsorships/stellar/config']) {
      const response = await get(path, {});
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error, 'Unauthorized');
    }
  });

  // Version stripping must not affect control or Horizon routes.
  it('leaves the control and horizon paths untouched', async () => {
    const health = await get('/__control/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).up, true);

    assert.equal((await get('/v1/__control/health')).status, 404);
  });
});
