import http from 'node:http';
import { initialHorizonState, resolveAccount } from './horizon.mjs';
import { HANG, isScripted, resolveScenario, scenarioNames, validateAccountRequest } from './scenarios.mjs';

const PORT = Number(process.env.MOCK_SPONSORING_PORT ?? 9011);
const API_KEY = process.env.MOCK_SPONSORING_API_KEY ?? 'mock-dev-key';
const REQUIRE_API_KEY = process.env.MOCK_REQUIRE_API_KEY !== 'false';

// Version-free to emulate both bare and gateway-prefixed deployments.
const SPONSORING_BASE = '/sponsorships/stellar';

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  ok: '\x1b[32m',
  warn: '\x1b[33m',
  err: '\x1b[31m',
  cfg: '\x1b[36m',
  acct: '\x1b[35m',
};

const counters = new Map();
let horizonState = initialHorizonState();
/** Reset closes hung sockets to prevent leaks. */
const hungResponses = new Set();

function ts() {
  return new Date().toISOString().slice(11, 23);
}

function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function safeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function bump(endpoint, name) {
  const key = `${endpoint}:${name || 'ok'}`;
  const next = (counters.get(key) ?? 0) + 1;
  counters.set(key, next);
  return next - 1;
}

function logLine(color, label, status, detail) {
  const tone = status >= 500 ? C.err : status >= 400 ? C.warn : C.ok;
  console.log(`${color}${label}${C.reset} ${C.dim}${ts()}${C.reset} ${tone}${status}${C.reset} ${detail}`);
}

function handleControl(req, res, path, rawBody) {
  if (path === '/__control/health' && req.method === 'GET') {
    sendJson(res, 200, { up: true, apiKeyRequired: REQUIRE_API_KEY, scenarios: scenarioNames() });
    return true;
  }

  if (path === '/__control/stats' && req.method === 'GET') {
    sendJson(res, 200, { counts: Object.fromEntries(counters), horizon: horizonState });
    return true;
  }

  if (path === '/__control/reset' && req.method === 'POST') {
    counters.clear();
    for (const held of hungResponses) held.destroy();
    hungResponses.clear();
    sendJson(res, 200, { reset: true });
    return true;
  }

  if (path === '/__control/horizon' && req.method === 'POST') {
    const parsed = safeJson(rawBody) ?? {};
    horizonState = {
      activeAccounts: Array.isArray(parsed.activeAccounts) ? parsed.activeAccounts : horizonState.activeAccounts,
      profile: typeof parsed.profile === 'string' ? parsed.profile : horizonState.profile,
      mode: parsed.mode === 'down' || parsed.mode === 'ok' ? parsed.mode : horizonState.mode,
    };
    logLine(C.dim, '· CONTROL', 200, `horizon ${horizonState.mode} profile=${horizonState.profile}`);
    sendJson(res, 200, horizonState);
    return true;
  }

  return false;
}

/** Malformed escapes must not crash the mock. */
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function handleHorizon(res, path) {
  const match = /^\/__horizon\/accounts\/([^/?]+)/.exec(path);
  if (!match) {
    sendJson(res, 404, { status: 404, title: 'Resource Missing', detail: 'only /accounts/:id is mocked' });
    return;
  }
  const accountId = safeDecode(match[1]);
  const { status, body } = resolveAccount(accountId, horizonState);
  logLine(C.dim, '· HORIZON', status, `${accountId.slice(0, 8)}…`);
  sendJson(res, status, body);
}

function hang(res) {
  hungResponses.add(res);
  res.on('close', () => hungResponses.delete(res));
}

function handleConfig(req, res, scenario) {
  const attempt = bump('config', scenario);
  const outcome = resolveScenario('config', scenario, attempt);
  if (outcome === HANG) {
    logLine(C.cfg, '↻ CONFIG ', 0, `${scenario} — holding the socket open`);
    hang(res);
    return;
  }
  logLine(C.cfg, '· CONFIG ', outcome.status, scenario || 'ok');
  res.writeHead(outcome.status, {
    'Content-Type': 'application/json',
    // Scenario and auth headers must participate in the browser cache key.
    Vary: 'x-mock-scenario, x-api-key',
    // Cache only successful config, matching service behavior.
    'Cache-Control': outcome.status === 200 ? 'private, max-age=60' : 'no-store',
  });
  res.end(JSON.stringify(outcome.body));
}

