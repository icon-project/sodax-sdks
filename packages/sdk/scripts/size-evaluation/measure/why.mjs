// Prints the shortest import chain from the entry to each target package in a projected bundle.
// usage: node why.mjs <level 1|2> <chains csv|-> <features csv|-> <pkg> [pkg...]
import { bundle } from './lib.mjs';
import { ENTRY, stubsFor } from './scenarios.mjs';

const [level, chainsArg, featuresArg, ...targets] = process.argv.slice(2);
const list = a => (a === '-' ? [] : a.split(','));
const r = await bundle({
  name: 'why',
  contents: ENTRY,
  ...(await stubsFor({ chains: list(chainsArg), features: list(featuresArg), level: Number(level) })),
});
const entryKey = Object.keys(r.graph).find(k => k.endsWith('why.ts'));
const live = p => (r.inputs[p]?.bytesInOutput ?? 0) > 0;
for (const t of targets) {
  const prev = new Map([[entryKey, null]]);
  const queue = [entryKey];
  let hit = null;
  while (queue.length && !hit) {
    const cur = queue.shift();
    for (const imp of r.graph[cur]?.imports ?? []) {
      if (!imp.path || prev.has(imp.path) || !r.graph[imp.path]) continue;
      prev.set(imp.path, cur);
      if (imp.path.includes(`/node_modules/${t}/`) && live(imp.path)) {
        hit = imp.path;
        break;
      }
      queue.push(imp.path);
    }
  }
  const chain = [];
  for (let p = hit; p; p = prev.get(p))
    chain.unshift(p.replace(/^.*node_modules\//, 'npm:').replace('packages/sdk/src/', ''));
  console.log(`\n${t}:\n  ${hit ? chain.join('\n   -> ') : '(not in bundle)'}`);
}
