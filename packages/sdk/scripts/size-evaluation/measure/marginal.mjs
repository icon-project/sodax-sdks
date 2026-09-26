// Marginal cost of each chain provider and each feature provider under the L2 (leak-free) model.
import { kb, saveResult } from './lib.mjs';
import { ALL_CHAINS, ALL_FEATURES, project } from './scenarios.mjs';

const delta = (a, b) => ({ min: a.min - b.min, gz: a.gz - b.gz, br: a.br - b.br });
const topDelta = (a, b) =>
  Object.entries(a.byBucket)
    .map(([k, v]) => [k, v - (b.byBucket[k] ?? 0)])
    .filter(([, d]) => d > 2048)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 8)
    .map(([k, d]) => `${k}=${kb(d)}`)
    .join(' ');

const out = { chains: {}, features: {} };
const swapEvm = await project({ name: 'swapEvm', chains: [], features: ['swaps'], level: 2 });
const full = await project({ name: 'full', chains: ALL_CHAINS, features: ALL_FEATURES, level: 2 });
for (const c of ALL_CHAINS) {
  const withC = await project({ name: c, chains: [c], features: ['swaps'], level: 2 });
  const without = await project({
    name: `-${c}`,
    chains: ALL_CHAINS.filter(x => x !== c),
    features: ALL_FEATURES,
    level: 2,
  });
  out.chains[c] = {
    standalone: delta(withC, swapEvm),
    removeFromFull: delta(full, without),
    top: topDelta(withC, swapEvm),
  };
  console.log(
    `chain ${c.padEnd(10)} +standalone gz ${kb(out.chains[c].standalone.gz).padStart(6)} | -fromFull gz ${kb(out.chains[c].removeFromFull.gz).padStart(6)} | ${out.chains[c].top}`,
  );
}
const core = await project({ name: 'core', chains: [], features: [], level: 2 });
for (const f of ALL_FEATURES) {
  const needs = f === 'sponsoring' ? ['stellar'] : f === 'migration' ? ['icon', 'stellar'] : [];
  const base = needs.length ? await project({ name: 'base', chains: needs, features: [], level: 2 }) : core;
  const withF = await project({ name: f, chains: needs, features: [f], level: 2 });
  out.features[f] = { needs, ...delta(withF, base), top: topDelta(withF, base) };
  console.log(`feature ${f.padEnd(14)} +gz ${kb(out.features[f].gz).padStart(6)} | ${out.features[f].top}`);
}
saveResult('marginal', out);
