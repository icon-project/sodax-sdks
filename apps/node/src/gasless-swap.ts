// apps/node/src/gasless-swap.ts
//
// E2E smoke test for a gasless (EIP-7702 + ERC-4337, Pimlico-sponsored) cross-chain SWAP, driven
// through the stateless external-signer brain: prepare → (external sign) → submit → relay.
//
// It proves a **zero-native-balance EOA** can swap: `swaps.getQuote(...)` prices the pair;
// `swaps.createIntent({ raw: true })` builds the hub payload (`data`) + recipient (`to`) from a
// solver swap intent; `gasless.prepare(...)` builds the sponsored `[approve, transfer]` UserOperation
// and returns the artifacts to sign (the UserOp hash + an EIP-7702 authorization tuple when
// delegation is needed); this script signs them with the EOA key (the SDK never sees the key);
// `gasless.submit(...)` broadcasts. Because EIP-7702 runs the account code AT the EOA address, the
// inner `SpokeAssetManager.transfer` executes with `msg.sender == EOA`.
//
// Usage:
//   EVM_SPOKE_CHAIN_KEY=0x2105.base \
//   PRIVATE_KEY=0x… PIMLICO_API_KEY=… \
//   pnpm gasless-swap <srcSymbol> <dstChainKey> <dstSymbol> <amount>
//
// Example (swap USDC on Base → WETH on Arbitrum, gas sponsored):
//   EVM_SPOKE_CHAIN_KEY=0x2105.base pnpm gasless-swap USDC 0xa4b1.arbitrum WETH 1000000
//
// `dstChainKey` must be an EVM spoke: the swap output is delivered to the same EOA address, which is
// only valid across EVM chains.
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
  getSupportedSolverTokens,
  spokeChainConfig,
  type EvmSpokeChainConfig,
  type EvmSpokeOnlyChainKey,
  type GaslessAuthorizationSignatureDto,
  type XToken,
} from '@sodax/sdk';

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? process.env.EVM_PRIVATE_KEY;
if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY (or EVM_PRIVATE_KEY) environment variable is required');

const PIMLICO_API_KEY = process.env.PIMLICO_API_KEY;
if (!PIMLICO_API_KEY) throw new Error('PIMLICO_API_KEY environment variable is required for gasless swaps');

// Slippage tolerance applied to the solver quote to derive minOutputAmount.
const SLIPPAGE_PERCENT = 0.5;

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

// The EOA that signs — its key stays in this script; the SDK brain never receives it.
const owner = privateKeyToAccount(PRIVATE_KEY as Hex);

// Endpoints are synthesized from `pimlicoApiKey` (paymaster + bundler share the Pimlico v2 URL).
const sodax = new Sodax({
  gasless: {
    pimlicoApiKey: PIMLICO_API_KEY,
    chains: {
      [SPOKE_CHAIN_KEY]: { supports7702: true },
    },
  },
});

// Resolve a solver-supported token by symbol on a given EVM spoke.
function resolveSolverToken(chainKey: EvmSpokeOnlyChainKey, symbol: string): XToken {
  const tokens = getSupportedSolverTokens(chainKey);
  const entry = tokens.find(t => t.symbol === symbol);
  if (!entry) {
    throw new Error(`Unknown solver token "${symbol}" on ${chainKey}. Known: ${tokens.map(t => t.symbol).join(', ')}`);
  }
  return entry;
}

// The output is delivered to the source EOA, so the destination must be an EVM spoke.
function resolveDstChainKey(raw: string): EvmSpokeOnlyChainKey {
  if (!EVM_SPOKE_ONLY_CHAIN_KEYS_SET.has(raw as EvmSpokeOnlyChainKey)) {
    throw new Error(
      `Destination "${raw}" must be an EVM spoke (the output is delivered to the source EOA). Supported: ${[...EVM_SPOKE_ONLY_CHAIN_KEYS_SET].join(', ')}`,
    );
  }
  return raw as EvmSpokeOnlyChainKey;
}

