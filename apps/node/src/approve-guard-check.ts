// Read-only check for the USDT-class approve guard, run against a live chain.
//
// Tokens of the 2017 TetherToken lineage reject an allowance change from one non-zero value to
// another, so a wallet holding a stale allowance can never approve — every retry reverts with empty
// data. `Erc20Service.planApproval` detects that behaviourally (it simulates the approve rather than
// consulting a token list), and this script runs the real planner against a real chain so the
// verdict can be checked without trusting a mock.
//
// Two modes:
//
//   1. `--owner <address>` runs the shipped planner against that wallet. Authoritative, but it can
//      only reach a verdict when the wallet already holds a non-zero allowance — the guard cannot
//      trigger otherwise.
//   2. Without `--owner` (or when that wallet has nothing approved) it falls back to a synthetic
//      probe: `eth_call` with a state override plants a stale allowance, then simulates the approve
//      against it. This is the mode that answers "is this token guarded?" for a token nobody has
//      approved yet — the case when one is about to be listed. Needs an RPC that supports state
//      overrides; some public endpoints do not.
//
// No private key, no gas, no state change.
//
// Run:
//   pnpm --filter node approve-guard-check -- --chain ethereum --token 0xdAC1…
//   pnpm --filter node approve-guard-check -- --chain ethereum --token 0xdAC1… --owner 0xd1ff…
//
// `--rpc` overrides the packaged endpoint for an EVM spoke — the public defaults rate-limit, and a
// throttled node makes the planner report `allowance-read-failed` instead of a real verdict.

import { Erc20Service, Sodax, isHubChainKeyType, isEvmSpokeOnlyChainKeyType } from '@sodax/sdk';
import type { Address, EvmSpokeOnlyChainKey, Hex, SpokeChainKey } from '@sodax/types';
import {
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  keccak256,
  pad,
  toHex,
  type PublicClient,
  type StateOverride,
} from 'viem';

// Addresses with no on-chain meaning: the synthetic probe never touches real state.
const SYNTHETIC_OWNER = '0x1111111111111111111111111111111111111111' as Address;
const SYNTHETIC_SPENDER = '0x2222222222222222222222222222222222222222' as Address;
const PLANTED_ALLOWANCE = 1_000n;
const PROBE_AMOUNT = 5_000n;
/**
 * How far to search for the allowance mapping's declaration slot. OpenZeppelin puts it at 1 and
 * TetherToken at 5, but a proxy with a long inherited prefix (several bridged L2 tokens) pushes it
 * well past 20 — a range that is too short reports "inconclusive" on a perfectly ordinary token.
 */
const MAX_DECLARATION_SLOT = 60;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function requireArg(name: string): string {
  const value = arg(name);
  if (!value) {
    console.error(`Missing --${name}. Usage: --chain <chainKey> --token <address> [--owner <address>]`);
    process.exit(1);
  }
  return value;
}

/** Storage key of `allowance[SYNTHETIC_OWNER][SYNTHETIC_SPENDER]` for a mapping declared at `slot`. */
function allowanceStorageKey(slot: number): Hex {
  const ownerKey = keccak256(
    encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [SYNTHETIC_OWNER, BigInt(slot)]),
  );
  return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [SYNTHETIC_SPENDER, ownerKey]));
}

/**
 * Find which declaration slot backs the allowance mapping, by planting a value and reading it back.
 *
 * The layout differs per implementation and a proxy hides it entirely, so it is discovered rather
 * than assumed.
 */
async function findAllowanceOverride(publicClient: PublicClient, token: Address): Promise<StateOverride | null> {
  for (let slot = 0; slot <= MAX_DECLARATION_SLOT; slot++) {
    const override: StateOverride = [
      {
        address: token,
        stateDiff: [{ slot: allowanceStorageKey(slot), value: pad(toHex(PLANTED_ALLOWANCE), { size: 32 }) }],
      },
    ];

    try {
      const planted = await publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [SYNTHETIC_OWNER, SYNTHETIC_SPENDER],
        stateOverride: override,
      });
      if (planted === PLANTED_ALLOWANCE) return override;
    } catch {
      // Either the RPC rejects state overrides or this is the wrong slot; the next iteration tells
      // us which, and exhausting the range is reported as inconclusive.
    }
  }

  return null;
}

/**
 * Simulate `approve(spender, amount)` as the synthetic owner, over the planted allowance.
 *
 * Mirrors `Erc20Service.canApprove` but cannot reuse it: that one probes the chain's real state
 * through the planner, this one probes a state override. Keep the two in step — if the planner grows
 * a third probe, this diverges silently.
 */
