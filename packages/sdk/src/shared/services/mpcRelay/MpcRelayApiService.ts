import type { HttpUrl, MpcWithdrawScheme, Result } from '@sodax/types';
import type { Hex } from 'viem';
import { invariant } from '../../utils/tiny-invariant.js';

/**
 * Client for the SODAX **MPC relay** (NEAR chain-signatures relay), used by every chain in
 * `MpcRelayChainMap` — Tron today, with XRP and Aptos settling the same way. Nothing here is
 * chain-specific: the chain only supplies its relay endpoint and numeric id. This is a distinct
 * relay from the intent relay:
 *
 *   intent relay :  spoke.deposit → submitTransaction → waitUntilIntentExecuted
 *   MPC relay    :  getDepositAddress(data) → send memo tx to reserve → notify → poll /deposit/:id
 *
 * The flow, per deposit:
 *   1. {@link getDepositAddress} — register the hub-side `data` (the calls to run after the mint,
 *      e.g. vault deposit) and get back the shared `reserveAddress` + the `memo` (a 32-byte hash)
 *      to attach to the on-chain transfer.
 *   2. The caller sends the spoke transfer to `reserveAddress` carrying `memo`.
 *   3. {@link notify} — tell the relay a deposit tx exists so verifiers pick it up.
 *   4. {@link waitForDeposit} — poll {@link getDeposit} until the hub mint lands (`minted`).
 */

/**
 * Settlement surface a spoke service implements to settle through the MPC relay. `SpokeService`
 * dispatches to this for any chain in `MpcRelayChainMap`, so a new MPC chain (XRP, Aptos) plugs
 * in by implementing these two methods — no feature service learns its name.
 *
 * `tx` is whatever `create*Intent` returned: the spoke tx hash for a deposit, the withdraw
 * `trackingId` for a withdrawal. `timeout` is the caller's budget; an implementation may raise it to
 * a chain-specific floor (its confirmation depth), but should not silently shorten it.
 */
export interface MpcRelaySettlement {
  waitForDeposit(tx: string, timeout?: number): Promise<Result<DepositRecord>>;
  waitForWithdrawal(trackingId: string, timeout?: number): Promise<Result<WithdrawalRecord>>;
}

export type MpcDepositMethod = 'memo' | 'address';

export interface DepositAddressResponse {
  /** Where the user sends funds (shared reserve for memo-mode chains). */
  reserveAddress: string;
  /** 32-byte hash to attach as the transfer memo (memo-mode). */
  memo: Hex;
  /** keccak256(abi.encode(hubWallet, data)) — same value as `memo`. */
  payloadHash: Hex;
  /** MPC derivation path for the deposit. */
  path: string;
  /** Hub-side smart wallet that receives the mint / runs `data`. */
  hubWallet: Hex;
  depositMethod: MpcDepositMethod;
}

/**
 * Deposit ladder, most-advanced stage wins (ingest `deriveDepositStatus`):
 * `pending` (no row yet, also before `/notify` is processed) → `submitted` → `attested` → `minted`
 * → `swept`. There is deliberately no `failed`: a deposit the verifiers drop (unmapped token, no
 * memo, reverted tx) simply never leaves `pending`, so a caller distinguishes failure by timeout.
 */
export type MpcDepositStatus = 'pending' | 'submitted' | 'attested' | 'minted' | 'swept';

export interface DepositRecord {
  depositId: string;
  status: MpcDepositStatus;
  createdAt: number | null;
  txs: {
    source?: { chain: string; hash: string; ts: number };
    nearSubmit?: { chain: string; hash: string; ts: number };
    hubMint?: { chain: string; hash: string; ts: number };
  };
}

export interface NotifyResponse {
  accepted: boolean;
  chain_id?: string;
  tx_hash?: string;
  error?: string;
}

/** Withdraw-auth scheme (per client-api.md §4). Per-chain values live in `MpcRelayChainMap`. */
export type WithdrawScheme = MpcWithdrawScheme;

/** Signed withdraw message as submitted to the ingest (numeric fields are u64 decimal strings). */
export interface WithdrawMessagePayload {
  to: Hex;
  data: Hex;
  nonce: string;
  chainId: string;
  sender: Hex;
}

