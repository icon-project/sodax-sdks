import 'dotenv/config';

import { Sodax, ChainKeys, type SpokeChainKey, type XToken } from '@sodax/sdk';

// Smoke-test the raw bridge-tx build across every source chain family — the exact path the Bridge API
// backend uses to create an unsigned source tx. `sodax.bridge.createBridgeIntent({ raw: true })` BUILDS
// and returns the unsigned spoke deposit tx + relayData; it never signs or broadcasts. Read-only against
// mainnet (derives the hub wallet + resolves vault config, so a working RPC is required).
//
// Per-source-chain raw-deposit inputs (all handled here with env-overridable sample defaults):
//   EVM       — address only (hub-wallet derivation is deterministic).            → builds with no funds
//   SOLANA    — address only (+ a recent blockhash read from RPC).               → builds with no funds
//   NEAR      — address only (the raw tx is built without a network read).       → builds with no funds
//   STACKS    — address + srcPublicKey (extras.srcPublicKey; the address alone can't yield the pubkey). → no funds
//   INJECTIVE — address that has signed on-chain (signer pubkey is read from it) AND that HOLDS the
//               bridgeable token: the raw build always simulates gas (Cosmos), which enforces balance.
//   BITCOIN   — a valid Bound Exchange access token for a TRADING-mode raw PSBT (extras.bound.accessToken,
//               via BOUND_ACCESS_TOKEN). Bound's edge gateway 403s plain server-to-server calls, so this
//               typically only completes from a whitelisted browser origin — from Node expect a legible 403.
//
// Default runs EVERY family in one shot (one representative source each, summary table at the end):
//   cd apps/node && pnpm bridge-raw
// Pass a network to run just that one (full tx/relayData dump). Accepts a chain key or a friendly name:
//   pnpm bridge-raw solana        # arbitrum | base | solana | near | injective | stacks | bitcoin | <chainKey>
// Single-source overrides: BRIDGE_DST (else the first EVM chain with a bridgeable pair), SRC_TOKEN (pin the
// source token by address — e.g. the exact denom a wallet holds), SRC_ADDRESS, RECIPIENT, BRIDGE_AMOUNT.
// Native-token test: pass SRC_TOKEN = the chain's native sentinel to exercise the native path (EVM/S
// sends `value` instead of an ERC20 transfer): EVM `0x0000000000000000000000000000000000000000`,
// Solana `11111111111111111111111111111111`, Injective `inj`, Bitcoin `0:0` (BTC — already the default).
const sodax = new Sodax();

const asSpokeChainKey = (value: string, label: string): SpokeChainKey => {
  if (!sodax.config.isValidSpokeChainKey(value as SpokeChainKey)) {
    console.error(`❌ ${label} is not a valid spoke chain key: ${value}`);
    process.exit(1);
  }
  return value as SpokeChainKey;
};

// Sample source addresses per chain family (all public, none under our control — raw mode only reads
// them, never signs). Override with SRC_ADDRESS. Injective's must have signed on-chain AND hold the token.
const SAMPLE_SRC_ADDRESS: Record<string, string> = {
  EVM: '0x1468d3529032106291433B7e9e3026dF1Ff78F31',
  SOLANA: 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi',
  NEAR: 'wrap.near',
  INJECTIVE: 'inj10ch5tlensr62n3fhgz4xecavgjnffu8p5z7f5y',
  STACKS: 'SP1D5PA98M0PF9Z4Q4N2CDTMTD7XSZ6GE7QQG5XBX',
  BITCOIN: 'bc1pax7wcjw4r7m25fn2405x5a5f6vucv8pcqr8ltsz2mp4xjmx26rgstqgwhz',
};

// Sample Stacks signer public key that derives to the STACKS sample address above (same account).
const SAMPLE_STACKS_PUBLIC_KEY = '025259f813b57dd5c3fcac09776d767a49f6dd77bba5895823b891e31b10a96a5d';

type BridgePair = { srcToken: XToken; dstChainKey: SpokeChainKey; dstToken: XToken };

/**
 * Find the first bridgeable (srcToken -> dstToken) pair from the source chain to an EVM destination
 * (so the recipient is a simple EVM address). A pair is bridgeable when both tokens resolve to the same
 * hub vault. Prefers a stable, readable symbol (USDC / bnUSD / SODA). `srcTokenFilter` pins the source
 * token by address (e.g. the exact denom a wallet holds); `dstFilter` pins the destination chain.
 */
