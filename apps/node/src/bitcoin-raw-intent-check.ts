import 'dotenv/config';

import { Sodax, ChainKeys, type CreateIntentParams, type SpokeChainKey } from '@sodax/sdk';

// Reproduce, in Node, how the backend (BE) builds a raw Bitcoin-source swap via @sodax/sdk.
//
// New flow: the Bound Exchange access token travels IN the request body
// (CreateIntentParamsV2.accessToken) and is forwarded to the SDK through the typed, Bitcoin-gated
// `extras.accessToken` slot — not an `x-bound-access-token` header, not setRadfiAccessToken().
//
//   1. BE receives a JSON create-intent body (string numerics + accessToken) — `apiBody` below.
//   2. BE maps it to SDK domain params (bigint numerics) and lifts accessToken into `extras`.
//   3. BE calls createIntent({ params, extras, raw: true }) — no walletProvider — to get the unsigned
//      PSBT it returns to the client to sign + co-sign via Bound.
//
// With a valid token the raw PSBT builds (result.ok). Without one the failure is legible
// (RadfiApiError: real HTTP status + body), not "Unexpected token '<' ... is not valid JSON".
//
// Run:
//   pnpm --filter @sodax/sdk build
//   cd apps/node && BOUND_ACCESS_TOKEN=<jwt> BTC_ADDRESS=<bc1...> pnpm bitcoin-raw-intent-check
// Every apiBody field is env-overridable. srcAddress MUST match the address BOUND_ACCESS_TOKEN was
// issued for, or Bound rejects (userAddress mismatch).

type BitcoinKey = typeof ChainKeys.BITCOIN_MAINNET;

// Over-the-wire create-intent body BE receives (CreateIntentParamsV2 shape — string numerics).
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
  accessToken?: string; // Bound Exchange token for Bitcoin TRADING-mode raw intents.
};

// Defaults mirror the reported Bitcoin → Base case (srcChainKey is fixed to Bitcoin — this is the
// Bitcoin raw check). `deadline` is now + 10 min so it never silently expires. Override any other
// field via env: DST_CHAIN, INPUT_TOKEN, OUTPUT_TOKEN, INPUT_AMOUNT, MIN_OUTPUT_AMOUNT, DEADLINE,
// BTC_ADDRESS, DST_ADDRESS, BOUND_ACCESS_TOKEN.
const apiBody: ApiCreateIntentBody = {
  srcChainKey: ChainKeys.BITCOIN_MAINNET,
  dstChainKey: process.env.DST_CHAIN ?? '0x2105.base',
  inputToken: process.env.INPUT_TOKEN ?? '0:0', // native BTC (8 decimals)
  outputToken: process.env.OUTPUT_TOKEN ?? '0x0000000000000000000000000000000000000000',
  inputAmount: process.env.INPUT_AMOUNT ?? '550',
  minOutputAmount: process.env.MIN_OUTPUT_AMOUNT ?? '196729826014250',
  deadline: process.env.DEADLINE ?? String(Math.floor(Date.now() / 1000) + 600),
  allowPartialFill: false,
  srcAddress: process.env.BTC_ADDRESS ?? 'bc1pax7wcjw4r7m25fn2405x5a5f6vucv8pcqr8ltsz2mp4xjmx26rgstqgwhz',
  dstAddress: process.env.DST_ADDRESS ?? '0x1468d3529032106291433B7e9e3026dF1Ff78F31',
  accessToken: process.env.BOUND_ACCESS_TOKEN,
};

// Stringify replacer so bigint fields (intent, error context) don't throw in console output.
const bigintSafe = (_key: string, value: unknown): unknown => (typeof value === 'bigint' ? value.toString() : value);

// Truncate long hex / base64 / addresses for readable logs (set VERBOSE=1 to print full values).
const short = (s: string, head = 16, tail = 8): string =>
  process.env.VERBOSE === '1' || s.length <= head + tail + 1
    ? s
    : `${s.slice(0, head)}…${s.slice(-tail)} (${s.length} chars)`;

// Map the wire body (CreateIntentParamsV2 — flat string fields, incl. accessToken) to the SDK swap
// action input: typed `params` (bigint numerics, `data` → '0x') plus the per-action `extras` slot.
// This is the split BE does — one flat HTTP body becomes `params` + `extras`. The Bitcoin key narrows
// K so `extras.accessToken` is typeable (it's `never` off Bitcoin).
function toCreateIntentInput(body: ApiCreateIntentBody) {
  const params = {
    srcChainKey: body.srcChainKey as BitcoinKey,
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
  } satisfies CreateIntentParams<BitcoinKey>;
  return { params, extras: { accessToken: body.accessToken } };
}