export interface SubmitWithdrawRequest {
  message: WithdrawMessagePayload;
  signature: Hex;
  scheme: WithdrawScheme;
  /** Required only for schemes that can't recover the identity from the sig (2/3/4). */
  publicKey?: Hex;
}

export interface SubmitWithdrawResponse {
  accepted: boolean;
  /** keccak256(sender ‖ nonce_be8) — the only handle until the burn is mined. */
  trackingId: Hex;
  sender?: Hex;
  nonce?: string;
  hubWallet?: Hex;
  error?: string;
}

/**
 * Withdrawal ladder: `submitted` (accepted, burn not mined — `withdrawalId` is null) → `burned` →
 * `attested` → `released`; or `failed` with an `error` for a deterministic terminal rejection such
 * as a bad signature.
 */
export type WithdrawalStatus = 'submitted' | 'burned' | 'attested' | 'released' | 'failed';

export interface WithdrawalRecord {
  trackingId: Hex;
  withdrawalId?: string;
  status: WithdrawalStatus;
  submittedAt?: number;
  /** Present only on `failed` — the coordinator's reason for the terminal rejection. */
  error?: string;
  txs?: {
    submitMessage?: { chain: string; hash: string; ts: number };
    burn?: { chain: string; hash: string; ts: number };
    release?: { chain: string; hash: string; ts: number };
  };
}

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_DEPOSIT_TIMEOUT_MS = 300_000;

/**
 * Per-request budget, mirroring the intent relay's own cap. It covers the body read as well as the
 * response: a relay can answer headers and then stall the stream, which would otherwise hold a
 * polling loop open indefinitely — the `waitFor*` deadline only bounds the gaps between attempts.
 *
 * Requests are not retried here. `getDeposit`/`getWithdrawal` are retried by their polling loops,
 * and the mutating POSTs (`deposit-address`, `notify`, `withdraw`) are left to the caller for the
 * same reason the intent relay leaves `submit` alone: re-POSTing a delivered request is not safe.
 */
const MPC_RELAY_REQUEST_TIMEOUT_MS = 15_000;

async function getJson<T>(url: string, init?: RequestInit): Promise<Result<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MPC_RELAY_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, error: new Error(`mpc-relay: ${res.status} non-JSON: ${text.slice(0, 160)}`) };
    }
    if (!res.ok) {
      const err = (json as { error?: string })?.error ?? text.slice(0, 160);
      return { ok: false, error: new Error(`mpc-relay: ${res.status} ${err}`) };
    }
    return { ok: true, value: json as T };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: new Error(`mpc-relay: request timed out after ${MPC_RELAY_REQUEST_TIMEOUT_MS}ms`) };
    }
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Register a memo-mode deposit's hub payload and get the reserve + memo to send to.
 * @param owner  Spoke-chain address (its hub wallet is derived from this).
 * @param srcChain  Numeric spoke chain id as a string (e.g. Tron `'728126428'`).
 * @param data  Hub-side calls to execute after the mint, ABI-encoded with `encodeContractCalls`.
 *   For a plain wrapped-token mint pass `encodeContractCalls([])` — an encoded EMPTY call array,
 *   which is still non-empty bytes, and that non-emptiness is what makes the hub deploy the user's
 *   wallet. A literal `'0x'` is accepted by the relay but skips the deployment.
 */
export async function getDepositAddress(
  apiUrl: HttpUrl,
  owner: string,
  srcChain: string,
  data: Hex,
): Promise<Result<DepositAddressResponse>> {
  invariant(owner.length > 0, 'Invalid input parameters. owner empty');
  invariant(srcChain.length > 0, 'Invalid input parameters. srcChain empty');
  return getJson<DepositAddressResponse>(`${apiUrl}/deposit-address`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner, srcChain, data }),
  });
}