function findBridgeablePair(
  srcChainKey: SpokeChainKey,
  srcTokenFilter?: string,
  dstFilter?: string,
): BridgePair | undefined {
  const allSrcTokens = Object.values(sodax.config.spokeChainConfig[srcChainKey].supportedTokens);
  const filter = srcTokenFilter?.toLowerCase();
  const srcTokens = filter ? allSrcTokens.filter(t => t.address.toLowerCase() === filter) : allSrcTokens;
  const dstChains = dstFilter
    ? [asSpokeChainKey(dstFilter, 'BRIDGE_DST')]
    : sodax.config
        .getSupportedSpokeChains()
        .filter(k => k !== srcChainKey && sodax.config.spokeChainConfig[k].chain.type === 'EVM');

  const pairs: BridgePair[] = [];
  for (const srcToken of srcTokens) {
    if (srcToken.access === 'withdrawOnly') continue; // deprecated deposit entry
    for (const dstChainKey of dstChains) {
      const result = sodax.bridge.getBridgeableTokens(srcChainKey, dstChainKey, srcToken.address);
      if (!result.ok) continue;
      const dstToken = result.value.find(t => t.access !== 'depositOnly');
      if (dstToken) pairs.push({ srcToken, dstChainKey, dstToken });
    }
  }

  const preferred = ['USDC', 'bnUSD', 'SODA'];
  return preferred.map(sym => pairs.find(p => p.srcToken.symbol === sym)).find(Boolean) ?? pairs[0];
}

type RunOptions = { srcAddress?: string; srcToken?: string; dst?: string; amount?: bigint; compact?: boolean };
type RunResult = { label: string; source: string; ok: boolean; note: string };

async function runOne(srcChainKey: SpokeChainKey, opts: RunOptions = {}): Promise<RunResult> {
  const srcType = sodax.config.spokeChainConfig[srcChainKey].chain.type;
  const label = `${srcType.padEnd(9)} ${srcChainKey}`;
  const srcAddress = opts.srcAddress ?? SAMPLE_SRC_ADDRESS[srcType];
  if (!srcAddress) return { label, source: srcChainKey, ok: false, note: `no sample address for ${srcType}` };

  const pair = findBridgeablePair(srcChainKey, opts.srcToken, opts.dst);
  if (!pair) return { label, source: srcChainKey, ok: false, note: 'no bridgeable pair found' };
  const { srcToken, dstChainKey, dstToken } = pair;

  const recipient = process.env.RECIPIENT ?? SAMPLE_SRC_ADDRESS.EVM;
  const srcPublicKey = process.env.SRC_PUBLIC_KEY ?? SAMPLE_STACKS_PUBLIC_KEY;
  const boundAccessToken = process.env.BOUND_ACCESS_TOKEN;

  // Default 0.01 of the source token (base units); override with BRIDGE_AMOUNT.
  const defaultAmount = 10n ** BigInt(srcToken.decimals) / 100n;
  const amount = opts.amount ?? (defaultAmount > 0n ? defaultAmount : 1n);

  if (!opts.compact) {
    console.log('source      :', `${srcChainKey} (${srcType})`);
    console.log('dest        :', dstChainKey);
    console.log('srcToken    :', `${srcToken.symbol} (${srcToken.address})`);
    console.log('dstToken    :', `${dstToken.symbol} (${dstToken.address})`);
    console.log('amount      :', amount.toString());
    console.log('srcAddress  :', srcAddress);
    console.log('recipient   :', recipient);
    if (srcType === 'STACKS') console.log('srcPublicKey:', srcPublicKey);
    if (srcType === 'BITCOIN')
      console.log('accessToken :', boundAccessToken ? `present (${boundAccessToken.length} chars)` : '(none)');
  }

  // Only srcChainKey + extras differ per family. Stacks and Bitcoin each have a single mainnet key, so
  // an explicit type arg opens up the typed `extras` slot (off those chains it is `never`).
  const result =
    srcType === 'STACKS'
      ? await sodax.bridge.createBridgeIntent<typeof ChainKeys.STACKS_MAINNET, true>({
          params: {
            srcChainKey: ChainKeys.STACKS_MAINNET,
            srcToken: srcToken.address,
            amount,
            dstChainKey,
            dstToken: dstToken.address,
            srcAddress,
            recipient,
          },
          extras: { srcPublicKey },
          raw: true,
          skipSimulation: true,
        })
      : srcType === 'BITCOIN'
        ? await sodax.bridge.createBridgeIntent<typeof ChainKeys.BITCOIN_MAINNET, true>({
            params: {
              srcChainKey: ChainKeys.BITCOIN_MAINNET,
              srcToken: srcToken.address,
              amount,
              dstChainKey,
              dstToken: dstToken.address,
              srcAddress,
              recipient,
            },
            extras: { bound: { accessToken: boundAccessToken } },
            raw: true,
            skipSimulation: true,
          })
        : await sodax.bridge.createBridgeIntent({
            params: {
              srcChainKey,
              srcToken: srcToken.address,
              amount,
              dstChainKey,
              dstToken: dstToken.address,
              srcAddress,
              recipient,
            },
            raw: true,
            skipSimulation: true,
          });

  const tokenNote = `${srcToken.symbol}→${dstChainKey}`;
  if (!result.ok) {
    if (!opts.compact) console.error('❌ createBridgeIntent FAILED:', result.error);
    const msg = (result.error as { message?: string })?.message ?? String(result.error);
    return { label, source: srcChainKey, ok: false, note: `${tokenNote}: ${msg.split('\n')[0].slice(0, 90)}` };
  }

  const { tx, relayData } = result.value;
  const hasRelay =
    typeof relayData?.address === 'string' &&
    typeof relayData?.payload === 'string' &&
    relayData.payload.startsWith('0x') &&
    relayData.payload.length > 4;

  if (!opts.compact) {
    console.log('✅ raw tx   :', tx);
    console.log('✅ relayData:', relayData);
  }
  if (tx && hasRelay) {
    if (!opts.compact) console.log(`✅ PASS — unsigned ${srcType} bridge tx + relayData built (no signing/broadcast)`);
    return { label, source: srcChainKey, ok: true, note: tokenNote };
  }
  return { label, source: srcChainKey, ok: false, note: `${tokenNote}: missing raw tx or relayData` };
}

