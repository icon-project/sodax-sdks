// Smoke test for SDK features powered by `@sodax/libs`. Imports only public
// SDK packages (sdk, wallet-sdk-core) — never `@sodax/libs` directly — so we
// catch the same regressions a real consumer would: if libs ships a broken
// dist, this script fails before anyone integrates it.
//
// Each section names the (consumer package → libs subpath) edge it covers.
//
// Run: `pnpm --filter node test-libs` (no env / wallet required; all calls
// build locally and never touch the network).

import { encodeAddress, reverseEncodeAddress, serializeAddressData, Sodax } from '@sodax/sdk';
import { PostConditionMode, StacksWalletProvider } from '@sodax/wallet-sdk-core';
import { ChainKeys } from '@sodax/types';

let failed = false;
const ok = (msg: string) => console.log('OK:', msg);
const fail = (msg: string) => {
  console.error('FAIL:', msg);
  failed = true;
};

// 1. @sodax/sdk → @sodax/libs/stacks/core (sync encode) ───────────────
// `encodeAddress('stacks', ...)` and `serializeAddressData` route through
// the bundled `Cl.principal` / `serializeCV` from libs.
console.log('=== 1. sdk → libs/stacks/core (sync encode) ===');
{
  const addr = 'SP1D5PA98M0PF9Z4Q4N2CDTMTD7XSZ6GE7QQG5XBX';
  const expected = '0x05165a5b2928a02cf4fc972544c6ea9a69fb9f9a0e3d';
  const enc = encodeAddress(ChainKeys.STACKS_MAINNET, addr);
  const ser = serializeAddressData(addr);
  if (enc === expected && ser === expected) ok(`encodeAddress + serializeAddressData: ${enc}`);
  else fail(`mismatch: enc=${enc} ser=${ser}`);
}

// 2. @sodax/sdk → @sodax/libs/stacks/core (raw payload) ───────────────
// `StacksSpokeService.sendMessage({ raw: true })` exercises the bundled
// `makeUnsignedContractCall` + `serializePayloadBytes`. Also regression-tests
// the double-`0x` prefix bug fixed in 6ebc71fd.
console.log('\n=== 2. sdk → libs/stacks/core (raw payload, regression for double-0x) ===');
{
  const sodax = new Sodax();
  const stacksSpoke = sodax.spoke.getSpokeService(ChainKeys.STACKS_MAINNET);

  // Any valid 33-byte compressed secp256k1 public key works — used only
  // for unsigned-tx auth field construction, never broadcast.
  const TEST_PUBKEY = '02b8d2c9fe1aa1f29e9c80c6e0b6cdf2cf6b9fbb47d9b86c83a8b69a3e74e4f8e8';

  const result = await stacksSpoke.sendMessage({
    raw: true,
    srcAddress: TEST_PUBKEY,
    srcChainKey: ChainKeys.STACKS_MAINNET,
    dstChainKey: ChainKeys.SONIC_MAINNET,
    dstAddress: `0x${'00'.repeat(20)}`,
    payload: `0x${'00'.repeat(32)}`,
  });

  const payload = (result as { payload: string }).payload;
  if (typeof payload === 'string' && /^0x[0-9a-f]+$/i.test(payload) && !payload.startsWith('0x0x')) {
    ok(`payload: ${payload.slice(0, 24)}... (single-0x prefix)`);
  } else {
    fail(`payload not single-0x: ${payload}`);
  }
}

// 3. @sodax/wallet-sdk-core → @sodax/libs/stacks/core (re-exported enum)
// `PostConditionMode` is re-exported from libs/stacks/core via wallet-sdk-core's
// `library-exports.ts`. A broken libs runtime would surface here as the wrong
// shape or missing values.
console.log('\n=== 3. wallet-sdk-core → libs/stacks/core (PostConditionMode enum) ===');
{
  if (PostConditionMode.Allow === 1 && PostConditionMode.Deny === 2) {
    ok(`PostConditionMode: Allow=${PostConditionMode.Allow} Deny=${PostConditionMode.Deny}`);
  } else {
    fail(`PostConditionMode shape: ${JSON.stringify(PostConditionMode)}`);
  }
}

// 4. @sodax/sdk → @sodax/libs/stacks/core (decode round-trip) ────────
// `reverseEncodeAddress` calls bundled `cvToString` + `deserializeCV` —
// the inverse path of section 1. Asserts encode → decode returns the
// original principal, catching a regression on either side of libs.
console.log('\n=== 4. sdk → libs/stacks/core (reverseEncodeAddress round-trip) ===');
{
  const addr = 'SP1D5PA98M0PF9Z4Q4N2CDTMTD7XSZ6GE7QQG5XBX';
  const enc = encodeAddress(ChainKeys.STACKS_MAINNET, addr);
  const dec = reverseEncodeAddress(ChainKeys.STACKS_MAINNET, enc);
  if (dec === addr) ok(`round-trip: ${dec}`);
  else fail(`round-trip mismatch: original=${addr} decoded=${dec}`);
}

// 5. @sodax/wallet-sdk-core → @sodax/libs/stacks/core (StacksWalletProvider)
// `StacksWalletProvider`'s constructor builds a network via libs's
// `networkFrom` and pins the private key. If libs's `@stacks/network` or
// `@stacks/transactions` chain doesn't load, instantiation throws.
console.log('\n=== 5. wallet-sdk-core → libs/stacks/core (StacksWalletProvider) ===');
{
  try {
    const provider = new StacksWalletProvider({
      privateKey: '0001020304050607080910111213141516171819202122232425262728293031',
      endpoint: 'https://api.mainnet.hiro.so',
    });
    if (provider) ok('StacksWalletProvider ctor runs');
    else fail('StacksWalletProvider ctor returned falsy');
  } catch (e) {
    fail(`StacksWalletProvider ctor threw: ${(e as Error).message}`);
  }
}

if (failed) {
  console.error('\ntest-libs: FAILED');
  process.exit(1);
}
console.log('\ntest-libs: all checks passed');
