// Projected bundle sizes for a modular SDK, modelled by stubbing modules out of the real source graph.
//
// L1 "pluggable providers": the facade/SpokeService no longer statically import unused feature services or
//    chain spoke services (only those entry files are removed; everything they share stays if still reachable).
// L2 "leak-free": L1 + chain-specific code that leaks into shared modules (address encoding, utils, entities)
//    moves into its chain provider, feature-only backend clients move into their feature, the swap solver
//    vendors the one PancakeSwap ABI it needs, and @sodax/types is no longer inlined into swaps-api /
//    bridge-api (one shared copy).
import { readFileSync } from 'node:fs';
import { bundle, ensureAbis, esc, kb, REPO, SRC, saveResult, topBuckets } from './lib.mjs';

const file = rel => new RegExp(`^${esc(`${SRC}/${rel}`)}$`);
const dir = rel => new RegExp(`^${esc(`${SRC}/${rel}/`)}`);
// Bare imports of `names` (and their subpaths) made from SDK-owned code only.
const SDK_IMPORTER = new RegExp(`^(${esc(SRC)}|${esc(`${REPO}/packages/types/`)})`);
export const libs = (...names) => names.map(n => ({ spec: new RegExp(`^${esc(n)}(/.*)?$`), importer: SDK_IMPORTER }));

// l1: spoke entry file SpokeService imports. l2Files: SDK-owned chain modules. l2Libs: chain libs imported by SDK code.
export const CHAINS = {
  solana: {
    l1: [file('shared/services/spoke/SolanaSpokeService.ts')],
    l2Files: [dir('shared/entities/solana')],
    l2Libs: libs('@solana/web3.js', '@solana/spl-token', '@coral-xyz/anchor'),
  },
  stellar: {
    l1: [file('shared/services/spoke/StellarSpokeService.ts')],
    l2Files: [dir('shared/entities/stellar')],
    l2Libs: libs('@stellar/stellar-sdk'),
  },
  sui: {
    l1: [file('shared/services/spoke/SuiSpokeService.ts')],
    l2Files: [file('shared/services/spoke/SuiGrpcTransport.ts'), file('shared/utils/sui-utils.ts')],
    l2Libs: libs('@mysten/sui'),
  },
  icon: {
    l1: [file('shared/services/spoke/IconSpokeService.ts')],
    l2Files: [dir('shared/entities/icon'), file('shared/utils/icon-utils.ts')],
    l2Libs: libs('icon-sdk-js'),
  },
  injective: {
    l1: [file('shared/services/spoke/InjectiveSpokeService.ts')],
    l2Files: [dir('shared/entities/injective')],
    l2Libs: libs('@injectivelabs/sdk-ts', '@injectivelabs/networks', 'cosmjs-types'),
  },
  near: { l1: [file('shared/services/spoke/NearSpokeService.ts')], l2Files: [], l2Libs: libs('near-api-js') },
  stacks: {
    l1: [file('shared/services/spoke/StacksSpokeService.ts')],
    l2Files: [file('shared/utils/stacks-utils.ts')],
    l2Libs: libs('@sodax/libs/stacks/core'),
  },
  bitcoin: {
    l1: [file('shared/services/spoke/BitcoinSpokeService.ts')],
    l2Files: [dir('shared/entities/btc')],
    l2Libs: libs('bitcoinjs-lib', '@bitcoinerlab/secp256k1'),
  },
};

// l1: the feature service file the facade imports. l2: that feature's backend API sub-client.
export const FEATURES = {
  swaps: { l1: [file('swap/SwapService.ts')], l2: [file('backendApi/SwapsApiService.ts')] },
  moneyMarket: { l1: [file('moneyMarket/MoneyMarketService.ts')], l2: [] },
  dex: { l1: [file('dex/DexService.ts')], l2: [] },
  migration: { l1: [file('migration/MigrationService.ts')], l2: [] },
  bridge: { l1: [file('bridge/BridgeService.ts')], l2: [file('backendApi/BridgeApiService.ts')] },
  staking: { l1: [file('staking/StakingService.ts')], l2: [] },
  partners: { l1: [file('partner/PartnerService.ts')], l2: [] },
  recovery: { l1: [file('recovery/RecoveryService.ts')], l2: [] },
  leverageYield: {
    l1: [file('leverageYield/LeverageYieldService.ts')],
    l2: [file('backendApi/LeverageYieldApiService.ts')],
  },
  sponsoring: { l1: [file('sponsoring/SponsoringService.ts')], l2: [file('backendApi/SponsoringApiService.ts')] },
};

