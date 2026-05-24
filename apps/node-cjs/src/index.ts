/**
 * CommonJS reproduction for issue #939
 * https://github.com/icon-project/sodax-sdks/issues/939
 *
 * When @sodax/sdk is consumed from a CommonJS application,
 * Node.js throws ERR_PACKAGE_PATH_NOT_EXPORTED because near-api-js
 * is ESM-only and has no "require" export path.
 *
 * This app should be kept in order to reproduce and test cjs related issues.
 * IMPORTANT: Do not remove it unless you have a good reason to do so.
 */
import assert from 'node:assert/strict';
import { IconWalletProvider } from '@sodax/wallet-sdk-core';
import { ChainKeys, Sodax, encodeAddress, serializeAddressData, spokeChainConfig } from '@sodax/sdk';

console.log('Attempting to load @sodax/sdk in CommonJS...');

const sdk = new Sodax();
console.log('SDK loaded:', typeof sdk);
console.log('NEAR_MAINNET key:', ChainKeys.NEAR_MAINNET);
console.log('ICON_MAINNET key:', ChainKeys.ICON_MAINNET);

const iconWalletProvider = new IconWalletProvider({
  // Mock private key for ICON blockchain (testing only, do not use in production)
  privateKey: '0x11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff',
  rpcUrl: 'https://ctz.solidwallet.io/api/v3',
});
const iconChainConfig = spokeChainConfig[ChainKeys.ICON_MAINNET];

console.log('iconWalletProvider loaded:', typeof iconWalletProvider);
console.log('iconChainConfig loaded:', iconChainConfig.chain.name);

// Verify the sdk → @sodax/libs/stacks/core path resolves correctly under CJS.
// The libs bundle ships dual ESM (.mjs) + CJS (.cjs); ESM is exercised by
// `apps/node/test-libs` + `packages/libs/scripts/verify-runtime-smoke.mjs`,
// so this is the CJS side of that coverage — running `encodeAddress` /
// `serializeAddressData` here exercises bundled `Cl.principal` + `serializeCV`
// reached from a CJS consumer through the sdk barrel.
const stacksAddr = 'SP1D5PA98M0PF9Z4Q4N2CDTMTD7XSZ6GE7QQG5XBX';
const expectedHex = '0x05165a5b2928a02cf4fc972544c6ea9a69fb9f9a0e3d';
assert.strictEqual(
  encodeAddress(ChainKeys.STACKS_MAINNET, stacksAddr),
  expectedHex,
  'sdk → libs/stacks/core (CJS): encodeAddress regression',
);
assert.strictEqual(
  serializeAddressData(stacksAddr),
  expectedHex,
  'sdk → libs/stacks/core (CJS): serializeAddressData regression',
);
console.log('Stacks encode (CJS → libs/stacks/core):', expectedHex);
