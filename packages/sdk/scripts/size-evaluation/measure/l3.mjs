// L3 = L2 + lighter chain libraries: for each included chain whose library has a measured replacement,
// SDK code stops importing the current lib and the replacement surface (../alternatives) is bundled instead.
// DEX swaps the PancakeSwap SDKs for a vendored port; bignumber.js and rlp are replaced by bigint / viem.
import { ALTERNATIVES, bundle, ensureAbis, kb, saveResult } from './lib.mjs';
import {
  ALL_CHAINS,
  ALL_FEATURES,
  CHAINS,
  DEDUPE_TYPES,
  ENTRY,
  FEATURES,
  PROFILES,
  libs,
  vendoredAbiStub,
} from './scenarios.mjs';

const ALT = {
  solana: 'solana-kit.js',
  stellar: 'stellar-rpc-no-horizon.js',
  icon: 'icon-fetch.js',
  injective: 'inj-rest.js',
  near: 'near-fetch.js',
  bitcoin: 'btc-scure.js',
};
await ensureAbis();

export async function projectL3({ name, chains, features }) {
  const stubs = [];
  const specStubs = [await vendoredAbiStub(), ...libs('bignumber.js', 'rlp')];
  let entry = ENTRY;
  for (const c of ALL_CHAINS) {
    if (!chains.includes(c)) {
      stubs.push(...CHAINS[c].l1, ...CHAINS[c].l2Files);
      specStubs.push(...CHAINS[c].l2Libs);
    } else if (ALT[c]) {
      specStubs.push(...CHAINS[c].l2Libs);
      entry += `export * as ${c}Alt from '${ALTERNATIVES}/${ALT[c]}';\n`;
    }
  }
  for (const f of ALL_FEATURES) if (!features.includes(f)) stubs.push(...FEATURES[f].l1, ...FEATURES[f].l2);
  if (features.includes('dex')) {
    specStubs.push(...libs('@pancakeswap/swap-sdk-core', '@pancakeswap/infinity-sdk', '@pancakeswap/v3-sdk'));
    entry += `export * as dexAlt from '${ALTERNATIVES}/dex-vendored.js';\n`;
  }
  return bundle({ name, contents: entry, stubs, specStubs, aliases: DEDUPE_TYPES });
}

const pick = r => ({ min: r.min, gz: r.gz, br: r.br });
const delta = (a, b) => ({ min: a.min - b.min, gz: a.gz - b.gz, br: a.br - b.br });
const rows = [];
for (const [profile, chains, features] of PROFILES) {
  const r = await projectL3({ name: profile, chains, features });
  rows.push({ profile, l3: pick(r) });
  console.log(
    `${profile.padEnd(38)} L3 min ${kb(r.min).padStart(7)} gz ${kb(r.gz).padStart(7)} br ${kb(r.br).padStart(6)}`,
  );
}
const base = await projectL3({ name: 'swapEvm', chains: [], features: ['swaps'] });
const chainsOut = {};
for (const c of ALL_CHAINS) {
  chainsOut[c] = delta(await projectL3({ name: c, chains: [c], features: ['swaps'] }), base);
  console.log(
    `chain ${c.padEnd(10)} L3 +standalone gz ${kb(chainsOut[c].gz).padStart(6)} br ${kb(chainsOut[c].br).padStart(6)}`,
  );
}
const core = await projectL3({ name: 'core', chains: [], features: [] });
const dex = delta(await projectL3({ name: 'dex', chains: [], features: ['dex'] }), core);
console.log(`feature dex L3 +gz ${kb(dex.gz)} br ${kb(dex.br)}`);
saveResult('l3', { rows, chains: chainsOut, dex });