async function main(): Promise<void> {
  const [srcSymbol, dstChainKeyArg, dstSymbol, amountArg] = process.argv.slice(2);
  if (!srcSymbol || !dstChainKeyArg || !dstSymbol || !amountArg) {
    throw new Error('Usage: pnpm gasless-swap <srcSymbol> <dstChainKey> <dstSymbol> <amount>');
  }

  const dstChainKey = resolveDstChainKey(dstChainKeyArg);
  const srcToken = resolveSolverToken(SPOKE_CHAIN_KEY, srcSymbol);
  const dstToken = resolveSolverToken(dstChainKey, dstSymbol);
  const amount = BigInt(amountArg);
  const srcAddress = owner.address;

  console.log(`[gasless] chain=${SPOKE_CHAIN_KEY} (chainId ${chainId}) eoa=${srcAddress}`);
  console.log(
    `[gasless] swapping ${amount} ${srcSymbol} (${srcToken.address}) → ${dstChainKey} ${dstSymbol} (${dstToken.address})`,
  );

  // 0) Eligibility — chain configured + EOA (not a deployed contract) + sponsorship available.
  const caps = await sodax.gasless.getCapabilities({ srcChainKey: SPOKE_CHAIN_KEY, srcAddress });
  if (!caps.ok) throw caps.error;
  console.log('[gasless] capabilities:', caps.value);
  if (!caps.value.eligible) throw new Error(`Not eligible: ${caps.value.reason}`);

  // 1) Quote the pair, then derive minOutputAmount from the configured slippage tolerance.
  const quote = await sodax.swaps.getQuote({
    token_src: srcToken.address,
    token_src_blockchain_id: SPOKE_CHAIN_KEY,
    token_dst: dstToken.address,
    token_dst_blockchain_id: dstChainKey,
    amount,
    quote_type: 'exact_input',
  });
  if (!quote.ok) throw quote.error;
  // minOutputAmount = quoted × (100 − slippage) / 100, in integer base units.
  const minOutputAmount = (quote.value.quoted_amount * BigInt(Math.round((100 - SLIPPAGE_PERCENT) * 100))) / 10_000n;
  console.log(
    `[gasless] quoted ${quote.value.quoted_amount} ${dstSymbol}; minOutput ${minOutputAmount} (${SLIPPAGE_PERCENT}% slippage)`,
  );

  // 2) Build the hub payload + hub recipient from a raw solver swap intent (no broadcast).
  const intent = await sodax.swaps.createIntent({
    raw: true,
    params: {
      inputToken: srcToken.address,
      outputToken: dstToken.address,
      inputAmount: amount,
      minOutputAmount,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 60 * 5),
      allowPartialFill: false,
      srcChainKey: SPOKE_CHAIN_KEY,
      dstChainKey,
      srcAddress,
      dstAddress: srcAddress, // same EOA on the destination EVM chain
      solver: '0x0000000000000000000000000000000000000000',
      data: '0x',
    },
  });
  if (!intent.ok) throw intent.error;
  const { address: to, payload: data } = intent.value.relayData;

  // 3) prepare — keyless build of the sponsored UserOp + sign-requests.
  console.log('[gasless] prepare…');
  const prepared = await sodax.gasless.prepare({
    srcChainKey: SPOKE_CHAIN_KEY,
    srcAddress,
    token: srcToken.address,
    amount: amount.toString(),
    to,
    data,
  });
  if (!prepared.ok) throw prepared.error;
  console.log('[gasless] userOpHash:', prepared.value.userOpHash);
  console.log('[gasless] needs authorization:', prepared.value.authorization !== undefined);

  // 4) external sign — the EOA signs the UserOp hash and, when delegation is needed, the EIP-7702
  //    authorization tuple. This is the ONLY place the private key is used; the SDK never holds it.
  const userOp = await owner.sign({ hash: prepared.value.userOpHash as Hex });
  let authorization: GaslessAuthorizationSignatureDto | undefined;
  if (prepared.value.authorization) {
    const signed = await owner.signAuthorization({
      address: prepared.value.authorization.address as Address,
      chainId: prepared.value.authorization.chainId,
      nonce: prepared.value.authorization.nonce,
    });
    authorization = { r: signed.r, s: signed.s, yParity: signed.yParity ?? 0 };
  }

  // 5) submit — the brain verifies the signature recovers to the EOA, then broadcasts.
  console.log('[gasless] submit (sponsored)…');
  const submitted = await sodax.gasless.submit({
    prepared: prepared.value,
    signatures: { userOp, ...(authorization ? { authorization } : {}) },
  });
  if (!submitted.ok) {
    console.error('[gasless] SUBMIT FAILED', submitted.error.code, submitted.error.message, submitted.error.context);
    process.exitCode = 1;
    return;
  }
  console.log('[gasless] submitted srcChainTxHash:', submitted.value.txHash);

  // 6) relay (optional tail) — the brain does not own it; the caller relays the returned hash.
  console.log('[gasless] relay…');
  const relayed = await sodax.gasless.relay({
    srcChainKey: SPOKE_CHAIN_KEY,
    srcChainTxHash: submitted.value.txHash,
    relayData: { address: to, payload: data },
  });
  if (!relayed.ok) {
    console.error('[gasless] RELAY FAILED', relayed.error.code, relayed.error.message, relayed.error.context);
    process.exitCode = 1;
    return;
  }

  console.log('[gasless] OK — inner SpokeAssetManager.transfer ran with msg.sender == EOA (EIP-7702)');
  console.log('  srcChainTxHash:', relayed.value.srcChainTxHash);
  console.log('  dstChainTxHash:', relayed.value.dstChainTxHash);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
