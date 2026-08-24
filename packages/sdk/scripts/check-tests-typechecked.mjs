#!/usr/bin/env node
// Test-typing guards — the second half of `checkTs` (issue #378). Two checks:
//
// 1. Every src/**/*.test.ts file must be part of the tsc program. Without this, re-adding a
//    `**/*.test.ts` exclude to tsconfig.json would silently shrink coverage while checkTs stays
//    green. `tsc --showConfig` only resolves the file list (no typecheck), so it costs ~1s.
//
// 2. Every `as unknown as` cast in a test file needs a one-line why-comment on the same line or
//    within the two lines above (a biome-ignore justification counts) — such a cast is the
//    strongest escape hatch the tests allow (see AGENTS.md § Build And Tests), so each one must
//    say why it is deliberate. Pre-existing undocumented casts are grandfathered per file in
//    test-cast-comment-baseline.json and may only ratchet down; `--update-baseline` regenerates it.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASELINE_PATH = new URL('./test-cast-comment-baseline.json', import.meta.url).pathname;
const update = process.argv.includes('--update-baseline');

const testFiles = [];
const walk = dir => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith('.test.ts')) testFiles.push(p);
  }
};
walk('src');

let failed = false;

// ── Check 1: all test files are in the tsc program ─────────────────────────────
if (!update) {
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
  const missing = testFiles.filter(f => !inProgram.has(path.normalize(f)));
  if (missing.length > 0) {
    failed = true;
    console.error(
      `check-tests-typechecked: ${missing.length} test file(s) are excluded from the tsc program, so checkTs no longer typechecks them:`,
    );
    for (const f of missing) console.error(`  - ${f}`);
    console.error('Remove the tsconfig exclude (or include change) that hides them.');
  } else {
    console.log(`check-tests-typechecked: all ${testFiles.length} test files are in the tsc program`);
  }
}

// ── Check 2: `as unknown as` casts carry a why-comment (baseline-ratcheted) ────
const isComment = l => {
  const t = l.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
};
const undocumented = new Map(); // file -> lines[]
for (const file of testFiles) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i].indexOf(' as unknown as ');
    if (at === -1) continue;
    const sameLine = lines[i].slice(at).includes('//');
    const above = lines.slice(Math.max(0, i - 2), i).some(isComment);
    if (!sameLine && !above) {
      if (!undocumented.has(file)) undocumented.set(file, []);
      undocumented.get(file).push(i + 1);
    }
  }
}

if (update) {
  const baseline = Object.fromEntries(
    [...undocumented.entries()].sort().map(([f, ls]) => [f, ls.length]),
  );
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`check-tests-typechecked: cast-comment baseline updated (${undocumented.size} files)`);
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
let shrinkable = 0;
for (const [file, lines] of [...undocumented.entries()].sort()) {
  const allowed = baseline[file] ?? 0;
  if (lines.length > allowed) {
    failed = true;
    console.error(
      `check-tests-typechecked: ${file} has ${lines.length} undocumented 'as unknown as' cast(s), baseline allows ${allowed} (lines: ${lines.join(', ')})`,
    );
    console.error(
      "  Add a one-line why-comment on or just above each new cast, or document an existing cast in the same file.",
    );
  } else if (lines.length < allowed) shrinkable++;
}
for (const file of Object.keys(baseline)) {
  if (!undocumented.has(file) && baseline[file] > 0) shrinkable++;
}
if (failed) process.exit(1);
if (shrinkable > 0) {
  console.log(
    `check-tests-typechecked: cast comments ok — ${shrinkable} file(s) are below baseline; shrink it with: node scripts/check-tests-typechecked.mjs --update-baseline`,
  );
} else {
  console.log('check-tests-typechecked: cast comments ok');
}
