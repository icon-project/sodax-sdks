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

async function main(): Promise<void> {
  const sodax = new Sodax();

  console.log(
    apiBody.accessToken
      ? '• Bound access token passed via extras — expecting the raw PSBT to build.'
      : '• No BOUND_ACCESS_TOKEN set — expecting a legible auth/HTTP error.',
  );
  console.log('\n→ Building raw intent as BE does: createIntent({ params, extras: { accessToken }, raw: true })\n');

  const result = await sodax.swaps.createIntent({ ...toCreateIntentInput(apiBody), raw: true });

  if (result.ok) {
    const { tx, intent, relayData } = result.value;
    console.log('✅ raw data built — this is what BE returns to the client to sign + co-sign via Bound.');
    console.log('  tx (unsigned PSBT base64):', tx);
    console.log('  relayData                :', relayData);
    console.log('  intent                   :', JSON.stringify(intent, bigintSafe, 2));
    return;
  }

  const err = result.error;
  console.error('❌ createIntent failed — and the reason is legible:');
  console.error('  code   :', err.code);
  console.error('  feature:', err.feature);
  console.error('  message:', err.message);
  console.error('  cause  :', err.cause);
}

main().catch(error => {
  console.error('Uncaught error:', error);
  process.exit(1);
});
