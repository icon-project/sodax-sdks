import 'dotenv/config';

import { Sodax, type CreateIntentParams, type SpokeChainKey } from '@sodax/sdk';

// Reproduce, in Node, EXACTLY how the backend (BE) builds raw Bitcoin-source swap data via the SDK.
// BE uses @sodax/sdk; this script uses @sodax/sdk the same way, so what fails here fails there.
//
// Flow mirrored:
//   1. BE receives a JSON create-intent body over HTTP (string numerics) — `apiBody` below is the
//      exact reported payload (Bitcoin → Polygon).
//   2. BE maps it to the SDK domain `CreateIntentParams` (bigint numerics, `data` defaulted).
//   3. BE calls `sodax.swaps.createIntent({ params, raw: true })` — no walletProvider — to get the
//      unsigned raw tx (for Bitcoin TRADING, a Bound-built PSBT) which it returns to the client.
//
// What this verifies:
//   - After the RadfiProvider fix, a non-JSON Bound response surfaces as a legible error carrying
//     the real HTTP status (e.g. 403) instead of `Unexpected token '<' ... is not valid JSON`.
//   - With a valid Bound access token injected, the raw PSBT actually builds (result.ok).
//
// The raw build can't run the interactive BIP322 sign-in, so a server-side caller injects the
// Bound access token it already holds (BE pattern). Two ways, both shown/honored below:
//   - new Sodax({ ... }) with radfi.accessToken in config (now seeded by RadfiProvider), or
//   - sodax.spoke.bitcoin.radfi.setRadfiAccessToken(token) at runtime.
//
// Run (build the SDK first so the fix is in node_modules resolution):
//   pnpm --filter @sodax/sdk build
//   cd apps/node && pnpm bitcoin-raw-intent-check
// Optional env: BOUND_ACCESS_TOKEN=<jwt> to exercise the happy path; BTC_ADDRESS=<bc1...>.

// The over-the-wire create-intent body BE receives (CreateIntentParamsV2 shape — string numerics).
type ApiCreateIntentBody = {
  srcChainKey: string;
  dstChainKey: string;
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  minOutputAmount: string;
  deadline: string;
  allowPartialFill: boolean;
  srcAddress: string;
  dstAddress: string;
};

// Payload defaults mirror the reported Bitcoin → Base case; every field is overridable via env so you
// don't edit code per run. `deadline` is computed dynamically (now + 10 min) — a hardcoded timestamp
// would silently expire. Override any field: SRC_CHAIN, DST_CHAIN, INPUT_TOKEN, OUTPUT_TOKEN,
// INPUT_AMOUNT, MIN_OUTPUT_AMOUNT, DEADLINE, BTC_ADDRESS, DST_ADDRESS.
const apiBody: ApiCreateIntentBody = {
  srcChainKey: process.env.SRC_CHAIN ?? 'bitcoin',
  dstChainKey: process.env.DST_CHAIN ?? '0x2105.base',
  inputToken: process.env.INPUT_TOKEN ?? '0:0', // native BTC (8 decimals)
  outputToken: process.env.OUTPUT_TOKEN ?? '0x0000000000000000000000000000000000000000',
  inputAmount: process.env.INPUT_AMOUNT ?? '550',
  minOutputAmount: process.env.MIN_OUTPUT_AMOUNT ?? '196729826014250',
  deadline: process.env.DEADLINE ?? String(Math.floor(Date.now() / 1000) + 600),
  allowPartialFill: false,
  // MUST match the address the BOUND_ACCESS_TOKEN was issued for, or Bound rejects (userAddress mismatch).
  srcAddress: process.env.BTC_ADDRESS ?? 'bc1pax7wcjw4r7m25fn2405x5a5f6vucv8pcqr8ltsz2mp4xjmx26rgstqgwhz',
  dstAddress: process.env.DST_ADDRESS ?? '0x1468d3529032106291433B7e9e3026dF1Ff78F31',
};

const boundAccessToken = process.env.BOUND_ACCESS_TOKEN;

// Map the HTTP body (strings) to the SDK domain params (bigint numerics). This is the conversion BE
// does before handing the request to the SDK; `data` defaults to '0x' (no extra solver hook).
function toCreateIntentParams(body: ApiCreateIntentBody): CreateIntentParams {
  return {
    srcChainKey: body.srcChainKey as SpokeChainKey,
    dstChainKey: body.dstChainKey as SpokeChainKey,
    inputToken: body.inputToken,
    outputToken: body.outputToken,
    inputAmount: BigInt(body.inputAmount),
    minOutputAmount: BigInt(body.minOutputAmount),
    deadline: BigInt(body.deadline),
    allowPartialFill: body.allowPartialFill,
    srcAddress: body.srcAddress,
    dstAddress: body.dstAddress,
    data: '0x',
  };
}

// Stringify replacer so bigint fields (intent, error context) don't throw in console output.
const bigintSafe = (_key: string, value: unknown): unknown =>
  typeof value === 'bigint' ? value.toString() : value;

