// Baseline: what a browser consumer pays today (published flat dist) vs the same imports from the
// SDK's module graph (what per-module ESM output would give), plus the @sodax/types duplication cost.
import { bundle, kb, SDK, saveResult, topBuckets } from './lib.mjs';
import { DEDUPE_TYPES, ENTRY } from './scenarios.mjs';

const DIST = `${SDK}/dist/index.mjs`;
const shapes = [
  ['new Sodax()', 'import { Sodax } from "X"; export const s = new Sodax();'],
  ['isSodaxError only', 'export { isSodaxError } from "X";'],
  ['encodeAddress only', 'export { encodeAddress } from "X";'],
  ['SpokeService only', 'export { SpokeService } from "X";'],
  ['sodaxConfig only', 'export { sodaxConfig } from "X";'],
];
const cases = [
  ...shapes.map(([n, c]) => ({ name: `dist: ${n}`, contents: c.replace('"X"', `'${DIST}'`) })),
  ...shapes.map(([n, c]) => ({ name: `src: ${n}`, contents: c.replace('"X"', "'./src/index.ts'") })),
  { name: 'src: new Sodax(), @sodax/types deduped', contents: ENTRY, aliases: DEDUPE_TYPES },
];
const rows = [];
for (const c of cases) {
  const r = await bundle(c);
  rows.push({ name: r.name, min: r.min, gz: r.gz, br: r.br, topBuckets: topBuckets(r.byBucket, 45) });
  console.log(
    `${r.name.padEnd(42)} min ${kb(r.min).padStart(8)} KB  gz ${kb(r.gz).padStart(7)} KB  br ${kb(r.br).padStart(7)} KB`,
  );
}
saveResult('baseline', rows);
