// Local reference ERC-7677 PAYMASTER PROXY for testing SODAX gasless Mode A WITHOUT shipping the
// Pimlico key to the browser. In Mode A the connected wallet POSTs ERC-7677 JSON-RPC
// (`pm_getPaymasterStubData` / `pm_getPaymasterData`) to this server; it adds the Pimlico key
// server-side and forwards to Pimlico. Zero dependencies — Node's built-in http + global fetch (Node 18+).
//
//   PIMLICO_API_KEY=… node scripts/paymaster-proxy.mjs        (or: pnpm paymaster-proxy)
//
// Point the SDK at it (the browser never sees the key):
//   new Sodax({ gasless: { paymasterProxyUrl: 'http://localhost:9010', chains: { …supports7702 } } })
// The SDK appends the chain id, so requests arrive as POST /<chainId> (decimal), e.g. /8453 (Base).
//
// ⚠️ DEMO-ONLY forwarder — it sponsors whatever it's asked to. A production proxy MUST additionally:
//   - validate the UserOperation (only sponsor SODAX `[approve, transfer]` to the SpokeAssetManager for
//     known tokens) so it can't be drained to sponsor arbitrary calls,
//   - authenticate the caller and rate-limit,
//   - own the Pimlico sponsorship policy server-side (never trust client-supplied paymaster context).

import http from 'node:http';

const PORT = Number(process.env.PAYMASTER_PROXY_PORT ?? 9010);
const PIMLICO_API_KEY = process.env.PIMLICO_API_KEY;
if (!PIMLICO_API_KEY) {
  console.error('PIMLICO_API_KEY env var is required (the proxy adds it server-side).');
  process.exit(1);
}

const C = { reset: '\x1b[0m', dim: '\x1b[2m', pm: '\x1b[36m', ok: '\x1b[32m', warn: '\x1b[33m' };

function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}
const ts = () => new Date().toISOString().slice(11, 23);
const safeJson = s => {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};

const server = http.createServer(async (req, res) => {
  // Permissive CORS: in Mode A the WALLET (cross-origin) fetches this URL, not the page.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('sodax paymaster-proxy up — POST /<chainId> with ERC-7677 JSON-RPC\n');
    return;
  }

  // Path is `/<chainId>` (decimal), appended by the SDK from `paymasterProxyUrl`.
  const chainId = Number((req.url ?? '').replace(/^\/+/, '').split(/[/?]/)[0]);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `bad chain id in path: ${req.url}` }));
    return;
  }

  const body = await readBody(req);
  const method = safeJson(body)?.method ?? '(unknown)';
  console.log(`${C.pm}→ paymaster${C.reset} ${C.dim}${ts()}  chain ${chainId}  ${method}${C.reset}`);

  try {
    const upstream = await fetch(`https://api.pimlico.io/v2/${chainId}/rpc?apikey=${PIMLICO_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
    res.end(text);
  } catch (err) {
    console.log(`${C.warn}✗ upstream error${C.reset}`, err);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'paymaster upstream failed' }));
  }
});

server.listen(PORT, () => {
  console.log(`${C.ok}sodax paymaster-proxy listening on http://localhost:${PORT}${C.reset}`);
  console.log(`${C.dim}  Point the SDK at it: gasless.paymasterProxyUrl = 'http://localhost:${PORT}'`);
  console.log(`  Forwards POST /<chainId> → Pimlico v2 (key added here, never sent to the browser).${C.reset}`);
});
