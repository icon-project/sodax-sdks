// apps/node/src/evm.ts
//
// E2E smoke test script for any EVM spoke chain.
//
// Pick the chain via `EVM_SPOKE_CHAIN_KEY` env var (defaults to Hedera).
// Examples:
//   EVM_SPOKE_CHAIN_KEY=hedera        pnpm evm address
//   EVM_SPOKE_CHAIN_KEY=0x2105.base   pnpm evm bridge ETH 0x89.polygon POL 1000000000000000
//   EVM_SPOKE_CHAIN_KEY=0x89.polygon  pnpm evm supply USDC 1000000
//
// Hedera quirk worth knowing:
//  - Native HBAR is an 8-decimal token, but Hedera's EVM `msg.value` is 18 decimals.
//    `EvmSpokeService.deposit` handles the 1e10 scaling automatically.
//
// Actions:
//   address                                                show wallet address
//   bridge          <srcSymbol> <dstChainKey> <dstSymbol> <amount> [recipient]
//   supply          <symbol> <amount>                     supply to money market
//   borrow          <symbol> <amount>                     borrow from money market
//   withdraw        <symbol> <amount>                     withdraw from money market
//   repay           <symbol> <amount>                     repay money market debt
//
import 'dotenv/config';
import type { Address, Hash, Hex } from 'viem';
import {
  ChainKeys,
  EVM_SPOKE_ONLY_CHAIN_KEYS_SET,
  Sodax,
  spokeChainConfig,
  supportedSpokeChains,
  type EvmSpokeChainConfig,
  type EvmSpokeOnlyChainKey,
  type SpokeChainKey,
} from '@sodax/sdk';
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? process.env.EVM_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  throw new Error('PRIVATE_KEY (or EVM_PRIVATE_KEY) environment variable is required');
}

function resolveSpokeChainKey(): EvmSpokeOnlyChainKey {
  const raw = process.env.EVM_SPOKE_CHAIN_KEY ?? ChainKeys.HEDERA_MAINNET;
  if (!EVM_SPOKE_ONLY_CHAIN_KEYS_SET.has(raw as EvmSpokeOnlyChainKey)) {
    const supported = [...EVM_SPOKE_ONLY_CHAIN_KEYS_SET].join(', ');
    throw new Error(`EVM_SPOKE_CHAIN_KEY="${raw}" is not a known EVM spoke chain. Supported: ${supported}`);
  }
  return raw as EvmSpokeOnlyChainKey;
}

const SPOKE_CHAIN_KEY = resolveSpokeChainKey();
const spokeCfg = spokeChainConfig[SPOKE_CHAIN_KEY] satisfies EvmSpokeChainConfig;
const RPC_URL = (process.env.EVM_RPC_URL ?? spokeCfg.rpcUrl) as `http${string}`;

console.log(`[evm] using spoke chain ${SPOKE_CHAIN_KEY} (chainId ${spokeCfg.chain.chainId}) rpc=${RPC_URL}`);

const walletProvider = new EvmWalletProvider({
  privateKey: PRIVATE_KEY as Hex,
  chainId: SPOKE_CHAIN_KEY,
  rpcUrl: RPC_URL,
});

const sodax = new Sodax();

const supportedTokens = spokeCfg.supportedTokens;
type ChainSymbol = keyof typeof supportedTokens;

function resolveToken(symbol: string): { address: Address; decimals: number; symbol: string } {
  const key = symbol as ChainSymbol;
  const token = supportedTokens[key];
  if (!token) {
    throw new Error(
      `Unknown token symbol "${symbol}" on ${SPOKE_CHAIN_KEY}. Known: ${Object.keys(supportedTokens).join(', ')}`,
    );
  }
  return { address: token.address as Address, decimals: token.decimals, symbol: token.symbol };
}

async function showAddress(): Promise<void> {
  const address = await walletProvider.getWalletAddress();
  console.log('[address]', address);
}

function listBridgeTargets(srcSymbol: string): void {
  const srcToken = resolveToken(srcSymbol);
  console.log(`[bridge-targets] ${srcToken.symbol} on ${SPOKE_CHAIN_KEY} (${srcToken.address})`);
  console.log('chains where the same hub vault is available:');
  let found = 0;
  for (const dstChainKey of supportedSpokeChains) {
    if (dstChainKey === SPOKE_CHAIN_KEY) continue;
    const result = sodax.bridge.getBridgeableTokens(SPOKE_CHAIN_KEY, dstChainKey, srcToken.address);
    if (!result.ok || result.value.length === 0) continue;
    for (const dstToken of result.value) {
      console.log(`  ${dstChainKey.padEnd(20)} ${dstToken.symbol.padEnd(10)} ${dstToken.address}`);
      found++;
    }
  }
  if (found === 0) {
    console.log('  (none — this token has no bridgeable counterpart on other spoke chains)');
  }
}

