// L3 input: cost of each chain library's used surface today vs slimmer entry points / replacement libraries.
// "current" snippets resolve from packages/sdk (the SDK's exact installs); alternatives from ../node_modules.
import { readFileSync } from 'node:fs';
import { ALTERNATIVES, bundle, ensureAbis, HERE, kb, SDK, saveResult } from './lib.mjs';

const CASES = [
  ['solana', 'current: web3.js + spl-token + anchor (used symbols)', 'solana-web3-used.js', SDK],
  ['solana', 'alt: @solana/kit + @solana-program/* + static ix encoders', 'solana-kit.js', HERE],
  ['stellar', 'current: @stellar/stellar-sdk root (used symbols)', 'stellar-current.js', SDK],
  ['stellar', 'alt: @stellar/stellar-sdk/minimal', 'stellar-minimal.js', HERE],
  ['stellar', 'alt: minimal/rpc + stellar-base, no Horizon', 'stellar-rpc-no-horizon.js', HERE],
  ['sui', 'current: gRPC client + transactions + bcs', 'sui-grpc.js', SDK],
  ['sui', 'alt: JSON-RPC client + transactions + bcs', 'sui-jsonrpc.js', SDK],
  ['sui', 'alt: GraphQL client + transactions + bcs', 'sui-graphql.js', SDK],
  ['sui', 'floor: transactions + bcs only (no client)', 'sui-tx-bcs-only.js', SDK],
  ['icon', 'current: icon-sdk-js', 'icon-current.js', SDK],
  ['icon', 'alt: fetch JSON-RPC + tx builder', 'icon-fetch.js', HERE],
  ['injective', 'current: sdk-ts root + networks + cosmjs-types', 'inj-current.js', SDK],
  ['injective', 'alt: sdk-ts granular subpaths', 'inj-subpaths.js', SDK],
  ['injective', 'alt: REST (LCD) + cosmjs-types encoders', 'inj-rest.js', SDK],
  ['near', 'current: near-api-js JsonRpcProvider', 'near-used.js', SDK],
  ['near', 'alt: @near-js/providers', 'near-js-providers.js', HERE],
  ['near', 'alt: fetch JSON-RPC call_function', 'near-fetch.js', HERE],
  ['stacks', 'current: @sodax/libs/stacks/core (used symbols)', 'stacks-used.js', SDK],
  ['stacks', 'ref: @sodax/libs/stacks/core (everything)', 'stacks-all.js', SDK],
  ['bitcoin', 'current: bitcoinjs-lib + @bitcoinerlab/secp256k1', 'btc-bitcoinjs-used.js', SDK],
  ['bitcoin', 'alt: @scure/btc-signer', 'btc-scure.js', HERE],
];
await ensureAbis();
const DEX_CURRENT = `export { Price, Token } from '@pancakeswap/swap-sdk-core';
export { CLPoolManagerAbi, CLPositionManagerAbi, decodePoolKey, getPoolId, encodeCLPositionManagerMintCalldata, encodeCLPositionManagerIncreaseLiquidityCalldata, encodeCLPositionManagerDecreaseLiquidityCalldata } from '@pancakeswap/infinity-sdk';
export { maxLiquidityForAmount0Precise, maxLiquidityForAmount1, maxLiquidityForAmounts, PositionMath, sqrtRatioX96ToPrice, TickMath, tickToPrice } from '@pancakeswap/v3-sdk';`;
const jobs = [
  ...CASES.map(([chain, label, f, dir]) => ({
    chain,
    label,
    contents: readFileSync(`${ALTERNATIVES}/${f}`, 'utf8'),
    resolveDir: dir,
  })),
  { chain: 'dex', label: 'current: PancakeSwap SDK surface', contents: DEX_CURRENT, resolveDir: SDK },
  {
    chain: 'dex',
    label: 'same, minus Solana leak in swap-sdk-core',
    contents: DEX_CURRENT,
    resolveDir: SDK,
    specStubs: [{ spec: /^@solana\/web3\.js$/, importer: /@pancakeswap/ }],
  },
  {
    chain: 'dex',
    label: 'alt: vendored CL math + ABIs over viem',
    contents: `export * from '${ALTERNATIVES}/dex-vendored.js';`,
  },
];
const rows = [];
for (const { chain, label, ...opts } of jobs) {
  const r = await bundle({ name: `${chain}-${label}`, ...opts });
  const top = Object.entries(r.byBucket)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([b, n]) => `${b}=${kb(n)}`)
    .join(' ');
  rows.push({ chain, label, min: r.min, gz: r.gz, br: r.br, top });
  console.log(
    `${chain.padEnd(9)} ${label.padEnd(58)} min ${kb(r.min).padStart(7)} gz ${kb(r.gz).padStart(6)} br ${kb(r.br).padStart(6)} | ${top}`,
  );
}
saveResult('libalts', rows);
