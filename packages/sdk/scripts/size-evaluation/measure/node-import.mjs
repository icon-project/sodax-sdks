// Node consumers: cold import time, `new Sodax()` time and heap of the published dist (fresh process per run).
import { execFileSync } from 'node:child_process';
import { SDK, saveResult } from './lib.mjs';

const probe = `const t0 = performance.now(); const m = await import('${SDK}/dist/index.mjs'); const t1 = performance.now();
new m.Sodax(); const t2 = performance.now();
process.stdout.write(JSON.stringify({ importMs: t1 - t0, constructMs: t2 - t1, heapMB: process.memoryUsage().heapUsed / 1048576 }));`;
const runs = [];
for (let i = 0; i < 5; i++) {
  runs.push(
    JSON.parse(
      execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    ),
  );
}
const median = k => runs.map(r => r[k]).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
const res = {
  node: process.version,
  runs,
  median: { importMs: median('importMs'), constructMs: median('constructMs'), heapMB: median('heapMB') },
};
console.log(
  `dist import ${res.median.importMs.toFixed(0)} ms | new Sodax() ${res.median.constructMs.toFixed(0)} ms | heap ${res.median.heapMB.toFixed(0)} MB (median of ${runs.length}, ${res.node})`,
);
saveResult('node-import', res);
