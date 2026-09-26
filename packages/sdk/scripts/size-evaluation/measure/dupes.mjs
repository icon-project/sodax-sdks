// Packages present in more than one version inside the full `new Sodax()` bundle.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { bundle, kb, REPO, saveResult } from './lib.mjs';
import { ENTRY } from './scenarios.mjs';

const r = await bundle({ name: 'full', contents: ENTRY });
const byPkg = {};
for (const [p, { bytesInOutput }] of Object.entries(r.inputs)) {
  const abs = path.join(REPO, p);
  const i = abs.lastIndexOf('/node_modules/');
  if (i === -1 || !bytesInOutput) continue;
  const rest = abs.slice(i + 14).split('/');
  const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  const pj = path.join(abs.slice(0, i + 14) + name, 'package.json');
  const version = existsSync(pj) ? JSON.parse(readFileSync(pj, 'utf8')).version : '?';
  byPkg[name] ??= {};
  byPkg[name][version] = (byPkg[name][version] ?? 0) + bytesInOutput;
}
const rows = [];
for (const [name, versions] of Object.entries(byPkg)) {
  const vs = Object.entries(versions).sort((a, b) => b[1] - a[1]);
  if (vs.length < 2) continue;
  const extra = vs.slice(1).reduce((a, [, b]) => a + b, 0);
  rows.push({ name, versions: Object.fromEntries(vs), extraCopiesBytes: extra });
  console.log(
    `${name.padEnd(28)} ${vs.map(([v, b]) => `${v}=${kb(b)}KB`).join('  ')}   (extra copies ${kb(extra)} KB)`,
  );
}
const total = rows.reduce((a, x) => a + x.extraCopiesBytes, 0);
console.log(`\nminified bytes in non-primary copies of duplicated packages: ${kb(total)} KB`);
saveResult('dupes', { rows, totalExtraBytes: total });