// One representative source per family for the `all` sweep. Injective is pinned to bnUSD because the
// sample wallet holds bnUSD (not USDC) and its raw build simulates the deposit against real balance.
const ALL_FAMILIES: { key: SpokeChainKey; srcToken?: string }[] = [
  { key: ChainKeys.ARBITRUM_MAINNET },
  { key: ChainKeys.SOLANA_MAINNET },
  { key: ChainKeys.NEAR_MAINNET },
  {
    key: ChainKeys.INJECTIVE_MAINNET,
    srcToken: sodax.config.spokeChainConfig[ChainKeys.INJECTIVE_MAINNET].supportedTokens.bnUSD?.address,
  },
  { key: ChainKeys.STACKS_MAINNET },
  { key: ChainKeys.BITCOIN_MAINNET },
];

// Resolve a CLI/env network token to a spoke chain key. Accepts a raw chain-key value (`solana`,
// `injective-1`, `0xa4b1.arbitrum`) or a friendly name derived from the ChainKeys constant
// (`arbitrum`, `base`, `injective`, `near`, `stacks`, `bitcoin`).
function resolveSource(input: string): SpokeChainKey {
  if (sodax.config.isValidSpokeChainKey(input as SpokeChainKey)) return input as SpokeChainKey;
  const want = input.toLowerCase().replace(/[_-]/g, '');
  for (const [name, value] of Object.entries(ChainKeys)) {
    const alias = name
      .toLowerCase()
      .replace(/mainnet$/, '')
      .replace(/[_-]/g, '');
    if (alias === want && sodax.config.isValidSpokeChainKey(value as SpokeChainKey)) return value as SpokeChainKey;
  }
  console.error(
    `❌ Unknown network "${input}". Pass a chain key or a name like arbitrum/base/solana/near/injective/stacks/bitcoin — or omit to run all.`,
  );
  process.exit(1);
}

async function main(): Promise<void> {
  // Default: run all families. Pass a network as the first CLI arg (or BRIDGE_SRC) to run just one.
  const src = process.argv[2] ?? process.env.BRIDGE_SRC ?? 'all';

  if (src.toLowerCase() === 'all') {
    const results: RunResult[] = [];
    for (const fam of ALL_FAMILIES) {
      console.log(`\n──────── ${sodax.config.spokeChainConfig[fam.key].chain.type} · ${fam.key} ────────`);
      try {
        results.push(await runOne(fam.key, { srcToken: fam.srcToken, compact: true }));
      } catch (error) {
        const msg = (error as { message?: string })?.message ?? String(error);
        results.push({
          label: `${sodax.config.spokeChainConfig[fam.key].chain.type} ${fam.key}`,
          source: fam.key,
          ok: false,
          note: msg.split('\n')[0].slice(0, 90),
        });
      }
      const last = results[results.length - 1];
      console.log(last.ok ? `  ✅ PASS — ${last.note}` : `  ❌ FAIL — ${last.note}`);
    }

    console.log('\n════════ SUMMARY ════════');
    for (const r of results) console.log(`  ${r.ok ? '✅' : '❌'}  ${r.label.padEnd(24)} ${r.note}`);
    const passed = results.filter(r => r.ok).length;
    console.log(`\n${passed}/${results.length} source families built a raw bridge tx.`);
    return;
  }

  const srcChainKey = resolveSource(src);
  const familyHint = ALL_FAMILIES.find(f => f.key === srcChainKey);
  const result = await runOne(srcChainKey, {
    srcAddress: process.env.SRC_ADDRESS,
    srcToken: process.env.SRC_TOKEN ?? familyHint?.srcToken, // e.g. Injective auto-pins bnUSD
    dst: process.env.BRIDGE_DST,
    amount: process.env.BRIDGE_AMOUNT ? BigInt(process.env.BRIDGE_AMOUNT) : undefined,
  });
  if (!result.ok) process.exit(1);
}

main();