async function canApprove(
  publicClient: PublicClient,
  token: Address,
  override: StateOverride,
  amount: bigint,
): Promise<boolean> {
  try {
    await publicClient.call({
      account: SYNTHETIC_OWNER,
      to: token,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [SYNTHETIC_SPENDER, amount] }),
      stateOverride: override,
    });
    return true;
  } catch {
    return false;
  }
}

async function checkWithSyntheticAllowance(publicClient: PublicClient, token: Address): Promise<void> {
  const override = await findAllowanceOverride(publicClient, token);
  if (!override) {
    console.log('\nInconclusive: could not plant an allowance.');
    console.log('Either this RPC does not support eth_call state overrides, or the storage layout is unusual.');
    console.log('Retry with --rpc pointing at a node that supports them, or with --owner of a wallet that');
    console.log('already holds a non-zero allowance.');
    return;
  }

  const guarded = !(await canApprove(publicClient, token, override, PROBE_AMOUNT));
  const resetWorks = await canApprove(publicClient, token, override, 0n);

  console.log(`\nsynthetic probe (a stale allowance of ${PLANTED_ALLOWANCE} was planted)`);
  console.log(`approve(non-zero)  ${guarded ? 'REVERTS' : 'ok'}`);
  console.log(`approve(0)         ${resetWorks ? 'ok' : 'REVERTS'}`);

  if (guarded && resetWorks) {
    console.log('\nGUARDED. Every approval over an existing allowance costs two transactions.');
    console.log('The SDK handles it — planApproval emits the reset automatically. Note it in the PR.');
  } else if (guarded) {
    console.log('\nBoth simulations revert. The token is paused, or the synthetic owner is blocked.');
  } else {
    console.log('\nNot guarded: an allowance can be changed in one transaction.');
  }
}

async function main(): Promise<void> {
  const chainKey = requireArg('chain') as SpokeChainKey;
  const token = requireArg('token') as Address;
  const owner = arg('owner') as Address | undefined;

  const sodax = new Sodax();

  if (!isHubChainKeyType(chainKey) && !isEvmSpokeOnlyChainKeyType(chainKey)) {
    console.error(`${chainKey} is not an EVM chain — the approve guard is an ERC-20 concern.`);
    process.exit(1);
  }

  const chainConfig = sodax.config.getChainConfig(chainKey);
  // Default to the spender every SODAX approval targets on a spoke, which is what a stuck user hit.
  const spender = (arg('spender') ?? chainConfig.addresses.assetManager) as Address;
  const amount = BigInt(arg('amount') ?? 1_000_000n);

  const rpcUrl = arg('rpc');
  if (rpcUrl && isHubChainKeyType(chainKey)) {
    console.warn('--rpc is only wired for EVM spokes; using the packaged hub endpoint.');
  }

  const publicClient = isHubChainKeyType(chainKey)
    ? sodax.spoke.sonic.publicClient
    : sodax.spoke.evm.constructPublicClient({ chainId: chainKey as EvmSpokeOnlyChainKey, rpcUrl });

  console.log(`chain      ${chainKey}`);
  console.log(`token      ${token}`);
  console.log(`spender    ${spender}`);

  if (!owner) {
    await checkWithSyntheticAllowance(publicClient, token);
    return;
  }

  const allowance = await Erc20Service.getAllowance({ token, owner, spender, publicClient });
  const plan = await Erc20Service.planApproval({
    token,
    owner,
    spender,
    amount,
    nativeToken: chainConfig.nativeToken as Address,
    publicClient,
  });

  console.log(`owner      ${owner}`);
  console.log(`amount     ${amount}`);
  console.log(`allowance  ${allowance}`);
  console.log(
    `plan       ${plan.resetAmount === undefined ? `1 transaction — approve ${plan.approveAmount}` : `2 transactions — reset ${plan.resetAmount} then approve ${plan.approveAmount}`}`,
  );
  console.log(`reason     ${plan.reason}`);

  if (plan.reason === 'reset-required') {
    console.log('\nGuarded token: the allowance must be zeroed before it can be set again.');
    return;
  }
  if (plan.reason === 'reset-not-viable') {
    console.log('\nThe approve reverts and approve(0) reverts too — the token is paused, or the owner is blocked.');
    return;
  }
  if (allowance === 0n) {
    // The wallet has nothing approved, so the real planner cannot reach a verdict about the token.
    console.log('\nThis wallet has nothing approved, so the guard cannot trigger for it.');
    await checkWithSyntheticAllowance(publicClient, token);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