// Log every Bound Exchange / UMS HTTP call the SDK makes — method, URL, auth + origin, request body,
// and the response status + body — so the raw flow is debuggable end to end. Bearer tokens are masked.
//
// Bound's edge gateway returns an HTML "403 Forbidden" to server-to-server requests that lack browser
// headers. Set BOUND_ORIGIN (e.g. a whitelisted dapp origin) to spoof Origin/Referer/User-Agent/
// Sec-Fetch and test whether the 403 is purely header/origin-gated (disappears) vs an IP/fingerprint
// block a server can't fake (persists). The SDK itself sends none of these — diagnostic only.
function installBoundRequestLogger(): void {
  const realFetch = globalThis.fetch;
  const spoofOrigin = process.env.BOUND_ORIGIN;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const isBound = url.includes('bound.exchange');
    if (isBound && spoofOrigin) {
      init = {
        ...init,
        headers: {
          ...(init?.headers as Record<string, string> | undefined),
          Origin: spoofOrigin,
          Referer: `${spoofOrigin}/`,
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'application/json, text/plain, */*',
          'Sec-Fetch-Site': 'cross-site',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Dest': 'empty',
        },
      };
    }
    if (isBound) {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const auth = headers.Authorization ?? headers.authorization;
      console.log('\n── Bound API request ──');
      console.log('  →', init?.method ?? 'GET', url);
      console.log('  Origin       :', spoofOrigin ?? '(none — default Node request, what a BE server sends)');
      console.log('  Authorization:', auth ? `Bearer <${auth.replace(/^Bearer\s*/i, '').length} chars>` : '(none)');
      if (typeof init?.body === 'string') console.log('  body:', init.body);
    }
    const res = await realFetch(input, init);
    if (isBound) {
      const text = await res.clone().text();
      console.log('  ←', res.status, res.ok ? 'OK' : 'FAIL', '·', text.length > 400 ? `${text.slice(0, 400)}…` : text);
      console.log('───────────────────────');
    }
    return res;
  };
}

async function main(): Promise<void> {
  installBoundRequestLogger();
  const sodax = new Sodax();

  console.log('\n━━ Bitcoin raw createIntent ━━');
  console.log('  src        :', `${apiBody.srcChainKey}  ${apiBody.inputToken}  ${apiBody.inputAmount} sat`);
  console.log('  dst        :', `${apiBody.dstChainKey}  ${short(apiBody.outputToken)}`);
  console.log('  srcAddress :', short(apiBody.srcAddress));
  console.log('  dstAddress :', short(apiBody.dstAddress));
  console.log(
    '  accessToken:',
    apiBody.accessToken ? `present (${apiBody.accessToken.length} chars)` : '(none — expect a legible auth/HTTP error)',
  );
  console.log('  origin     :', process.env.BOUND_ORIGIN ?? '(none — default Node request)');
  console.log('\n→ createIntent({ params, extras: { accessToken }, raw: true })');

  const result = await sodax.swaps.createIntent({ ...toCreateIntentInput(apiBody), raw: true });

  if (result.ok) {
    const { tx, intent, relayData } = result.value;
    const t = tx as { from?: string; to?: string; value?: bigint; data?: string };
    console.log('\n✅ Raw intent built — BE returns this for the client to sign + co-sign via Bound.');
    console.log('  tx.from   :', short(t.from ?? ''));
    console.log('  tx.to     :', short(t.to ?? ''));
    console.log('  tx.value  :', `${t.value ?? 0n} sat`);
    console.log('  tx.psbt   :', short(t.data ?? '', 24, 8));
    console.log('  relay.addr:', short(relayData.address));
    console.log('  relay.data:', short(relayData.payload, 24, 8));
    console.log('  intentId  :', short(intent.intentId.toString(), 12, 6));
    console.log('  feeAmount :', `${(intent as { feeAmount?: bigint }).feeAmount ?? 0n}`);
    if (process.env.VERBOSE === '1') console.log('  intent    :', JSON.stringify(intent, bigintSafe, 2));
    return;
  }

  const err = result.error;
  const cause = err.cause as { status?: number; message?: string } | undefined;
  console.error('\n❌ createIntent failed:');
  console.error('  code   :', err.code);
  console.error('  feature:', err.feature);
  console.error('  message:', err.message);
  console.error('  cause  :', cause?.status ? `HTTP ${cause.status} — ${cause.message ?? ''}` : err.cause);
}

main().catch(error => {
  console.error('Uncaught error:', error);
  process.exit(1);
});
