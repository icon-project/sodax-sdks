/**
 * Sequential CLI for the leverage-yield SDK module on Sonic.
 *
 * Mirrors the vault.js smoke-test harness in `leverage-yield-test/`, but driven through
 * the public `Sodax.leverageYield` API instead of raw ethers contract calls. One
 * subcommand per testable surface; `help` prints the full reference.
 *
 * Required env (loaded via dotenv):
 *   PRIVATE_KEY          hex private key (same key on spoke + hub)
 *
 * Optional env:
 *   SPOKE_CHAIN_KEY      Sodax spoke chain key (default: '0xa4b1.arbitrum')
 *   SPOKE_TOKEN          Spoke-side asset address (default: Arbitrum weETH)
 *   SPOKE_RPC            Spoke RPC URL — defaults to a public RPC for the active
 *                        SPOKE_CHAIN_KEY (Arbitrum/Avalanche/Base/Optimism/Polygon/BSC).
 *                        Set this to your own provider for sustained testing — public
 *                        RPCs throttle aggressively.
 *   SONIC_RPC            hub RPC override (default: https://rpc.soniclabs.com)
 *
 * Vault selection:
 *   Vaults come from the @sodax/types registry (`leverageYieldVaults`). Default is the
 *   first registered vault; override with `--vault <name>` on any subcommand.
 *
 * Run via the workspace script:
 *   pnpm --filter node leverage-yield <subcommand> [args...] [--vault <name>]
 */

import 'dotenv/config';
import { type Address, type Hex, formatUnits } from 'viem';
import {
  ChainKeys,
  type EvmChainKey,
  Sodax,
  type SpokeChainKey,
} from '@sodax/sdk';
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';

// ─── Env / clients ────────────────────────────────────────────────────────

const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex | undefined;
const SPOKE_CHAIN_KEY = (process.env.SPOKE_CHAIN_KEY ?? ChainKeys.ARBITRUM_MAINNET) as SpokeChainKey;
const SPOKE_TOKEN = (process.env.SPOKE_TOKEN ?? '0x35751007a407ca6FEFfE80b3cB397736D2cf4dbe') as Address;

if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY missing in .env');
if (!PRIVATE_KEY.startsWith('0x')) throw new Error('PRIVATE_KEY must start with 0x');

// RPCs come from the per-chain `rpcUrl` shipped in `@sodax/types` (`spokeChainConfig`).
// Override via SPOKE_RPC / SONIC_RPC env vars only when you need a custom provider —
// public defaults rate-limit aggressively but are fine for smoke tests.
const sodax = new Sodax();
const SPOKE_RPC = (process.env.SPOKE_RPC ??
  sodax.config.getChainConfig(SPOKE_CHAIN_KEY as EvmChainKey).rpcUrl) as `http${string}` | undefined;
const SONIC_RPC = (process.env.SONIC_RPC ??
  sodax.config.getChainConfig(ChainKeys.SONIC_MAINNET).rpcUrl) as `http${string}`;

const spokeWalletProvider = SPOKE_RPC
  ? new EvmWalletProvider({
      privateKey: PRIVATE_KEY,
      chainId: SPOKE_CHAIN_KEY as EvmChainKey,
      rpcUrl: SPOKE_RPC,
    })
  : undefined;

const hubWalletProvider = new EvmWalletProvider({
  privateKey: PRIVATE_KEY,
  chainId: ChainKeys.SONIC_MAINNET,
  rpcUrl: SONIC_RPC,
});

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmt(value: bigint | undefined, decimals = 18, digits = 6): string {
  if (value === undefined || value === null) return '—';
  const s = formatUnits(value, decimals);
  const [int, frac = ''] = s.split('.');
  return `${int}.${frac.slice(0, digits).padEnd(digits, '0')}`;
}

function bps(value: bigint): string {
  return `${(Number(value) / 100).toFixed(2)}% (${value.toString()} bps)`;
}

function hf(value: bigint): string {
  // type(uint256).max → infinite (no debt)
  const MAX = (1n << 256n) - 1n;
  if (value >= MAX - 1n) return '∞ (no debt)';
  return formatUnits(value, 18);
}

