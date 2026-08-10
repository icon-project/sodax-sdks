import 'dotenv/config';
import { http, createPublicClient, formatUnits, parseEther, toEventSelector } from 'viem';
import { mainnet } from 'viem/chains';
import {
  Sodax,
  ChainKeys,
  HookKind,
  spokeChainConfig,
  type CreateIntentParams,
  type SolverIntentQuoteRequest,
} from '@sodax/sdk';
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';
import type { Address, Hex } from '@sodax/types';

/**
 * Swap native S on Sonic into USDC on Ethereum and deposit it into the Flint RWA vault
 * (Lagoon ERC-7540) via the FlintDepositHook, all as one intent.
 *
 * Usage:
 *   EVM_PRIVATE_KEY=0x… pnpm tsx src/flint-deposit.ts               # dry run: quote + built intent only
 *   EVM_PRIVATE_KEY=0x… pnpm tsx src/flint-deposit.ts --execute     # actually submit
 *
 * Optional env:
 *   AMOUNT_S    — S to swap, decimal (default "100", ~2.4 USDC at 2026-08 prices; the hook needs ≥1 USDC after slippage)
 *   RECIPIENT   — ERC-7540 controller the deposit request is recorded for (default: the wallet)
 *   ETH_RPC_URL — Ethereum RPC for the pre-flight check (default: publicnode)
 */

const SONIC_RPC_URL = 'https://rpc.soniclabs.com';
const ETH_RPC_URL = process.env.ETH_RPC_URL ?? 'https://ethereum-rpc.publicnode.com';

/** Ethereum SpokeAssetManager proxy (UUPS) and its ERC-1967 implementation slot. */
const ETH_SPOKE_ASSET_MANAGER: Address = '0x39E77f86C1B1f3fbAb362A82b49D2E86C09659B4';
const ERC1967_IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as const;

/** The FlintDepositHook delivers to the vault only at or above this (1 USDC, 6 decimals). */
const HOOK_MIN_DEPOSIT = 1_000_000n;

const privateKey = process.env.EVM_PRIVATE_KEY;
if (!privateKey) throw new Error('EVM_PRIVATE_KEY environment variable is required');

const execute = process.argv.includes('--execute');
const inputAmount = parseEther(process.env.AMOUNT_S ?? '100');

const sonicWallet = new EvmWalletProvider({
  privateKey: privateKey as Hex,
  chainId: ChainKeys.SONIC_MAINNET,
  rpcUrl: SONIC_RPC_URL,
});

const sodax = new Sodax();
await sodax.initialize();

/**
 * HARD GATE. Until the Ethereum SpokeAssetManager implementation supports withdrawal hooks, a
 * hooked delivery transfers the USDC to the hook contract WITHOUT calling `hook()` — the funds
 * park there and only the owner Safe's `rescue` can move them. The hook-capable implementation
 * is the only one whose bytecode contains the `Hooked` event topic, so gate on that.
 */
async function assertEthSpokeSupportsHooks(): Promise<void> {
  const eth = createPublicClient({ chain: mainnet, transport: http(ETH_RPC_URL) });
  const implWord = await eth.getStorageAt({ address: ETH_SPOKE_ASSET_MANAGER, slot: ERC1967_IMPL_SLOT });
  const impl = `0x${(implWord ?? '0x').slice(-40)}` as Address;
  const code = (await eth.getCode({ address: impl })) ?? '0x';

  const hookedTopic = toEventSelector('Hooked(address,address,uint256,uint256)').slice(2);
  if (!code.toLowerCase().includes(hookedTopic.toLowerCase())) {
    throw new Error(
      `Ethereum SpokeAssetManager implementation ${impl} has NO hook support — ` +
        'a hooked intent would strand its USDC in the hook contract. ' +
        'Wait for the SpokeAssetManager upgrade before running this.',
    );
  }
  console.log(`Pre-flight OK: SpokeAssetManager impl ${impl} supports withdrawal hooks`);
}