function handleAccounts(req, res, scenario, rawBody) {
  const parsed = safeJson(rawBody);
  const invalid = validateAccountRequest(parsed);

  // Match the service's validation-before-scenario order.
  if (invalid) {
    logLine(C.acct, '· ACCOUNT', 400, `rejected by validation: ${invalid}`);
    sendJson(res, 400, { statusCode: 400, error: 'INVALID_SPONSOR_XDR', message: invalid });
    return;
  }

  const attempt = bump('accounts', scenario);
  const outcome = resolveScenario('accounts', scenario, attempt);
  if (outcome === HANG) {
    logLine(C.acct, '↻ ACCOUNT', 0, `${scenario} — holding the socket open`);
    hang(res);
    return;
  }

  const scripted = isScripted('accounts', scenario) ? ` (attempt ${attempt + 1})` : '';
  logLine(C.acct, '· ACCOUNT', outcome.status, `${scenario || 'ok'}${scripted}`);
  sendJson(res, outcome.status, outcome.body);
}

const server = http.createServer(async (req, res) => {
  // Keep one handler error from turning later scenarios into misleading proxy 500s.
  try {
    await route(req, res);
  } catch (error) {
    console.log(`${C.err}! HANDLER${C.reset} ${C.dim}${ts()}${C.reset} ${error?.stack ?? error}`);
    if (!res.headersSent) sendJson(res, 500, { statusCode: 500, message: 'mock server handler error' });
    else res.end();
  }
});

async function route(req, res) {
  // Set CORS before routing so browser-visible errors retain their bodies.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const path = (req.url ?? '/').split('?')[0];
  const rawBody = req.method === 'POST' ? await readBody(req) : '';

  if (path.startsWith('/__control/')) {
    if (handleControl(req, res, path, rawBody)) return;
    sendJson(res, 404, { statusCode: 404, message: `no control route ${req.method} ${path}` });
    return;
  }

  if (path.startsWith('/__horizon/')) {
    handleHorizon(res, path);
    return;
  }

  // Match the service's auth-before-dispatch order.
  if (REQUIRE_API_KEY && req.headers['x-api-key'] !== API_KEY) {
    const reason = req.headers['x-api-key'] === undefined ? 'Missing x-api-key' : 'Invalid x-api-key';
    logLine(C.warn, '· AUTH   ', 401, reason);
    sendJson(res, 401, { statusCode: 401, error: 'Unauthorized', message: reason });
    return;
  }

  const scenario = req.headers['x-mock-scenario'];
  const scenarioName = typeof scenario === 'string' ? scenario : '';

  // Accept one gateway version prefix as well as the bare local path.
  const routePath = path.replace(/^\/v\d+(?=\/)/, '');

  if (routePath === `${SPONSORING_BASE}/config` && req.method === 'GET') {
    handleConfig(req, res, scenarioName);
    return;
  }

  if (routePath === `${SPONSORING_BASE}/accounts` && req.method === 'POST') {
    handleAccounts(req, res, scenarioName, rawBody);
    return;
  }

  logLine(C.warn, '? UNKNOWN', 404, `${req.method} ${path}`);
  sendJson(res, 404, { statusCode: 404, message: `Cannot ${req.method} ${path}` });
}

server.listen(PORT, () => {
  const names = scenarioNames();
  // Port 0 resolves to the OS-assigned test port.
  const { port } = server.address();
  console.log(`${C.ok}sodax mock-sponsoring listening on http://localhost:${port}${C.reset}`);
  console.log(`${C.dim}  sponsoring -> ${SPONSORING_BASE}/config, ${SPONSORING_BASE}/accounts (or /vN-prefixed)`);
  console.log(`  horizon    -> /__horizon/accounts/:accountId`);
  console.log(`  control    -> /__control/{health,reset,stats,horizon}`);
  console.log(`  scenarios  -> ${names.config.length} config, ${names.accounts.length} accounts`);
  console.log(`  Browser reaches this through the Vite proxy at /__sponsor/* and /__horizon/*.${C.reset}`);
});
