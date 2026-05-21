// SDK → @sodax/libs integration smoke on Node.
//
// Exercises the sdk-level Stacks API that consumes `@sodax/libs/stacks/core`
// internally:
//   1. Sync encode via `encodeAddress` / `serializeAddressData` — verifies
//      the bundled `serializeCV` / `Cl.principal` chain.
//   2. `StacksSpokeService.sendMessage({ raw: true })` returns a
//      single-`0x`-prefixed payload (regression for the double-prefix bug
//      fixed in 6ebc71fd).
//
// Libs subpath surface (load + named exports + class shape across all three
// subpaths) is covered separately by
// `packages/libs/scripts/verify-runtime-smoke.mjs`, which runs as part of
// the libs build chain.
//
// Run: `pnpm --filter node test-stacks` (no env / wallet required).

import { encodeAddress, serializeAddressData, Sodax } from '@sodax/sdk';
import { ChainKeys } from '@sodax/types';

let failed = false;
const ok = (msg: string) => console.log('OK:', msg);
const fail = (msg: string) => {
  console.error('FAIL:', msg);
  failed = true;
};

// 1. Sync encode ──────────────────────────────────────────────────────
console.log('=== sdk sync encode ===');

{
  const addr = 'SP1D5PA98M0PF9Z4Q4N2CDTMTD7XSZ6GE7QQG5XBX';
  const expected = '0x05165a5b2928a02cf4fc972544c6ea9a69fb9f9a0e3d';
  const enc = encodeAddress(ChainKeys.STACKS_MAINNET, addr);
  const ser = serializeAddressData(addr);
  if (enc === expected && ser === expected) ok(`standard principal: ${enc}`);
  else fail(`standard principal mismatch: enc=${enc} ser=${ser}`);
}

{
  const addr = 'SP3031RGK734636C8KGW2Y76TEQBTVX59Q472EQH0.asset-manager-impl';
  const expected =
    '0x0616c030e21338c86199889c382f1cda75d7adf4a9b91261737365742d6d616e616765722d696d706c';
  const enc = encodeAddress(ChainKeys.STACKS_MAINNET, addr);
  if (enc === expected) ok(`contract principal: ${enc.slice(0, 40)}...`);
  else fail(`contract principal mismatch: ${enc}`);
}

{
  const addr = 'SP000000000000000000002Q6VF78';
  const expected = '0x05160000000000000000000000000000000000000000';
  const enc = encodeAddress(ChainKeys.STACKS_MAINNET, addr);
  if (enc === expected) ok(`zero principal: ${enc}`);
  else fail(`zero principal mismatch: ${enc}`);
}

// 2. Raw spoke payload hex format ─────────────────────────────────────
console.log('\n=== StacksSpokeService.sendMessage({ raw: true }) ===');

const sodax = new Sodax();
const stacksSpoke = sodax.spoke.getSpokeService(ChainKeys.STACKS_MAINNET);

// Any valid 33-byte compressed secp256k1 public key — used only for unsigned-tx
// auth field construction, never broadcast.
const STACKS_TEST_PUBKEY = '02b8d2c9fe1aa1f29e9c80c6e0b6cdf2cf6b9fbb47d9b86c83a8b69a3e74e4f8e8';

const sendMsgResult = await stacksSpoke.sendMessage({
  raw: true,
  srcAddress: STACKS_TEST_PUBKEY,
  srcChainKey: ChainKeys.STACKS_MAINNET,
  dstChainKey: ChainKeys.SONIC_MAINNET,
  dstAddress: `0x${'00'.repeat(20)}`,
  payload: `0x${'00'.repeat(32)}`,
});

const payload = (sendMsgResult as { payload: string }).payload;
if (typeof payload === 'string' && /^0x[0-9a-f]+$/i.test(payload) && !payload.startsWith('0x0x')) {
  ok(`payload: ${payload.slice(0, 24)}... (single-0x prefix)`);
} else {
  fail(`payload not single-0x: ${payload}`);
}

if (failed) {
  console.error('\ntest-stacks: FAILED');
  process.exit(1);
}
console.log('\ntest-stacks: all checks passed');
