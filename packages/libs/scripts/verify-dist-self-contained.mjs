#!/usr/bin/env node
/**
 * Verifies @sodax/libs/dist/** has no runtime imports/requires of the four
 * bundled deps. These deps are moved to `devDependencies` because tsup inlines
 * their source via `noExternal`; if anyone ever drops a dep from the noExternal
 * list without also restoring it to `dependencies`, consumer installs would
 * silently miss it at runtime.
 *
 * Run after tsup build, before publish.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distRoot = join(__dirname, '..', 'dist');

const BUNDLED_DEPS = [
  '@stacks/transactions',
  '@stacks/network',
  '@stacks/connect',
  '@injectivelabs/wallet-strategy',
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
let scanned = 0;

for (const file of walkJs(distRoot)) {
  scanned++;
  const src = readFileSync(file, 'utf8');
  for (const dep of BUNDLED_DEPS) {
    const escaped = dep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match `from '<dep>'`, `from '<dep>/sub'`, `require('<dep>')`, `import('<dep>')`.
    const re = new RegExp(
      `(?:from|require\\(|import\\()\\s*['"]${escaped}(?:/[^'"]*)?['"]`,
      'g',
    );
    if (re.test(src)) {
      console.error(`FAIL: ${file.replace(distRoot + '/', '')} references ${dep}`);
      failed = true;
    }
  }
}

if (scanned === 0) {
  console.error('verify-dist-self-contained: no dist files found — run `pnpm build` first');
  process.exit(1);
}

if (failed) {
  console.error(
    '\nverify-dist-self-contained: FAILED — dist still imports a bundled dep.\n' +
      'Either restore the dep to `dependencies`, or fix tsup.config.ts `noExternal` to bundle it.',
  );
  process.exit(1);
}

console.log(`verify-dist-self-contained: OK (${scanned} files scanned, all 4 bundled deps inlined)`);