function resolveDstToken(dstChainKey: SpokeChainKey, dstSymbolOrAddress: string): string {
  if (dstSymbolOrAddress.startsWith('0x')) return dstSymbolOrAddress;
  const dstChainConfig = spokeChainConfig[dstChainKey];
  if (!dstChainConfig) throw new Error(`Unknown destination chain: ${dstChainKey}`);
  const tokens = dstChainConfig.supportedTokens as Record<string, { address: string }>;
  const entry = tokens[dstSymbolOrAddress];
  if (!entry) {
    throw new Error(
      `Token "${dstSymbolOrAddress}" not configured on ${dstChainKey}. Known: ${Object.keys(tokens).join(', ')}. Pass a 0x-address instead to bypass symbol lookup.`,
    );
  }
  return entry.address;
}

async function bridge(
  srcSymbol: string,
  dstChainKey: SpokeChainKey,
  dstSymbolOrAddress: string,
  rawAmount: bigint,
  recipientArg?: string,
): Promise<void> {
  const srcToken = resolveToken(srcSymbol);
  const dstTokenAddress = resolveDstToken(dstChainKey, dstSymbolOrAddress);

  const srcAddress = (await walletProvider.getWalletAddress()) as Address;
  const recipient = recipientArg ?? srcAddress;

  console.log(
    `[bridge] ${rawAmount.toString()} ${srcToken.symbol} from ${SPOKE_CHAIN_KEY} → ${dstTokenAddress} on ${dstChainKey} → ${recipient}`,
  );

  const result = await sodax.bridge.bridge({
    params: {
      srcChainKey: SPOKE_CHAIN_KEY,
      srcAddress,
      srcToken: srcToken.address,
      amount: rawAmount,
      dstChainKey,
      dstToken: dstTokenAddress,
      recipient,
    },
    walletProvider,
  });

  if (!result.ok) {
    console.error('[bridge] failed:', result.error);
    return;
  }
  console.log('[bridge] srcTx', result.value.srcChainTxHash);
  console.log('[bridge] dstTx', result.value.dstChainTxHash);
}

async function supply(symbol: string, amount: bigint): Promise<void> {
  const { address: token } = resolveToken(symbol);
  const srcAddress = (await walletProvider.getWalletAddress()) as Address;

  const allowance = await sodax.moneyMarket.isAllowanceValid({
    params: { srcChainKey: SPOKE_CHAIN_KEY, srcAddress, token, amount, action: 'supply' },
  });
  if (!allowance.ok) {
    console.error('[supply] allowance check failed:', allowance.error);
    return;
  }
  if (!allowance.value) {
    console.log('[supply] approving…');
    const approveResult = await sodax.moneyMarket.approve({
      params: { srcChainKey: SPOKE_CHAIN_KEY, srcAddress, token, amount, action: 'supply' },
      walletProvider,
    });
    if (!approveResult.ok) {
      console.error('[supply] approve failed:', approveResult.error);
      return;
    }
    await walletProvider.waitForTransactionReceipt(approveResult.value as Hash);
    console.log('[supply] approved');
  }

  const result = await sodax.moneyMarket.supply({
    params: { srcChainKey: SPOKE_CHAIN_KEY, srcAddress, token, amount, action: 'supply' },
    walletProvider,
  });
  if (!result.ok) {
    console.error('[supply] failed:', result.error);
    return;
  }
  console.log('[supply] srcTx', result.value.srcChainTxHash);
  console.log('[supply] dstTx', result.value.dstChainTxHash);
}

async function borrow(symbol: string, amount: bigint): Promise<void> {
  const { address: token } = resolveToken(symbol);
  const srcAddress = (await walletProvider.getWalletAddress()) as Address;

  const result = await sodax.moneyMarket.borrow({
    params: { srcChainKey: SPOKE_CHAIN_KEY, srcAddress, token, amount, action: 'borrow' },
    walletProvider,
  });
  if (!result.ok) {
    console.error('[borrow] failed:', result.error);
    return;
  }
  console.log('[borrow] srcTx', result.value.srcChainTxHash);
  console.log('[borrow] dstTx', result.value.dstChainTxHash);
}

