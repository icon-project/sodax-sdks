// Renders every table in the report from ../results/*.json, so no figure in the report is hand-typed.
import { readFileSync } from 'node:fs';
import { RESULTS } from './lib.mjs';

const j = f => JSON.parse(readFileSync(`${RESULTS}/${f}.json`, 'utf8'));
const kb = n => (n / 1024).toFixed(1);
const pct = (a, b) => `${(((a - b) / b) * 100).toFixed(0)}%`;
const base = j('baseline');
const scen = j('scenarios');
const l3 = j('l3');
const marg = j('marginal');
const alts = j('libalts');
const dupes = j('dupes');
const cfg = j('config-split');
const row = name => base.find(r => r.name === name);
const L0 = row('dist: new Sodax()');
const out = [];
const p = s => out.push(s);

p('## T1 — Import shapes: published flat dist vs module graph (KB)');
p('| Import | dist min | dist gzip | dist brotli | module-graph gzip | module-graph brotli |');
p('|---|--:|--:|--:|--:|--:|');
for (const r of base.filter(x => x.name.startsWith('dist: '))) {
  const s = row(r.name.replace('dist: ', 'src: '));
  p(`| \`${r.name.slice(6)}\` | ${kb(r.min)} | ${kb(r.gz)} | ${kb(r.br)} | ${kb(s.gz)} | ${kb(s.br)} |`);
}
const d = row('src: new Sodax(), @sodax/types deduped');
const s0 = row('src: new Sodax()');
p(
  `\n@sodax/types inlined into swaps-api + bridge-api: ${kb(s0.min - d.min)} KB min, ${kb(s0.gz - d.gz)} KB gzip, ${kb(s0.br - d.br)} KB brotli.`,
);

p('\n## T2 — Where the bytes go today (`new Sodax()`, minified KB, top 30)');
p('| Bucket | min KB | share |\n|---|--:|--:|');
for (const [b, n] of Object.entries(s0.topBuckets).slice(0, 30))
  p(`| \`${b}\` | ${kb(n)} | ${((100 * n) / s0.min).toFixed(1)}% |`);

p('\n## T3 — Consumer profiles (gzip KB, brotli in parentheses)');
p('| Profile | Today | L1 pluggable only | L2 leak-free | L3 + lighter libs | L3 vs today (gz / br) |');
p('|---|--:|--:|--:|--:|--:|');
for (const r of scen) {
  const x = l3.rows.find(y => y.profile === r.profile).l3;
  p(
    `| ${r.profile} | ${kb(L0.gz)} (${kb(L0.br)}) | ${kb(r.l1.gz)} (${kb(r.l1.br)}) | ${kb(r.l2.gz)} (${kb(r.l2.br)}) | ${kb(x.gz)} (${kb(x.br)}) | ${pct(x.gz, L0.gz)} / ${pct(x.br, L0.br)} |`,
  );
}
p('\n## T4 — Consumer profiles (minified KB)');
p('| Profile | Today | L1 | L2 | L3 |\n|---|--:|--:|--:|--:|');
for (const r of scen) {
  const x = l3.rows.find(y => y.profile === r.profile).l3;
  p(`| ${r.profile} | ${kb(L0.min)} | ${kb(r.l1.min)} | ${kb(r.l2.min)} | ${kb(x.min)} |`);
}

p('\n## T5 — Chain provider marginal cost on top of "Swaps, EVM only" (gzip KB, brotli in parentheses)');
p('| Chain | L2 added alone | L2 removed from full | L3 added alone | Largest contributors at L2 (min KB) |');
p('|---|--:|--:|--:|---|');
for (const [c, v] of Object.entries(marg.chains)) {
  const w = l3.chains[c];
  p(
    `| ${c} | ${kb(v.standalone.gz)} (${kb(v.standalone.br)}) | ${kb(v.removeFromFull.gz)} | ${kb(w.gz)} (${kb(w.br)}) | ${v.top.replace(/ /g, ', ')} |`,
  );
}

p('\n## T6 — Feature provider marginal cost on top of core (L2)');
p('| Feature | +min KB | +gzip KB | +brotli KB | Largest contributors (min KB) |\n|---|--:|--:|--:|---|');
for (const [f, v] of Object.entries(marg.features)) {
  p(
    `| ${f}${v.needs.length ? ` (on ${v.needs.join('+')})` : ''} | ${kb(v.min)} | ${kb(v.gz)} | ${kb(v.br)} | ${v.top.replace(/ /g, ', ')} |`,
  );
}
p(`| dex at L3 (vendored port) | ${kb(l3.dex.min)} | ${kb(l3.dex.gz)} | ${kb(l3.dex.br)} | |`);

p('\n## T7 — Chain library surface: today vs alternatives (standalone bundles, KB)');
p('| Chain | Variant | min | gzip | brotli |\n|---|---|--:|--:|--:|');
for (const r of alts) p(`| ${r.chain} | ${r.label} | ${kb(r.min)} | ${kb(r.gz)} | ${kb(r.br)} |`);

p('\n## T8 — Packages bundled in more than one version (full bundle, minified KB)');
p('| Package | Versions (KB) | Extra copies KB |\n|---|---|--:|');
for (const r of dupes.rows.sort((a, b) => b.extraCopiesBytes - a.extraCopiesBytes)) {
  p(
    `| ${r.name} | ${Object.entries(r.versions)
      .map(([v, b]) => `${v}: ${kb(b)}`)
      .join(', ')} | ${kb(r.extraCopiesBytes)} |`,
  );
}
p(`\nTotal in non-primary copies: ${kb(dupes.totalExtraBytes)} KB minified.`);

p('\n## T9 — Token config: per-chain split potential (KB)');
p('| Slice | min | gzip | brotli |\n|---|--:|--:|--:|');
for (const r of cfg) p(`| ${r.label} | ${kb(r.min)} | ${kb(r.gz)} | ${kb(r.br)} |`);

p('\n## T10 — Library levers: saving where the chain / feature is included (L2 cost − L3 cost, KB)');
p('| Lever | min | gzip | brotli |\n|---|--:|--:|--:|');
const lever = (label, a, b) => p(`| ${label} | ${kb(a.min - b.min)} | ${kb(a.gz - b.gz)} | ${kb(a.br - b.br)} |`);
// Chains with no modelled replacement (Sui, Stacks) show no difference and are left out.
for (const c of Object.keys(l3.chains))
  if (marg.chains[c].standalone.gz - l3.chains[c].gz > 1024) lever(c, marg.chains[c].standalone, l3.chains[c]);
lever('dex (feature)', marg.features.dex, l3.dex);
lever('@sodax/types deduped (full bundle)', s0, d);

console.log(out.join('\n'));
