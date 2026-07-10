// apps/node/src/gasless-deposit.ts
//
// E2E smoke test for gasless (EIP-7702 sponsored) ERC20 spoke deposits — Mode B (SDK-managed key).
//
// It composes the feature-agnostic `sodax.gasless.deposit(...)` primitive with a real bridge
// intent: `bridge.createBridgeIntent({ raw: true })` builds the hub payload (`data`) and the hub
// recipient (`to`), then the gasless service batches `approve` + `assetManager.transfer` into one
// user operation, sponsors the gas via Pimlico, and relays the resulting tx to the hub.
//
// Usage:
//   EVM_SPOKE_CHAIN_KEY=0x2105.base \
//   PRIVATE_KEY=0x… PIMLICO_API_KEY=… \
//   pnpm gasless-deposit <srcSymbol> <dstChainKey> <dstSymbol> <amount>
//
// Example (bridge USDC Base → Arbitrum, gas sponsored):
//   EVM_SPOKE_CHAIN_KEY=0x2105.base pnpm gasless-deposit USDC 0xa4b1.arbitrum USDC 1000000
//
// Prerequisites (external to this repo):
//   - A funded Pimlico account + sponsorship policy allowing the SpokeAssetManager/ERC20 calls.
//   - The target chain must have EIP-7702 live (Simple7702 delegate + EntryPoint via Pimlico).
//   - Use a dedicated test wallet — the flow broadcasts to a real chain.
import 'dotenv/config';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  ChainKeys,
  EVM_SPOKE_ONLY_CHAIN_KEYS_SET,
  Sodax,
  spokeChainConfig,
  type EvmSpokeChainConfig,
  type EvmSpokeOnlyChainKey,
  type SpokeChainKey,
} from '@sodax/sdk';

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? process.env.EVM_PRIVATE_KEY;
if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY (or EVM_PRIVATE_KEY) environment variable is required');

const PIMLICO_API_KEY = process.env.PIMLICO_API_KEY;
if (!PIMLICO_API_KEY) throw new Error('PIMLICO_API_KEY environment variable is required for gasless deposits');

function resolveSpokeChainKey(): EvmSpokeOnlyChainKey {
  const raw = process.env.EVM_SPOKE_CHAIN_KEY ?? ChainKeys.BASE_MAINNET;
  if (!EVM_SPOKE_ONLY_CHAIN_KEYS_SET.has(raw as EvmSpokeOnlyChainKey)) {
    throw new Error(
      `EVM_SPOKE_CHAIN_KEY="${raw}" is not a known EVM spoke chain. Supported: ${[...EVM_SPOKE_ONLY_CHAIN_KEYS_SET].join(', ')}`,
    );
  }
  return raw as EvmSpokeOnlyChainKey;
}

const SPOKE_CHAIN_KEY = resolveSpokeChainKey();
const spokeCfg = spokeChainConfig[SPOKE_CHAIN_KEY] satisfies EvmSpokeChainConfig;
const chainId = spokeCfg.chain.chainId;

// Pimlico v2 endpoint serves both the bundler and the ERC-7677 paymaster.
const pimlicoUrl = `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${PIMLICO_API_KEY}`;

const owner = privateKeyToAccount(PRIVATE_KEY as Hex);

const sodax = new Sodax({
  gasless: {
    pimlicoApiKey: PIMLICO_API_KEY,
    chains: {
      [SPOKE_CHAIN_KEY]: { paymasterUrl: pimlicoUrl, bundlerUrl: pimlicoUrl, supports7702: true },
    },
  },
});

function resolveToken(symbol: string): Address {
  const tokens = spokeCfg.supportedTokens as Record<string, { address: string }>;
  const entry = tokens[symbol];
  if (!entry)
    throw new Error(`Unknown token "${symbol}" on ${SPOKE_CHAIN_KEY}. Known: ${Object.keys(tokens).join(', ')}`);
  return entry.address as Address;
}

function resolveDstToken(dstChainKey: SpokeChainKey, symbolOrAddress: string): string {
  if (symbolOrAddress.startsWith('0x')) return symbolOrAddress;
  const dstCfg = spokeChainConfig[dstChainKey];
  if (!dstCfg) throw new Error(`Unknown destination chain: ${dstChainKey}`);
  const tokens = dstCfg.supportedTokens as Record<string, { address: string }>;
  const entry = tokens[symbolOrAddress];
  if (!entry) throw new Error(`Unknown token "${symbolOrAddress}" on ${dstChainKey}`);
  return entry.address;
}

async function main(): Promise<void> {
  const [srcSymbol, dstChainKeyArg, dstSymbol, amountArg] = process.argv.slice(2);
  if (!srcSymbol || !dstChainKeyArg || !dstSymbol || !amountArg) {
    throw new Error('Usage: pnpm gasless-deposit <srcSymbol> <dstChainKey> <dstSymbol> <amount>');
  }

  const dstChainKey = dstChainKeyArg as SpokeChainKey;
  const srcToken = resolveToken(srcSymbol);
  const dstToken = resolveDstToken(dstChainKey, dstSymbol);
  const amount = BigInt(amountArg);
  const srcAddress = owner.address;

  console.log(`[gasless] chain=${SPOKE_CHAIN_KEY} (chainId ${chainId}) eoa=${srcAddress}`);
  console.log(`[gasless] bridging ${amount} ${srcSymbol} (${srcToken}) → ${dstChainKey} ${dstSymbol} (${dstToken})`);

  // Build the hub payload + hub recipient from a raw bridge intent (no broadcast).
  const intent = await sodax.bridge.createBridgeIntent({
    raw: true,
    params: {
      srcAddress,
      srcChainKey: SPOKE_CHAIN_KEY,
      srcToken,
      amount,
      dstChainKey,
      dstToken,
      recipient: srcAddress,
    },
  });
  if (!intent.ok) throw intent.error;
  const { address: to, payload: data } = intent.value.relayData;

  console.log('[gasless] submitting sponsored batch (approve + transfer)…');
  const result = await sodax.gasless.deposit({
    srcChainKey: SPOKE_CHAIN_KEY,
    srcAddress,
    token: srcToken,
    amount,
    to,
    data,
    owner,
  });

  if (!result.ok) {
    console.error('[gasless] FAILED', result.error.code, result.error.message, result.error.context);
    process.exitCode = 1;
    return;
  }

  console.log('[gasless] OK');
  console.log('  srcChainTxHash:', result.value.srcChainTxHash);
  console.log('  dstChainTxHash:', result.value.dstChainTxHash);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