/**
 * Strips `--vault <name>` (and `--hub`) flags from the positional arg list and resolves
 * the target vault. Resolution order:
 *   1. `--vault <name>` flag → registry lookup by `name`
 *   2. first vault in `sodax.leverageYield.listVaults()`
 * Returns the vault address plus the cleaned positional args.
 */
function resolveVault(args: string[]): { address: Address; rest: string[] } {
  const rest: string[] = [];
  let vaultName: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--vault') {
      vaultName = args[++i];
    } else {
      rest.push(a as string);
    }
  }
  const vaults = sodax.leverageYield.listVaults();
  if (vaults.length === 0) {
    throw new Error('No leverage vaults registered in @sodax/types — populate `leverageYieldVaults`');
  }
  if (vaultName) {
    const found = sodax.leverageYield.getVault(vaultName);
    if (!found) {
      const known = vaults.map(v => v.name).join(', ');
      throw new Error(`Vault '${vaultName}' not in registry. Known: ${known}`);
    }
    return { address: found.vault, rest };
  }
  if (vaults.length > 1) {
    const known = vaults.map(v => v.name).join(', ');
    throw new Error(
      `Multiple vaults registered (${vaults.length}); pass --vault <name>. Known: ${known}`,
    );
  }
  return { address: vaults[0].vault, rest };
}

function requireSpokeWallet(): EvmWalletProvider {
  if (!spokeWalletProvider) {
    throw new Error('SPOKE_RPC not set in .env — cross-chain commands need spoke chain access');
  }
  return spokeWalletProvider;
}

function parseAmount(arg: string | undefined): bigint {
  if (!arg) throw new Error('amount argument required (e.g. 0.01)');
  // parseEther equivalent — no viem.parseEther import to keep deps light.
  const [int, frac = ''] = arg.split('.');
  const fracPadded = `${frac}${'0'.repeat(18)}`.slice(0, 18);
  return BigInt(`${int}${fracPadded}`);
}

// ─── Commands ─────────────────────────────────────────────────────────────

async function cmdHelp(): Promise<void> {
  console.log(`
  leverage-yield CLI — exercises sodax.leverageYield via the SDK.

  Reads PRIVATE_KEY, SPOKE_RPC, SPOKE_CHAIN_KEY, SPOKE_TOKEN, SONIC_RPC from .env.
  Vaults are resolved from the @sodax/types registry; default = first registered.
  Override per-command with \`--vault <name>\` (see \`list-vaults\` for known names).

  USAGE
    pnpm --filter node leverage-yield <command> [args] [--vault <name>]

  READ-ONLY
    list-vaults                              show registered vaults
    hub-wallet                               print derived hub wallet for signer
    status                                   signer + hub wallet + position snapshot
    position                                 getPosition()
    max-withdraw [--hub]                     getMaxWithdraw for signer (or --hub for hub wallet)
    preview-deposit <amount>                 shares minted for an asset deposit
    preview-withdraw <amount>                shares burned for an asset withdrawal

  CROSS-CHAIN (spoke ↔ Sonic)
    xdeposit <amount>                        bridge SPOKE_TOKEN from SPOKE_CHAIN_KEY into vault
    xwithdraw <amount>                       withdraw vault assets and bridge back to SPOKE_CHAIN_KEY

  SONIC-DIRECT (signer already holds vault asset on hub)
    deposit <amount>                         vault.deposit
    withdraw <amount>                        vault.withdraw
    approve <amount>                         ERC20 approve of vault.asset() to vault
    is-allowance-valid <amount>              check signer's allowance covers amount

  EXAMPLES
    pnpm --filter node leverage-yield list-vaults
    pnpm --filter node leverage-yield status
    pnpm --filter node leverage-yield xdeposit 0.01
    pnpm --filter node leverage-yield xdeposit 0.01 --vault weETH-leveraged
    pnpm --filter node leverage-yield max-withdraw --hub
    pnpm --filter node leverage-yield xwithdraw 0.005
`);
}

async function cmdListVaults(): Promise<void> {
  const vaults = sodax.leverageYield.listVaults();
  if (vaults.length === 0) {
    console.log('No vaults registered.');
    return;
  }
  for (const v of vaults) {
    console.log(`  ${v.name}`);
    console.log(`    vault:        ${v.vault}`);
    console.log(`    asset:        ${v.asset}`);
    console.log(`    borrowToken:  ${v.borrowToken}`);
  }
}

