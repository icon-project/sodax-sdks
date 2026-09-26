// Upper bound for per-chain config splitting: re-emit every token map as a plain literal module (what a
// per-chain generated module would contain), then measure the EVM-only slice vs each non-EVM chain's map.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bundle, kb, REPO, saveResult } from './lib.mjs';

const TOKENS = `${REPO}/packages/types/dist/chains/tokens.js`;
const mod = await import(TOKENS);
const literal = path.join(mkdtempSync(path.join(tmpdir(), 'sodax-size-')), 'tokens-literal.js');
writeFileSync(
  literal,
  Object.entries(mod)
    .filter(([, v]) => typeof v !== 'function')
    .map(([k, v]) => `export const ${k} = ${JSON.stringify(v)};`)
    .join('\n'),
);
const NON_EVM = ['solana', 'injective', 'bitcoin', 'stellar', 'sui', 'icon', 'near', 'stacks'];
const evm = Object.keys(mod).filter(
  k => k.endsWith('SupportedTokens') && !NON_EVM.some(c => k === `${c}SupportedTokens`),
);
const cases = [
  ['published tokens.js: one chain map (solanaSupportedTokens)', `export { solanaSupportedTokens } from '${TOKENS}';`],
  ['published tokens.js: supportedTokensByChain', `export { supportedTokensByChain } from '${TOKENS}';`],
  [
    'literal: hub SodaTokens + EVM chain maps',
    `export { SodaTokens, LsodaTokens, ${evm.join(',')} } from '${literal}';`,
  ],
  ...NON_EVM.map(c => [`literal: ${c} map alone`, `export { ${c}SupportedTokens } from '${literal}';`]),
];
const rows = [];
for (const [label, contents] of cases) {
  const r = await bundle({ name: label, contents });
  rows.push({ label, min: r.min, gz: r.gz, br: r.br });
  console.log(`${label.padEnd(62)} min ${kb(r.min).padStart(6)} gz ${kb(r.gz).padStart(5)} br ${kb(r.br).padStart(5)}`);
}
saveResult('config-split', rows);