/** Notify the relay that a deposit tx exists so verifiers start attesting it. */
export async function notify(apiUrl: HttpUrl, chainId: string, txHash: Hex): Promise<Result<NotifyResponse>> {
  invariant(chainId.length > 0, 'Invalid input parameters. chainId empty');
  invariant(txHash.length > 0, 'Invalid input parameters. txHash empty');
  const res = await getJson<NotifyResponse>(`${apiUrl}/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chain_id: chainId, tx_hash: txHash, type: 'deposit' }),
  });
  if (res.ok && !res.value.accepted) {
    return { ok: false, error: new Error(`mpc-relay: notify rejected: ${res.value.error ?? 'unknown'}`) };
  }
  return res;
}

/** depositId = `${chainId}-${rawTxHashWithout0x}-${logIndex}` (logIndex 0 for a memo transfer). */
export function toDepositId(chainId: string, txHash: string, logIndex = 0): string {
  return `${chainId}-${txHash.replace(/^0x/, '')}-${logIndex}`;
}

export async function getDeposit(apiUrl: HttpUrl, depositId: string): Promise<Result<DepositRecord>> {
  invariant(depositId.length > 0, 'Invalid input parameters. depositId empty');
  return getJson<DepositRecord>(`${apiUrl}/deposit/${encodeURIComponent(depositId)}`);
}

export interface WaitForDepositOptions {
  timeout?: number;
  pollIntervalMs?: number;
}

/** Poll until the deposit reaches `minted` (resolve) or `failed` (reject). */
export async function waitForDeposit(
  apiUrl: HttpUrl,
  depositId: string,
  options: WaitForDepositOptions = {},
): Promise<Result<DepositRecord>> {
  const timeout = options.timeout ?? DEFAULT_DEPOSIT_TIMEOUT_MS;
  const interval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeout;

  for (;;) {
    // No `retry` here: `getDeposit` reports failure in its Result rather than throwing, so a retry
    // wrapper would never fire. This loop IS the retry — it re-polls until the deadline.
    const res = await getDeposit(apiUrl, depositId);
    // `swept` is one rung PAST `minted`: the hub mint landed and the reserve was swept afterwards.
    // Waiting only for `minted` would poll a settled deposit until timeout if a sweep beat the poll.
    if (res.ok && (res.value.status === 'minted' || res.value.status === 'swept')) return res;
    if (Date.now() >= deadline) {
      return { ok: false, error: new Error(`mpc-relay: timed out waiting for deposit ${depositId}`) };
    }
    await new Promise(r => setTimeout(r, interval));
  }
}

/**
 * Submit a signed withdraw-auth message (hub→spoke release). The caller builds and signs the
 * message; this hands it to the relay's withdrawal pipeline (verify → hub burn → MPC-signed release).
 * @returns the `trackingId` (= keccak256(sender ‖ nonce_be8)) to poll {@link waitForWithdrawal} with.
 */
export async function submitWithdraw(
  apiUrl: HttpUrl,
  request: SubmitWithdrawRequest,
): Promise<Result<SubmitWithdrawResponse>> {
  invariant(request.signature.length > 0, 'Invalid input parameters. signature empty');
  const res = await getJson<SubmitWithdrawResponse>(`${apiUrl}/withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (res.ok && !res.value.accepted) {
    return { ok: false, error: new Error(`mpc-relay: withdraw rejected: ${res.value.error ?? 'unknown'}`) };
  }
  return res;
}

export async function getWithdrawal(apiUrl: HttpUrl, trackingId: string): Promise<Result<WithdrawalRecord>> {
  invariant(trackingId.length > 0, 'Invalid input parameters. trackingId empty');
  return getJson<WithdrawalRecord>(`${apiUrl}/withdrawal/${encodeURIComponent(trackingId)}`);
}

/** Poll until the withdrawal reaches `released` (resolve) or `failed` (reject). */
export async function waitForWithdrawal(
  apiUrl: HttpUrl,
  trackingId: string,
  options: WaitForDepositOptions = {},
): Promise<Result<WithdrawalRecord>> {
  const timeout = options.timeout ?? DEFAULT_DEPOSIT_TIMEOUT_MS;
  const interval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeout;

  for (;;) {
    // See `waitForDeposit`: the loop is the retry; a `retry` wrapper would never fire here.
    const res = await getWithdrawal(apiUrl, trackingId);
    if (res.ok) {
      if (res.value.status === 'released') return res;
      if (res.value.status === 'failed') {
        return {
          ok: false,
          error: new Error(`mpc-relay: withdrawal ${trackingId} failed: ${res.value.error ?? 'no reason given'}`),
        };
      }
    }
    if (Date.now() >= deadline) {
      return { ok: false, error: new Error(`mpc-relay: timed out waiting for withdrawal ${trackingId}`) };
    }
    await new Promise(r => setTimeout(r, interval));
  }
}
