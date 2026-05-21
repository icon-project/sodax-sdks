#!/usr/bin/env node
/**
 * Runtime smoke test for the three @sodax/libs subpaths. Runs after tsup
 * and the dist-self-contained check; confirms each subpath actually loads
 * cleanly under Node ESM and exposes the expected runtime surface.
 *
 * Catches:
 *  - Top-level execution errors in bundled deps (stubs misconfigured)
 *  - Missing named exports after an upstream package upgrade
 *  - Class identity loss from a misconfigured `splitting` setting
 *  - CJS dist regressions (every subpath also smoked via require)
 *
 * No external network is touched; constructors run with empty configs.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distRoot = join(__dirname, '..', 'dist');
const require = createRequire(import.meta.url);

let failed = false;
const ok = (msg) => console.log('OK:', msg);
const fail = (msg) => {
  console.error('FAIL:', msg);
  failed = true;
};

// Each subpath's expected named runtime surface. Mirrors the named exports
// declared in `src/<subpath>/index.ts`. Update both lists together when adding
// a new symbol to a subpath barrel.
const EXPECTED_EXPORTS = {
  'stacks/core': [
    'Cl',
    'serializeCV',
    'cvToString',
    'deserializeCV',
    'someCV',
    'uintCV',
    'noneCV',
    'parseContractId',
    'broadcastTransaction',
    'fetchCallReadOnlyFunction',
    'getAddressFromPrivateKey',
    'makeContractCall',
    'makeSTXTokenTransfer',
    'PostConditionMode',
    'makeUnsignedContractCall',
    'fetchFeeEstimateTransaction',
    'validateStacksAddress',
    'serializePayloadBytes',
    'privateKeyToPublic',
    'publicKeyToHex',
    'createNetwork',
    'networkFrom',
  ],
  'stacks/connect': ['request', 'disconnect'],
  'injective/wallet-strategy': ['WalletStrategy'],
};

function assertExportsPresent(subpath, mod) {
  for (const name of EXPECTED_EXPORTS[subpath]) {
    if (mod[name] === undefined) fail(`${subpath}: missing export ${name}`);
  }
  ok(`${subpath}: all ${EXPECTED_EXPORTS[subpath].length} expected exports present`);
}

// 1. stacks/core — bundled @stacks/transactions + @stacks/network ────
console.log('=== stacks/core (ESM) ===');
const core = await import(`${distRoot}/stacks/core/index.mjs`);
assertExportsPresent('stacks/core', core);
if (typeof core.Cl === 'object' && core.Cl !== null) ok('Cl is a namespace object');
else fail(`Cl=${typeof core.Cl}`);

// 2. stacks/connect — bundled @stacks/connect + stubbed @stacks/connect-ui
console.log('\n=== stacks/connect (ESM) ===');
const connect = await import(`${distRoot}/stacks/connect/index.mjs`);
assertExportsPresent('stacks/connect', connect);
if (typeof connect.request === 'function' && typeof connect.disconnect === 'function') {
  ok('request + disconnect are functions');
} else {
  fail(`shape: request=${typeof connect.request} disconnect=${typeof connect.disconnect}`);
}

// 3. injective/wallet-strategy — bundled + 5 hardware-wallet stubs ────
console.log('\n=== injective/wallet-strategy (ESM) ===');
const inj = await import(`${distRoot}/injective/wallet-strategy/index.mjs`);
assertExportsPresent('injective/wallet-strategy', inj);
if (typeof inj.WalletStrategy === 'function') ok('WalletStrategy is a class');
else fail(`WalletStrategy=${typeof inj.WalletStrategy}`);

try {
  // Hardware-wallet loaders are lazy so the 5 stubbed packages aren't reached
  // at construction. If any stub broke the top-level surface, this would throw.
  const ws = new inj.WalletStrategy({
    chainId: 'injective-1',
    strategies: {},
    evmOptions: { evmChainId: 1, rpcUrl: 'https://ethereum-rpc.publicnode.com' },
  });
  if (ws) ok('WalletStrategy constructor runs (hardware-wallet stubs harmless at ctor)');
  else fail('WalletStrategy ctor returned falsy');
} catch (e) {
  fail(`WalletStrategy ctor threw: ${e.message}`);
}

// 4. CJS dist parity ──────────────────────────────────────────────────
// `splitting: true` only applies to ESM; CJS keeps a flat per-entry layout.
// Verify each subpath's .cjs exists, is non-trivial in size, and loads
// cleanly via `require`. Catches regressions where ESM works but CJS
// silently breaks for CJS consumers (apps/node-cjs, server frameworks).
console.log('\n=== CJS dist parity ===');
for (const subpath of Object.keys(EXPECTED_EXPORTS)) {
  const cjsPath = `${distRoot}/${subpath}/index.cjs`;
  const stat = statSync(cjsPath, { throwIfNoEntry: false });
  if (!stat || stat.size < 100) {
    fail(`${subpath}/index.cjs missing or suspiciously small (${stat?.size ?? 'absent'})`);
    continue;
  }
  try {
    const mod = require(cjsPath);
    for (const name of EXPECTED_EXPORTS[subpath]) {
      if (mod[name] === undefined) {
        fail(`${subpath} (CJS): missing export ${name}`);
      }
    }
    ok(`${subpath}/index.cjs loads via require (${(stat.size / 1024).toFixed(0)} KB, exports verified)`);
  } catch (e) {
    fail(`${subpath}/index.cjs require failed: ${e.message}`);
  }
}

if (failed) {
  console.error('\nverify-runtime-smoke: FAILED');
  process.exit(1);
}
console.log('\nverify-runtime-smoke: OK (ESM + CJS subpath load + named exports verified)');
