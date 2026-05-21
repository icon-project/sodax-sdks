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
 *
 * No external network is touched; constructors run with empty configs.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distRoot = join(__dirname, '..', 'dist');

let failed = false;
const ok = (msg) => console.log('OK:', msg);
const fail = (msg) => {
  console.error('FAIL:', msg);
  failed = true;
};

// 1. stacks/core — bundled @stacks/transactions + @stacks/network ────
console.log('=== stacks/core ===');
const core = await import(`${distRoot}/stacks/core/index.mjs`);
if (typeof core.Cl === 'object' && core.Cl !== null) ok('Cl namespace exported');
else fail(`Cl=${typeof core.Cl}`);
if (typeof core.serializeCV === 'function') ok('serializeCV is a function');
else fail(`serializeCV=${typeof core.serializeCV}`);
if (typeof core.makeUnsignedContractCall === 'function') ok('makeUnsignedContractCall is a function');
else fail(`makeUnsignedContractCall=${typeof core.makeUnsignedContractCall}`);
if (typeof core.createNetwork === 'function') ok('createNetwork is a function');
else fail(`createNetwork=${typeof core.createNetwork}`);

// 2. stacks/connect — bundled @stacks/connect + stubbed @stacks/connect-ui
console.log('\n=== stacks/connect ===');
const connect = await import(`${distRoot}/stacks/connect/index.mjs`);
if (typeof connect.request === 'function') ok('request is a function');
else fail(`request=${typeof connect.request}`);
if (typeof connect.disconnect === 'function') ok('disconnect is a function');
else fail(`disconnect=${typeof connect.disconnect}`);

// 3. injective/wallet-strategy — bundled + 5 hardware-wallet stubs ────
console.log('\n=== injective/wallet-strategy ===');
const inj = await import(`${distRoot}/injective/wallet-strategy/index.mjs`);
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

if (failed) {
  console.error('\nverify-runtime-smoke: FAILED');
  process.exit(1);
}
console.log('\nverify-runtime-smoke: OK (3 subpaths load + runtime exports verified)');