async function cmdHubWallet(): Promise<void> {
  const signer = await hubWalletProvider.getWalletAddress();
  const hub = await sodax.hubProvider.getUserHubWalletAddress(signer, SPOKE_CHAIN_KEY);
  console.log(`signer:     ${signer}`);
  console.log(`spoke key:  ${SPOKE_CHAIN_KEY}`);
  console.log(`hub wallet: ${hub}`);
}

async function cmdPosition(args: string[]): Promise<void> {
  const { address: vault } = resolveVault(args);
  const result = await sodax.leverageYield.getPosition(vault);
  if (!result.ok) {
    console.error('[position] error:', result.error.toJSON());
    return;
  }
  const { collateral, debt, ltv, healthFactor, idleAsset } = result.value;
  console.log(`collateral:    ${fmt(collateral)}`);
  console.log(`debt:          ${fmt(debt)}`);
  console.log(`LTV:           ${bps(ltv)}`);
  console.log(`healthFactor:  ${hf(healthFactor)}`);
  console.log(`idleAsset:     ${fmt(idleAsset)}`);
}

async function cmdMaxWithdraw(args: string[]): Promise<void> {
  // max-withdraw [--vault <name>] [--hub]
  const { address: vault, rest } = resolveVault(args);
  const useHub = rest.includes('--hub');

  const signer = await hubWalletProvider.getWalletAddress();
  let owner: Address = signer;
  if (useHub) {
    owner = await sodax.hubProvider.getUserHubWalletAddress(signer, SPOKE_CHAIN_KEY);
  }

  const result = await sodax.leverageYield.getMaxWithdraw(vault, owner);
  if (!result.ok) {
    console.error('[max-withdraw] error:', result.error.toJSON());
    return;
  }
  console.log(`maxWithdraw(${owner}) = ${fmt(result.value)} (${result.value.toString()} wei)`);
}

async function cmdPreviewDeposit(args: string[]): Promise<void> {
  const { address: vault, rest } = resolveVault(args);
  const assets = parseAmount(rest[0]);
  const result = await sodax.leverageYield.previewDeposit(vault, assets);
  if (!result.ok) {
    console.error('[preview-deposit] error:', result.error.toJSON());
    return;
  }
  console.log(`previewDeposit(${fmt(assets)}) = ${fmt(result.value)} shares`);
}

async function cmdPreviewWithdraw(args: string[]): Promise<void> {
  const { address: vault, rest } = resolveVault(args);
  const assets = parseAmount(rest[0]);
  const result = await sodax.leverageYield.previewWithdraw(vault, assets);
  if (!result.ok) {
    console.error('[preview-withdraw] error:', result.error.toJSON());
    return;
  }
  console.log(`previewWithdraw(${fmt(assets)}) = ${fmt(result.value)} shares`);
}

async function cmdStatus(args: string[]): Promise<void> {
  const { address: vault } = resolveVault(args);
  const signer = await hubWalletProvider.getWalletAddress();
  const hub = await sodax.hubProvider.getUserHubWalletAddress(signer, SPOKE_CHAIN_KEY);

  console.log('─── Wallet ───');
  console.log(`  signer:           ${signer}`);
  console.log(`  spoke key:        ${SPOKE_CHAIN_KEY}`);
  console.log(`  hub wallet:       ${hub}`);
  console.log();

  console.log('─── Vault ───');
  console.log(`  vault:            ${vault}`);
  const assetResult = await sodax.leverageYield.getAsset(vault);
  if (assetResult.ok) console.log(`  asset:            ${assetResult.value}`);

  const posResult = await sodax.leverageYield.getPosition(vault);
  if (posResult.ok) {
    const { collateral, debt, ltv, healthFactor, idleAsset } = posResult.value;
    console.log(`  collateral:       ${fmt(collateral)}`);
    console.log(`  debt:             ${fmt(debt)}`);
    console.log(`  idle asset:       ${fmt(idleAsset)}`);
    console.log(`  LTV:              ${bps(ltv)}`);
    console.log(`  health factor:    ${hf(healthFactor)}`);
  } else {
    console.error('  getPosition error:', posResult.error.message);
  }

  const maxSigner = await sodax.leverageYield.getMaxWithdraw(vault, signer);
  if (maxSigner.ok) console.log(`  signer maxWithdraw:    ${fmt(maxSigner.value)}`);
  const maxHub = await sodax.leverageYield.getMaxWithdraw(vault, hub);
  if (maxHub.ok) console.log(`  hub-wallet maxWithdraw: ${fmt(maxHub.value)}`);
}

