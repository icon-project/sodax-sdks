#!/usr/bin/env node
/**
 * Verifies that workarounds isolated in @sodax/libs do not leak back into
 * consumer dists (#1070).
 *
 * After the libs refactor, only @sodax/libs/dist/** should contain the bundled
 * source of @stacks/transactions, @stacks/network, @stacks/connect, and
 * @injectivelabs/wallet-strategy. Downstream packages (sdk, wallet-sdk-core,
 * wallet-sdk-react) must consume them via ES import statements from
 * @sodax/libs/<subpath> — never re-bundle them inline.
 *
 * If a contributor accidentally re-adds `noExternal: ['@stacks/connect']` or
 * similar to a consumer tsup config, the bundled function bodies would start
 * appearing in consumer dists and this script fails the build.
 *
 * Run AFTER `pnpm build:packages` so the dists exist.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');

/**
 * Each marker is a string that only exists when the corresponding package is
 * bundled inline (i.e. its source code is present, not just an import of it).
 * Pick strings that are distinctive enough to avoid false positives from
 * consumer code — function declarations + internal string literals work well.
 */
const FORBIDDEN_INLINE_MARKERS = {
  '@stacks/transactions': [
    'function makeContractCall(',
    'function broadcastTransaction(',
    'function fetchCallReadOnlyFunction(',
  ],
  '@stacks/connect': [
    // Internal identifiers from @stacks/connect source — not referenced by
    // SODAX code. Note: RPC method names like "stx_callContract" are NOT safe
    // markers because consumers call `request({...}, 'stx_callContract', ...)`
    // at their own call sites.
    '"blockstack-session"',
    '"authenticationRequest"',
    '"connect-modal"',
  ],
  '@injectivelabs/wallet-strategy': [
    // Class declaration only present when the source is bundled.
    'class BaseWalletStrategy',
    'cachedTurnkeyStrategy',
  ],
};

// Walk each consumer's whole dist so code-split entries (xchains/*) aren't missed.
const CONSUMER_DIST_ROOTS = [
  'packages/sdk/dist',
  'packages/wallet-sdk-core/dist',
  'packages/wallet-sdk-react/dist',
];

function walkJs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walkJs(p));
    else if (/\.(mjs|cjs)$/.test(name)) out.push(p);
  }
  return out;
}

let failed = false;
const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  failed = true;
};

let checked = 0;
for (const distRoot of CONSUMER_DIST_ROOTS) {
  const absRoot = join(repoRoot, distRoot);
  if (!existsSync(absRoot)) {
    // Skip missing dists silently — they may not be built yet when running
    // this script standalone. CI should run after pnpm build:packages.
    continue;
  }
  for (const absPath of walkJs(absRoot)) {
    checked++;
    const src = readFileSync(absPath, 'utf8');
    const relPath = relative(repoRoot, absPath);

    for (const [pkg, markers] of Object.entries(FORBIDDEN_INLINE_MARKERS)) {
      const leaked = markers.filter((m) => src.includes(m));
      if (leaked.length > 0) {
        fail(`${relPath}: ${pkg} appears to be bundled inline (found: ${leaked.join(', ')})`);
      }
    }
  }
}

if (checked === 0) {
  console.error('verify-no-duplicate-bundling: no consumer dists found — run `pnpm build:packages` first');
  process.exit(1);
}

if (failed) {
  console.error(
    '\nverify-no-duplicate-bundling: FAILED — a problem dep leaked back into a consumer dist.',
  );
  console.error(
    'Check that no consumer tsup.config.ts has the dep in `noExternal`. It should only be bundled in @sodax/libs.',
  );
  process.exit(1);
}

console.log(`verify-no-duplicate-bundling: OK (${checked} consumer dists checked)`);
