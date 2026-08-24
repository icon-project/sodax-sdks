#!/usr/bin/env node
// Assert every src/**/*.test.ts file is part of the tsc program, so `checkTs` keeps
// typechecking tests (issue #378). Without this, re-adding a `**/*.test.ts` exclude to
// tsconfig.json would silently shrink coverage while checkTs stays green — the exact
// regression this guard exists to make loud. Runs as the second half of `checkTs`;
// `tsc --showConfig` only resolves the file list (no typecheck), so it costs ~1s.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = spawnSync('tsc', ['--showConfig'], { encoding: 'utf8' });
if (out.status !== 0) {
  console.error(out.stderr || out.stdout);
  process.exit(out.status ?? 1);
}

let files;
try {
  files = JSON.parse(out.stdout).files ?? [];
} catch (e) {
  console.error(`check-tests-typechecked: malformed tsc --showConfig output (${e.message})`);
  process.exit(1);
}
const inProgram = new Set(files.map(f => path.normalize(f.replace(/^\.\//, ''))));

const testFiles = [];
const walk = dir => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith('.test.ts')) testFiles.push(p);
  }
};
walk('src');

const missing = testFiles.filter(f => !inProgram.has(path.normalize(f)));
if (missing.length > 0) {
  console.error(
    `check-tests-typechecked: ${missing.length} test file(s) are excluded from the tsc program, so checkTs no longer typechecks them:`,
  );
  for (const f of missing) console.error(`  - ${f}`);
  console.error('Remove the tsconfig exclude (or include change) that hides them.');
  process.exit(1);
}
console.log(`check-tests-typechecked: all ${testFiles.length} test files are in the tsc program`);