// ─── Cross-chain ──────────────────────────────────────────────────────────

async function cmdXDeposit(args: string[]): Promise<void> {
  const wallet = requireSpokeWallet();
  const { address: vault, rest } = resolveVault(args);
  const amount = parseAmount(rest[0]);
  const signer = await wallet.getWalletAddress();

  console.log(`xdeposit ${fmt(amount)} of ${SPOKE_TOKEN} from ${SPOKE_CHAIN_KEY} into vault ${vault}`);
  console.log(`  signer: ${signer}`);

  const xdepositParams = {
    raw: false as const,
    walletProvider: wallet,
    params: {
      vault,
      srcChainKey: SPOKE_CHAIN_KEY,
      srcAddress: signer,
      srcToken: SPOKE_TOKEN,
      amount,
    },
  };

  // Pre-flight: ensure the spoke asset manager is approved to pull `amount` of `srcToken`.
  // Without this, the spoke tx reverts with "ERC20: transfer amount exceeds allowance".
  const allowance = await sodax.leverageYield.isXDepositAllowanceValid(xdepositParams);
  if (!allowance.ok) {
    console.error('[xdeposit] allowance check failed:', allowance.error.toJSON());
    process.exitCode = 1;
    return;
  }
  if (!allowance.value) {
    console.log('  approving spoke asset manager...');
    const approveResult = await sodax.leverageYield.xdepositApprove(xdepositParams);
    if (!approveResult.ok) {
      console.error('[xdeposit] approve failed:', approveResult.error.toJSON());
      process.exitCode = 1;
      return;
    }
    console.log(`  ✓ approve tx: ${approveResult.value as string}`);
    await wallet.waitForTransactionReceipt(approveResult.value as Hex);
    // small settle delay; some RPCs lag behind the receipt for state reads
    await new Promise(r => setTimeout(r, 2000));
  } else {
    console.log('  allowance OK, skipping approve');
  }

  const result = await sodax.leverageYield.xdeposit(xdepositParams);

  if (!result.ok) {
    console.error('[xdeposit] error:', result.error.toJSON());
    process.exitCode = 1;
    return;
  }
  console.log(`  ✓ srcChainTxHash: ${result.value.srcChainTxHash}`);
  console.log(`  ✓ dstChainTxHash: ${result.value.dstChainTxHash}`);
}

async function cmdXWithdraw(args: string[]): Promise<void> {
  const wallet = requireSpokeWallet();
  const { address: vault, rest } = resolveVault(args);
  const amount = parseAmount(rest[0]);
  const signer = await wallet.getWalletAddress();

  console.log(`xwithdraw ${fmt(amount)} of vault asset (sodaWEETH) → ${SPOKE_TOKEN} on ${SPOKE_CHAIN_KEY}`);
  console.log(`  signer: ${signer}`);

  // Pre-flight: show the on-chain max for the user's hub wallet.
  const maxResult = await sodax.leverageYield.getMaxWithdrawForUser(vault, SPOKE_CHAIN_KEY, signer);
  if (maxResult.ok) {
    console.log(`  hub-wallet maxWithdraw: ${fmt(maxResult.value)} (${maxResult.value.toString()})`);
    if (amount > maxResult.value) {
      console.warn(`  ⚠ amount ${fmt(amount)} exceeds maxWithdraw — call may revert; deleverage required first`);
    }
  }

  const result = await sodax.leverageYield.xwithdraw({
    raw: false,
    walletProvider: wallet,
    params: {
      vault,
      srcChainKey: SPOKE_CHAIN_KEY,
      srcAddress: signer,
      dstToken: SPOKE_TOKEN,
      amount,
    },
  });

  if (!result.ok) {
    console.error('[xwithdraw] error:', result.error.toJSON());
    process.exitCode = 1;
    return;
  }
  console.log(`  ✓ srcChainTxHash: ${result.value.srcChainTxHash}`);
  console.log(`  ✓ dstChainTxHash: ${result.value.dstChainTxHash}`);
}