async function withdraw(symbol: string, amount: bigint): Promise<void> {
  const { address: token } = resolveToken(symbol);
  const srcAddress = (await walletProvider.getWalletAddress()) as Address;

  const result = await sodax.moneyMarket.withdraw({
    params: { srcChainKey: SPOKE_CHAIN_KEY, srcAddress, token, amount, action: 'withdraw' },
    walletProvider,
  });
  if (!result.ok) {
    console.error('[withdraw] failed:', result.error);
    return;
  }
  console.log('[withdraw] srcTx', result.value.srcChainTxHash);
  console.log('[withdraw] dstTx', result.value.dstChainTxHash);
}

async function repay(symbol: string, amount: bigint): Promise<void> {
  const { address: token } = resolveToken(symbol);
  const srcAddress = (await walletProvider.getWalletAddress()) as Address;

  const allowance = await sodax.moneyMarket.isAllowanceValid({
    params: { srcChainKey: SPOKE_CHAIN_KEY, srcAddress, token, amount, action: 'repay' },
  });
  if (!allowance.ok) {
    console.error('[repay] allowance check failed:', allowance.error);
    return;
  }
  if (!allowance.value) {
    const approveResult = await sodax.moneyMarket.approve({
      params: { srcChainKey: SPOKE_CHAIN_KEY, srcAddress, token, amount, action: 'repay' },
      walletProvider,
    });
    if (!approveResult.ok) {
      console.error('[repay] approve failed:', approveResult.error);
      return;
    }
    await walletProvider.waitForTransactionReceipt(approveResult.value as Hash);
    console.log('[repay] approved');
  }

  const result = await sodax.moneyMarket.repay({
    params: { srcChainKey: SPOKE_CHAIN_KEY, srcAddress, token, amount, action: 'repay' },
    walletProvider,
  });
  if (!result.ok) {
    console.error('[repay] failed:', result.error);
    return;
  }
  console.log('[repay] srcTx', result.value.srcChainTxHash);
  console.log('[repay] dstTx', result.value.dstChainTxHash);
}

function printUsage(): void {
  console.log('Usage: EVM_SPOKE_CHAIN_KEY=<chainKey> pnpm evm <action> [args...]');
  console.log('Actions:');
  console.log('  address                                            show wallet address');
  console.log('  bridge-targets <symbol>                            list chains+tokens that share the vault');
  console.log('  bridge <srcSym> <dstChainKey> <dstSymOrAddress> <amount> [recipient]');
  console.log('  supply <symbol> <amount>                           money market supply');
  console.log('  borrow <symbol> <amount>                           money market borrow');
  console.log('  withdraw <symbol> <amount>                         money market withdraw');
  console.log('  repay <symbol> <amount>                            money market repay');
  console.log(`Supported EVM spoke chains: ${[...EVM_SPOKE_ONLY_CHAIN_KEYS_SET].join(', ')}`);
  console.log(`Known tokens on ${SPOKE_CHAIN_KEY}: ${Object.keys(supportedTokens).join(', ')}`);
}

async function main(): Promise<void> {
  const [action, ...rest] = process.argv.slice(2);
  switch (action) {
    case 'address':
      await showAddress();
      return;
    case 'bridge-targets': {
      const [symbol] = rest;
      if (!symbol) {
        printUsage();
        process.exit(1);
      }
      listBridgeTargets(symbol);
      return;
    }
    case 'bridge': {
      const [srcSym, dstChainKey, dstSym, amount, recipient] = rest;
      if (!srcSym || !dstChainKey || !dstSym || !amount) {
        printUsage();
        process.exit(1);
      }
      await bridge(srcSym, dstChainKey as SpokeChainKey, dstSym, BigInt(amount), recipient);
      return;
    }
    case 'supply': {
      const [symbol, amount] = rest;
      if (!symbol || !amount) {
        printUsage();
        process.exit(1);
      }
      await supply(symbol, BigInt(amount));
      return;
    }
    case 'borrow': {
      const [symbol, amount] = rest;
      if (!symbol || !amount) {
        printUsage();
        process.exit(1);
      }
      await borrow(symbol, BigInt(amount));
      return;
    }
    case 'withdraw': {
      const [symbol, amount] = rest;
      if (!symbol || !amount) {
        printUsage();
        process.exit(1);
      }
      await withdraw(symbol, BigInt(amount));
      return;
    }
    case 'repay': {
      const [symbol, amount] = rest;
      if (!symbol || !amount) {
        printUsage();
        process.exit(1);
      }
      await repay(symbol, BigInt(amount));
      return;
    }
    default:
      printUsage();
      process.exit(action ? 1 : 0);
  }
}

await main();