export const ALL_CHAINS = Object.keys(CHAINS);
export const ALL_FEATURES = Object.keys(FEATURES);
export const DEDUPE_TYPES = {
  '@sodax/swaps-api': `${REPO}/packages/swaps-api/src/index.ts`,
  '@sodax/bridge-api': `${REPO}/packages/bridge-api/src/index.ts`,
};
export const ENTRY = `import { Sodax } from './src/index.ts'; export const s = new Sodax();\n`;

// The swap solver imports one ABI constant from @pancakeswap/infinity-sdk; L2 vendors it instead.
export async function vendoredAbiStub() {
  const abi = readFileSync(`${await ensureAbis()}/CLPositionManagerAbi.json`, 'utf8');
  return {
    spec: /^@pancakeswap\/infinity-sdk$/,
    importer: file('swap/EvmSolverService.ts'),
    contents: `export const CLPositionManagerAbi = ${abi};`,
  };
}

export async function stubsFor({ chains, features, level }) {
  const stubs = [];
  const specStubs = level >= 2 ? [await vendoredAbiStub()] : [];
  for (const c of ALL_CHAINS.filter(c => !chains.includes(c))) {
    stubs.push(...CHAINS[c].l1);
    if (level >= 2) {
      stubs.push(...CHAINS[c].l2Files);
      specStubs.push(...CHAINS[c].l2Libs);
    }
  }
  for (const f of ALL_FEATURES.filter(f => !features.includes(f))) {
    stubs.push(...FEATURES[f].l1, ...(level >= 2 ? FEATURES[f].l2 : []));
  }
  return { stubs, specStubs, aliases: level >= 2 ? DEDUPE_TYPES : {} };
}

export async function project({ name, chains, features, level }) {
  return bundle({ name, contents: ENTRY, ...(await stubsFor({ chains, features, level })) });
}

const EVM_ALL_FEATURES = ALL_FEATURES.filter(f => f !== 'sponsoring' && f !== 'migration');
export const PROFILES = [
  ['Full (all features, all chains)', ALL_CHAINS, ALL_FEATURES],
  ['Core only (hub + EVM, no features)', [], []],
  ['Swaps, EVM only', [], ['swaps']],
  ['Swaps, EVM + Solana', ['solana'], ['swaps']],
  ['Swaps, EVM + Solana + Sui', ['solana', 'sui'], ['swaps']],
  ['Swaps, all chains', ALL_CHAINS, ['swaps']],
  ['Money market, EVM only', [], ['moneyMarket']],
  ['Money market, all chains', ALL_CHAINS, ['moneyMarket']],
  ['Bridge, EVM only', [], ['bridge']],
  ['Staking, EVM only', [], ['staking']],
  ['DEX, EVM only', [], ['dex']],
  ['Swaps + MM + Bridge, EVM only', [], ['swaps', 'moneyMarket', 'bridge']],
  ['All features, EVM only', [], EVM_ALL_FEATURES],
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = [];
  for (const [profile, chains, features] of PROFILES) {
    const l1 = await project({ name: profile, chains, features, level: 1 });
    const l2 = await project({ name: profile, chains, features, level: 2 });
    const pick = r => ({ min: r.min, gz: r.gz, br: r.br });
    rows.push({ profile, l1: pick(l1), l2: pick(l2), l2TopBuckets: topBuckets(l2.byBucket, 25) });
    console.log(
      `${profile.padEnd(38)} L1 min ${kb(l1.min).padStart(7)} gz ${kb(l1.gz).padStart(7)} | L2 min ${kb(l2.min).padStart(7)} gz ${kb(l2.gz).padStart(7)} br ${kb(l2.br).padStart(6)}`,
    );
  }
  saveResult('scenarios', rows);
}
