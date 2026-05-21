#!/usr/bin/env node
// Print the current packed size, and (if a baseline + tolerance are set) fail when
// the packed size exceeds `baseline * (1 + tolerance%)`.
//
// Wire from CI:
//   env:
//     SODAX_SDK_TARBALL_BASELINE_BYTES: "<bytes>"   # set after a known-good build
//     SODAX_SDK_TARBALL_TOLERANCE_PCT: "15"
//   run: pnpm --filter @sodax/sdk size:check
import { spawnSync } from 'node:child_process';

const BASELINE_BYTES = Number(process.env.SODAX_SDK_TARBALL_BASELINE_BYTES ?? 0);
const TOLERANCE_PCT = Number(process.env.SODAX_SDK_TARBALL_TOLERANCE_PCT ?? 15);

const out = spawnSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' });
if (out.status !== 0) {
  console.error(out.stderr);
  process.exit(out.status ?? 1);
}

let pkg;
try { [pkg] = JSON.parse(out.stdout); } catch (e) { console.error(`size-check: malformed npm pack output (${e.message}); raw: ${out.stdout.slice(0, 200)}…`); process.exit(1); }
const tarballKB = (pkg.size / 1024).toFixed(1);
const unpackedMB = (pkg.unpackedSize / 1024 / 1024).toFixed(2);

console.log(`tarball: ${tarballKB} KB (${pkg.size} B) | unpacked: ${unpackedMB} MB | files: ${pkg.entryCount}`);

if (!BASELINE_BYTES) {
  console.warn('size-check: SODAX_SDK_TARBALL_BASELINE_BYTES unset; printing only');
  process.exit(0);
}

const allowed = BASELINE_BYTES * (1 + TOLERANCE_PCT / 100);
if (pkg.size > allowed) {
  console.error(
    `size-check FAILED: ${pkg.size} B > ${allowed.toFixed(0)} B (baseline ${BASELINE_BYTES} B + ${TOLERANCE_PCT}%)`,
  );
  process.exit(1);
}

console.log(`size-check OK: under baseline+${TOLERANCE_PCT}% (${allowed.toFixed(0)} B)`);
