// Local mock intake for testing the Sentry + Datadog SodaxLogger adapters WITHOUT DNS or a
// real account. Both vendors are pointed at this server (via the Vite dev proxy — see
// vite.config.ts `/__intake`), so every log the SDK emits is printed here instead of leaving
// the machine. Zero dependencies — Node's built-in http only.
//
//   node scripts/mock-intake.mjs       (or: pnpm mock-intake)
//
// Routes (after the Vite proxy strips the `/__intake` prefix):
//   POST /sentry    <- Sentry envelope (newline-delimited JSON), sent via Sentry's `tunnel`
//   POST /datadog   <- Datadog log record(s) (JSON), sent by the plain-HTTP-intake adapter

import http from 'node:http';

const PORT = Number(process.env.MOCK_INTAKE_PORT ?? 9009);

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  sentry: '\x1b[35m', // magenta
  datadog: '\x1b[34m', // blue
  ok: '\x1b[32m',
  warn: '\x1b[33m',
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function ts() {
  // Wall-clock for human reading only.
  return new Date().toISOString().slice(11, 23);
}

// Sentry's `message` can be a plain string or a `{ formatted, message }` LogEntry object.
function sentryMessage(payload) {
  const m = payload?.message;
  if (typeof m === 'string') return m;
  if (m && typeof m === 'object') return m.formatted ?? m.message;
  return undefined;
}

// A Sentry envelope is: header line, then repeating [item-header line, item-payload line].
// We surface the actual log events; non-event items (sessions, etc.) collapse to a quiet note.
function printSentry(raw) {
  const lines = raw.split('\n').filter((l) => l.length > 0);
  const events = [];
  const otherTypes = [];
  for (let i = 1; i < lines.length; i += 2) {
    const type = safeJson(lines[i])?.type ?? 'item';
    if (type === 'event') events.push(safeJson(lines[i + 1]));
    else otherTypes.push(type);
  }

  if (events.length === 0) {
    // Sessions / metrics / etc. — not your logs. One dim line so the noise is visible but tiny.
    console.log(`${C.sentry}· SENTRY${C.reset} ${C.dim}${ts()}  ${otherTypes.join(', ') || 'empty'} (not a log event)${C.reset}`);
    return;
  }

  for (const payload of events) {
    const level = payload?.level ?? 'error';
    const message = sentryMessage(payload) ?? payload?.exception?.values?.[0]?.value ?? '(exception)';
    console.log(`${C.sentry}┌─ SENTRY${C.reset} ${C.dim}${ts()}  [${level}]${C.reset} ${message}`);
    if (payload?.exception) {
      const ex = payload.exception.values?.[0];
      console.log(`${C.sentry}│${C.reset}  exception: ${ex?.type}: ${ex?.value}`);
    }
    if (payload?.extra && Object.keys(payload.extra).length) {
      console.log(`${C.sentry}│${C.reset}  extra: ${JSON.stringify(payload.extra)}`);
    }
    const crumbs = payload?.breadcrumbs?.values ?? payload?.breadcrumbs;
    if (Array.isArray(crumbs) && crumbs.length) {
      console.log(`${C.sentry}│${C.reset}  breadcrumbs (debug/info ride here):`);
      for (const b of crumbs) {
        console.log(`${C.sentry}│${C.reset}    [${b?.level ?? 'info'}] ${b?.message}${b?.data ? ` ${JSON.stringify(b.data)}` : ''}`);
      }
    }
    console.log(`${C.sentry}└─${C.reset}`);
  }
}

function printDatadog(raw) {
  const parsed = safeJson(raw);
  const records = Array.isArray(parsed) ? parsed : [parsed];
  for (const r of records) {
    const status = r?.status ?? 'info';
    console.log(`${C.datadog}┌─ DATADOG${C.reset} ${C.dim}${ts()}  service=${r?.service ?? '?'}${C.reset}`);
    console.log(`${C.datadog}│${C.reset}  [${status}] ${r?.message ?? raw}`);
    const { status: _s, message: _m, service: _sv, ddsource: _src, error, ...attrs } = r ?? {};
    if (error !== undefined) console.log(`${C.datadog}│${C.reset}  error: ${JSON.stringify(error)}`);
    if (Object.keys(attrs).length) console.log(`${C.datadog}│${C.reset}  attrs: ${JSON.stringify(attrs)}`);
    console.log(`${C.datadog}└─${C.reset}`);
  }
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

const server = http.createServer(async (req, res) => {
  // Permissive CORS so the adapters work even if called directly (not just through the Vite proxy).
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
    res.end('sodax mock-intake up — POST /sentry or /datadog\n');
    return;
  }

  const body = await readBody(req);
  try {
    if (req.url?.includes('sentry')) printSentry(body);
    else if (req.url?.includes('datadog')) printDatadog(body);
    else console.log(`${C.warn}? ${req.url}${C.reset}\n${body}`);
  } catch (err) {
    console.log(`${C.warn}failed to parse ${req.url}:${C.reset}`, err, '\nraw:', body);
  }

  // Sentry expects a JSON body with an id; Datadog is happy with 202/200. Return both-friendly 200.
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ id: 'mock-intake' }));
});

server.listen(PORT, () => {
  console.log(`${C.ok}sodax mock-intake listening on http://localhost:${PORT}${C.reset}`);
  console.log(`${C.dim}  Sentry  -> POST /sentry  (via Sentry tunnel)`);
  console.log(`  Datadog -> POST /datadog (plain HTTP intake)`);
  console.log(`  Browser reaches both through the Vite proxy at /__intake/* (no DNS, no CORS).${C.reset}`);
});