// ─── Sonic-direct ─────────────────────────────────────────────────────────

async function cmdDirectDeposit(args: string[]): Promise<void> {
  const { address: vault, rest } = resolveVault(args);
  const assets = parseAmount(rest[0]);
  const receiver = (await hubWalletProvider.getWalletAddress()) as Address;

  console.log(`deposit ${fmt(assets)} of vault asset to vault ${vault} (receiver=${receiver})`);
  const result = await sodax.leverageYield.deposit({
    vault,
    assets,
    receiver,
    walletProvider: hubWalletProvider,
  });
  if (!result.ok) {
    console.error('[deposit] error:', result.error.toJSON());
    process.exitCode = 1;
    return;
  }
  console.log(`  ✓ txHash: ${result.value as string}`);
}

async function cmdDirectWithdraw(args: string[]): Promise<void> {
  const { address: vault, rest } = resolveVault(args);
  const assets = parseAmount(rest[0]);
  const owner = (await hubWalletProvider.getWalletAddress()) as Address;
  const receiver = owner;

  console.log(`withdraw ${fmt(assets)} from vault ${vault} (owner=${owner})`);
  const result = await sodax.leverageYield.withdraw({
    vault,
    assets,
    receiver,
    owner,
    walletProvider: hubWalletProvider,
  });
  if (!result.ok) {
    console.error('[withdraw] error:', result.error.toJSON());
    process.exitCode = 1;
    return;
  }
  console.log(`  ✓ txHash: ${result.value as string}`);
}

async function cmdApprove(args: string[]): Promise<void> {
  const { address: vault, rest } = resolveVault(args);
  const amount = parseAmount(rest[0]);
  console.log(`approve ${fmt(amount)} of vault.asset() → ${vault}`);
  const result = await sodax.leverageYield.approve({
    vault,
    amount,
    walletProvider: hubWalletProvider,
  });
  if (!result.ok) {
    console.error('[approve] error:', result.error.toJSON());
    process.exitCode = 1;
    return;
  }
  console.log(`  ✓ txHash: ${result.value as string}`);
}

async function cmdIsAllowanceValid(args: string[]): Promise<void> {
  const { address: vault, rest } = resolveVault(args);
  const amount = parseAmount(rest[0]);
  const owner = (await hubWalletProvider.getWalletAddress()) as Address;
  const result = await sodax.leverageYield.isAllowanceValid({ vault, amount, owner });
  if (!result.ok) {
    console.error('[is-allowance-valid] error:', result.error.toJSON());
    process.exitCode = 1;
    return;
  }
  console.log(`isAllowanceValid(owner=${owner}, amount=${fmt(amount)}) = ${result.value}`);
}

// ─── Dispatcher ───────────────────────────────────────────────────────────

const COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  help: cmdHelp,
  '--help': cmdHelp,
  '-h': cmdHelp,
  'list-vaults': cmdListVaults,
  'hub-wallet': cmdHubWallet,
  status: cmdStatus,
  position: cmdPosition,
  'max-withdraw': cmdMaxWithdraw,
  'preview-deposit': cmdPreviewDeposit,
  'preview-withdraw': cmdPreviewWithdraw,
  xdeposit: cmdXDeposit,
  xwithdraw: cmdXWithdraw,
  deposit: cmdDirectDeposit,
  withdraw: cmdDirectWithdraw,
  approve: cmdApprove,
  'is-allowance-valid': cmdIsAllowanceValid,
};

async function main(): Promise<void> {
  const [, , cmd, ...args] = process.argv;
  if (!cmd || !COMMANDS[cmd]) {
    if (cmd) console.error(`Unknown command: ${cmd}\n`);
    await cmdHelp();
    process.exit(cmd ? 1 : 0);
  }
  try {
    await COMMANDS[cmd](args);
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