// Decode a JWT payload (claims only — no signature verification) to inspect userAddress/exp.
function decodeJwtClaims(token: string): Record<string, unknown> | undefined {
  try {
    const payload = token.split('.')[1];
    return payload ? JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) : undefined;
  } catch {
    return undefined;
  }
}

// Intercept fetch to print the EXACT request the SDK sends to Bound Exchange (the call that 403s),
// so we can inspect the full payload Bound receives. The bearer token is masked — never log secrets.
function installBoundRequestLogger(): void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url.includes('bound.exchange')) {
      // Bound accepts requests that look like a browser (Origin + UA + Sec-Fetch); a Node request
      // lacks them and gets 403 — NOT an IP block (a browser on the same machine/IP gets through).
      // Set BOUND_ORIGIN to spoof browser headers and test whether the 403 is just header-gated
      // (goes away) vs a Cloudflare fingerprint/JS challenge a server can't fake (persists).
      // Diagnostic only — the SDK itself sends none of these.
      const origin = process.env.BOUND_ORIGIN;
      if (origin) {
        init = {
          ...init,
          headers: {
            ...(init?.headers as Record<string, string> | undefined),
            Origin: origin,
            Referer: `${origin}/`,
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'application/json, text/plain, */*',
            'Sec-Fetch-Site': 'cross-site',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Dest': 'empty',
          },
        };
      }
      const authHeader = (init?.headers as Record<string, string> | undefined)?.Authorization;
      const token = authHeader?.replace(/^Bearer\s*/i, '') ?? '';
      console.log('\n── Bound Exchange request (full payload) ──');
      console.log('  →', init?.method ?? 'GET', url);
      console.log('  Origin       :', origin ?? '(none — Node default; this is what BE server sends)');
      console.log(
        '  Authorization:',
        token ? `Bearer <token present, ${token.length} chars>` : 'Bearer <EMPTY — Bound receives NO access token>',
      );
      if (token) {
        const claims = decodeJwtClaims(token);
        if (claims) {
          const now = Math.floor(Date.now() / 1000);
          const exp = typeof claims.exp === 'number' ? claims.exp : undefined;
          console.log('  token.userAddress:', claims.userAddress ?? claims.sub ?? '(none)');
          console.log('  token.type       :', claims.type ?? '(none)');
          console.log(
            '  token.exp        :',
            exp ? `${exp} (${exp < now ? `EXPIRED ${now - exp}s ago` : `valid ${exp - now}s left`})` : '(none)',
          );
        } else {
          console.log('  token: not a decodable JWT (opaque or malformed?)');
        }
      }
      if (typeof init?.body === 'string') {
        try {
          console.log('  body:\n', JSON.stringify(JSON.parse(init.body), null, 2));
        } catch {
          console.log('  body:', init.body);
        }
      }
      console.log('───────────────────────────────────────────');
    }
    const res = await realFetch(input, init);
    if (url.includes('bound.exchange')) {
      const text = await res.clone().text();
      console.log('  ← response:', res.status, res.ok ? 'OK' : 'FAIL');
      console.log('  ← body    :', text.length > 800 ? `${text.slice(0, 800)}…` : text);
      console.log('───────────────────────────────────────────');
    }
    return res;
  };
}

async function main(): Promise<void> {
  installBoundRequestLogger();
  const sodax = new Sodax();

  if (boundAccessToken) {
    sodax.spoke.bitcoin.radfi.setRadfiAccessToken(boundAccessToken);
    console.log('• Bound access token injected onto the radfi provider — expecting the happy path.');
  } else {
    console.log(
      '• No BOUND_ACCESS_TOKEN set — expecting a CLEAR auth/HTTP error (no more "Unexpected token \'<\'").',
    );
  }

  const params = toCreateIntentParams(apiBody);
  console.log('\n→ Building raw intent exactly as BE does: sodax.swaps.createIntent({ raw: true })\n');

  const result = await sodax.swaps.createIntent({ params, raw: true });

  if (result.ok) {
    const { tx, intent, relayData } = result.value;
    console.log('✅ raw data built — this is what BE returns to the client to sign + co-sign via Bound.');
    console.log('  tx (unsigned PSBT base64):', tx);
    console.log('  relayData                :', relayData);
    console.log('  intent                   :', JSON.stringify(intent, bigintSafe, 2));
    return;
  }

  // The failure is now legible: error.cause is the underlying RadfiApiError (HTTP status + body
  // snippet) instead of a JSON SyntaxError. Before the fix this printed "Unexpected token '<'".
  const err = result.error;
  console.error('❌ createIntent failed — and the reason is now readable:');
  console.error('  code   :', err.code);
  console.error('  feature:', err.feature);
  console.error('  message:', err.message);
  console.error('  cause  :', err.cause);
  console.error('\n  full error JSON:\n', JSON.stringify(err, bigintSafe, 2));
}

main().catch(error => {
  console.error('Uncaught error:', error);
  process.exit(1);
});