async function main(): Promise<void> {
  await assertEthSpokeSupportsHooks();

  const walletAddress = await sonicWallet.getWalletAddress();
  const recipient = (process.env.RECIPIENT ?? walletAddress) as Address;

  const sToken = spokeChainConfig[ChainKeys.SONIC_MAINNET].nativeToken;
  const usdc = spokeChainConfig[ChainKeys.ETHEREUM_MAINNET].supportedTokens.USDC.address;

  console.log(`Swapping ${formatUnits(inputAmount, 18)} S -> Ethereum USDC -> Flint deposit`);
  console.log(`Wallet: ${walletAddress}, flUSD controller (recipient): ${recipient}`);

  const quoteRequest: SolverIntentQuoteRequest = {
    token_src: sToken,
    token_dst: usdc,
    token_src_blockchain_id: ChainKeys.SONIC_MAINNET,
    token_dst_blockchain_id: ChainKeys.ETHEREUM_MAINNET,
    amount: inputAmount,
    quote_type: 'exact_input',
  };
  const quoteResult = await sodax.swaps.getQuote(quoteRequest);
  if (!quoteResult.ok) throw new Error(`Quote failed: ${JSON.stringify(quoteResult.error)}`);

  const quotedAmount = quoteResult.value.quoted_amount;
  const minOutputAmount = (quotedAmount * 95n) / 100n; // 5% slippage tolerance
  console.log(`Quoted: ${formatUnits(quotedAmount, 6)} USDC (min after slippage ${formatUnits(minOutputAmount, 6)})`);

  // Below the hook's dust floor it delivers plain USDC to the recipient instead of depositing —
  // harmless, but not what this script is for.
  if (minOutputAmount < HOOK_MIN_DEPOSIT) {
    throw new Error(`min output ${formatUnits(minOutputAmount, 6)} USDC is under the hook's 1 USDC minDeposit — raise AMOUNT_S`);
  }

  const deadlineResult = await sodax.swaps.getSwapDeadline(600n);
  if (!deadlineResult.ok) throw new Error('Failed to compute swap deadline');

  const createIntentParams: CreateIntentParams<typeof ChainKeys.SONIC_MAINNET> = {
    inputToken: sToken,
    outputToken: usdc,
    inputAmount,
    minOutputAmount,
    deadline: deadlineResult.value,
    allowPartialFill: false,
    srcChainKey: ChainKeys.SONIC_MAINNET,
    dstChainKey: ChainKeys.ETHEREUM_MAINNET,
    srcAddress: walletAddress,
    // With `hook` set the SDK overrides the on-chain dstAddress with the hook's deployed address;
    // this dstAddress is the recipient the hook credits (the ERC-7540 controller).
    dstAddress: recipient,
    solver: '0x0000000000000000000000000000000000000000',
    data: '0x',
    hook: { kind: HookKind.FLINT_DEPOSIT },
  };

  if (!execute) {
    console.log('\nDRY RUN (pass --execute to submit). Intent params:');
    console.log(JSON.stringify(createIntentParams, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
    return;
  }

  const swapResult = await sodax.swaps.swap({
    params: createIntentParams,
    raw: false,
    walletProvider: sonicWallet,
  });
  if (!swapResult.ok) {
    const { code, message, context, cause } = swapResult.error;
    console.error('Swap failed —', code, message);
    if (context) console.error('Context:', context);
    if (cause) console.error('Caused by:', cause);
    if (code === 'TX_SUBMIT_FAILED') console.error('CRITICAL: spoke tx landed but relay submission failed. Retry submission!');
    process.exitCode = 1;
    return;
  }

  const { intentDeliveryInfo } = swapResult.value;
  console.log('Submitted. Source tx:', intentDeliveryInfo.srcTxHash);
  console.log('Destination tx:', intentDeliveryInfo.dstTxHash);
  console.log(
    'On success the FlintDepositHook emits DepositRequested(controller, assets, requestId); ' +
      "shares appear once Flint's curator settles (typically within a day).",
  );
}

await main();
