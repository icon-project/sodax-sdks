import { bytesToBigInt, isHex, sha256, type Hex } from 'viem';
import {
  ChainKeys,
  getMpcRelayChainInfo,
  type Result,
  type TronChainKey,
  type TronGasEstimate,
  type TronRawTransaction,
  type TronSpokeChainConfig,
  type TronUnsignedTransaction,
  type TxReturnType,
} from '@sodax/types';
import type { ConfigService } from '../../config/ConfigService.js';
import { retry } from '../../utils/shared-utils.js';
import type {
  DepositParams,
  EstimateGasParams,
  GetDepositParams,
  SendMessageParams,
  WaitForTxReceiptParams,
  WaitForTxReceiptReturnType,
} from '../../types/spoke-types.js';
import {
  getDepositAddress,
  notify,
  submitWithdraw,
  toDepositId,
  waitForDeposit,
  waitForWithdrawal,
  type DepositRecord,
  type WithdrawalRecord,
} from '../mpcRelay/MpcRelayApiService.js';
import {
  assembleBroadcastHex,
  computeSignedMessageHash,
  encodeTrc20TransferParams,
  spliceMemo,
  tronAddressToWord,
  tronBase58ToHex,
  tronIdentityBytes,
} from './tron-utils.js';

/**
 * Energy cap for a TRC-20 deposit, in SUN. Tron requires a `fee_limit` on any contract call; it
 * bounds the TRX burned for energy when the sender has none staked, and is not itself a spend.
 * 100 TRX comfortably covers a `transfer` on an unstaked account (a USDT transfer to an address
 * holding no balance yet is the expensive case, ~65 TRX).
 */
const TRC20_DEPOSIT_FEE_LIMIT_SUN = 100_000_000;

/** Per-request budget for a TronGrid call, mirroring the intent relay's own request cap. */
const TRON_RPC_TIMEOUT_MS = 15_000;

/**
 * Floor for an MPC-relay settlement wait, applied over the caller's own timeout.
 *
 * The relay's Tron verifier requires 19 solidified confirmations before it will attest a deposit —
 * roughly 57s of block time on its own — and the hub mint still has to clear aggregation, the NEAR
 * submit and the hub transaction after that. A caller's generic cross-chain timeout
 * (`DEFAULT_RELAY_TX_TIMEOUT`, 120s) is not sized for that, and the chain's own `pollingConfig`
 * (tuned for receipt polling) is smaller still, so either would routinely give up on a deposit that
 * is simply mid-flight. Matches the relay's own documented deposit timeout.
 */
const TRON_SETTLEMENT_FLOOR_MS = 300_000;

/** A 65-byte `r‖s‖v` placeholder — only its length matters when sizing a transaction. */
const SIGNATURE_PLACEHOLDER = '00'.repeat(65);

/** Placeholder memo for sizing: a deposit memo is always exactly 32 bytes. */
const MEMO_PLACEHOLDER = `0x${'00'.repeat(32)}` as Hex;

/**
 * Withdraw-auth nonce: any u64 the sender has not used before — NEAR rejects a repeat, it does not
 * require an increasing value. A random draw is what that calls for; a clock reading is not, since
 * two withdrawals in the same millisecond collide and a backwards clock adjustment reuses a spent
 * value, both of which surface as an opaque replay rejection.
 */
function randomNonce(): bigint {
  return bytesToBigInt(crypto.getRandomValues(new Uint8Array(8)));
}

/**
 * Spoke service for Tron. Unlike the intent-relay chains, Tron deposits ride the **MPC relay** in
 * memo mode: a plain TRX transfer to the shared reserve carries a 32-byte payload-hash memo that the
 * NEAR chain-signatures relay verifies before minting on the hub. The service builds and broadcasts
 * that transfer; the {@link ITronWalletProvider} only signs the transaction digest.
 *
 * @see MpcRelayApiService for the relay REST flow (deposit-address → notify → poll).
 */
export class TronSpokeService {
  private readonly config: ConfigService;

  constructor(config: ConfigService) {
    this.config = config;
  }

  // Read live rather than captured in the constructor: `ConfigService` can swap in backend-fetched
  // config after construction, and an address pinned at startup (notably the reserve this service
  // validates deposits against) would then be stale for the lifetime of the Sodax instance. Matches
  // how the other spoke services resolve addresses per call.
  private get chainConfig(): TronSpokeChainConfig {
    return this.config.getChainConfig(ChainKeys.TRON_MAINNET);
  }

  private get rpcUrl(): string {
    return this.chainConfig.rpcUrl;
  }

  private get relayApiUrl(): TronSpokeChainConfig['mpcRelayApiEndpoint'] {
    return this.chainConfig.mpcRelayApiEndpoint;
  }

  /** The relay's id for this chain, from {@link MpcRelayChainMap} rather than the chain's own config. */
  private get chainId(): string {
    return getMpcRelayChainInfo(ChainKeys.TRON_MAINNET).chainId.toString();
  }

  /**
   * One TronGrid call, bounded by {@link TRON_RPC_TIMEOUT_MS}. The signal covers the body read too —
   * a node can answer headers and then stall the stream, which would otherwise hang a polling loop
   * (or a deposit) with no upper bound.
   *
   * Deliberately no retry: every caller either builds or broadcasts a transaction, where a silent
   * re-POST is not always safe, or already polls in its own loop. The retriable reads go through
   * {@link retry} at their call site, matching how the intent relay splits submit from poll.
   */
  private async rpc<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TRON_RPC_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.rpcUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`tron rpc ${path}: ${res.status}`);
      return (await res.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`tron rpc ${path}: timed out after ${TRON_RPC_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Deposit TRX or a TRC-20 token into the hub via the MPC relay.
   *
   * `Raw: true` returns the unsigned transfer descriptor (no wallet needed). `Raw: false` registers
   * the hub `data`, builds the memo transfer, signs it with the wallet provider, broadcasts it, and
   * notifies the relay — resolving to the source tx hash once accepted.
   *
   * Both token kinds ride the same memo mechanism: the memo is a transaction-level protobuf field,
   * so it rides a `TriggerSmartContract` (TRC-20 `transfer`) exactly as it rides a value transfer.
   * A TRC-20 deposit is a direct transfer to the reserve, so it needs no allowance.
   */
  public async deposit<R extends boolean = false>(
    params: DepositParams<TronChainKey, R>,
  ): Promise<TxReturnType<TronChainKey, R>> {
    const { srcAddress, token, amount, data, to } = params;
    const isNative = token === this.chainConfig.nativeToken;

    // Register the hub-side calls and get the shared reserve + the memo to tag the transfer with.
    const addr = await getDepositAddress(this.relayApiUrl, srcAddress, this.chainId, data);
    if (!addr.ok) throw addr.error;
    const { reserveAddress, memo, hubWallet } = addr.value;
    this.warnOnUnknownReserve(reserveAddress);

    // The relay derives the receiving hub wallet from `srcAddress` rather than taking `to`, so `to`
    // is an assertion here, not an instruction: if the two disagree the mint lands somewhere the
    // caller is not expecting (a mismatch means the identity encoding drifted from the relay's).
    if (to.toLowerCase() !== hubWallet.toLowerCase()) {
      throw new Error(
        `[TronSpokeService.deposit] relay derives hub wallet ${hubWallet} for ${srcAddress}, but the deposit targets ${to}`,
      );
    }

    if ('raw' in params && params.raw) {
      return {
        from: srcAddress,
        to: reserveAddress,
        value: amount,
        data: memo,
        token,
      } satisfies TronRawTransaction as TxReturnType<TronChainKey, R>;
    }

    const walletProvider = params.walletProvider;

    // Build the transfer to the reserve, then splice the memo in as protobuf field 10.
    const rawData = isNative
      ? await this.buildNativeTransfer(srcAddress, reserveAddress, amount)
      : await this.buildTrc20Transfer(srcAddress, reserveAddress, token, amount);

    const rawWithMemo = spliceMemo(rawData, memo);
    const txID = sha256(`0x${rawWithMemo}`).slice(2);

    const unsigned: TronUnsignedTransaction = { txID, raw_data_hex: rawWithMemo, visible: true };
    const signed = await walletProvider.signTransaction(unsigned);
    const signature = signed.signature[0];
    if (!signature) throw new Error('[TronSpokeService.deposit] wallet returned no signature');

    const broadcast = await this.rpc<{ result?: boolean; message?: string }>('/wallet/broadcasthex', {
      transaction: assembleBroadcastHex(rawWithMemo, signature),
    });
    if (!broadcast.result) throw new Error(`[TronSpokeService.deposit] broadcast failed: ${broadcast.message ?? ''}`);

    // Tell the relay a deposit tx exists so verifiers begin attesting it. The funds are already on
    // chain by now, so this is retried (notifying twice is harmless) and, if it still fails, the tx
    // hash goes into the error: without it the deposit cannot be polled or re-notified, and a
    // caller that only sees "notify failed" has lost the only handle to funds sitting in the reserve.
    try {
      // `retry` reacts to a throw, and `notify` reports failure in its Result — so rethrow to arm it.
      await retry(async () => {
        const res = await notify(this.relayApiUrl, this.chainId, `0x${txID}`);
        if (!res.ok) throw res.error;
      });
    } catch (error) {
      throw new Error(
        `[TronSpokeService.deposit] deposit 0x${txID} broadcast but the relay was not notified — re-notify this tx hash to settle it`,
        { cause: error },
      );
    }

    return `0x${txID}` satisfies string as TxReturnType<TronChainKey, R>;
  }

  /**
   * Warn when the relay's reserve differs from the one in the chain config, without blocking.
   *
   * The relay's client contract is explicit that `reserveAddress` is not a constant and that a
   * client must pay the address from the current response rather than a cached or hard-coded one —
   * XRPL already shards its reserve across lanes, and a payment to a retired lane is not credited.
   * So this cannot be a hard pin: it would strand deposits on a legitimate rotation. It stays as a
   * loud signal, since today Tron does return one fixed reserve and a change is worth noticing.
   */
  private warnOnUnknownReserve(reserveAddress: string): void {
    const expected = this.chainConfig.addresses.reserve;
    if (reserveAddress !== expected) {
      this.config.logger.warn(
        `[TronSpokeService] MPC relay returned reserve ${reserveAddress}, chain config expects ${expected} — paying the relay's address, but the config may be stale`,
      );
    }
  }

  /** Unsigned native TRX transfer to the reserve, as `raw_data_hex`. */
  private async buildNativeTransfer(from: string, to: string, amount: bigint): Promise<string> {
    const created = await this.rpc<{ raw_data_hex?: string; Error?: string }>('/wallet/createtransaction', {
      owner_address: from,
      to_address: to,
      amount: Number(amount),
      visible: true,
    });
    if (!created.raw_data_hex) throw new Error(`[TronSpokeService.deposit] createtransaction failed: ${created.Error}`);
    return created.raw_data_hex;
  }

  /** Unsigned TRC-20 `transfer(reserve, amount)` on `token`, as `raw_data_hex`. */
  private async buildTrc20Transfer(from: string, to: string, token: string, amount: bigint): Promise<string> {
    const built = await this.rpc<{
      result?: { result?: boolean; message?: string };
      transaction?: { raw_data_hex?: string };
    }>('/wallet/triggersmartcontract', {
      owner_address: from,
      contract_address: token,
      function_selector: 'transfer(address,uint256)',
      parameter: encodeTrc20TransferParams(to, amount),
      fee_limit: TRC20_DEPOSIT_FEE_LIMIT_SUN,
      call_value: 0,
      visible: true,
    });

    const rawData = built.transaction?.raw_data_hex;
    if (!rawData) {
      // `message` is hex-encoded ASCII on this endpoint; surface it raw rather than half-decoded.
      throw new Error(
        `[TronSpokeService.deposit] triggersmartcontract failed: ${built.result?.message ?? 'no transaction returned'}`,
      );
    }
    return rawData;
  }

  /**
   * Wait for the hub mint to land for a Tron deposit, via the MPC relay's deposit record.
   * `txHash` is the source Tron tx hash returned by {@link deposit}.
   */
  public async waitForDeposit(txHash: string, timeout?: number): Promise<Result<DepositRecord>> {
    return waitForDeposit(this.relayApiUrl, toDepositId(this.chainId, txHash), {
      // Never below what the chain physically needs — see TRON_SETTLEMENT_FLOOR_MS.
      timeout: Math.max(timeout ?? 0, TRON_SETTLEMENT_FLOOR_MS),
      pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
    });
  }

  /**
   * On-chain balance of `token` for the deposit owner. Tron memo-mode has no per-chain asset manager,
   * so this reads the holder's balance directly (`getDeposit` semantics: funds observable on the
   * spoke side) — the account balance for native TRX, `balanceOf` for a TRC-20.
   */
  public async getDeposit(params: GetDepositParams<TronChainKey>): Promise<bigint> {
    if (params.token !== this.chainConfig.nativeToken) {
      const res = await this.rpc<{ constant_result?: string[] }>('/wallet/triggerconstantcontract', {
        owner_address: params.srcAddress,
        contract_address: params.token,
        function_selector: 'balanceOf(address)',
        parameter: tronAddressToWord(params.srcAddress),
        visible: true,
      });
      const word = res.constant_result?.[0];
      return word ? BigInt(`0x${word}`) : 0n;
    }

    const acct = await this.rpc<{ balance?: number }>('/wallet/getaccount', {
      address: tronBase58ToHex(params.srcAddress),
      visible: false,
    });
    return BigInt(acct.balance ?? 0);
  }

  /**
   * Resource cost of a deposit transfer: the energy the call consumes and the bandwidth the signed
   * transaction takes up. Tron charges these to the sender's own staked resources (burning TRX at the
   * network rate when short), so there is no single fee number to return — see {@link TronGasEstimate}.
   *
   * Both figures come from the transaction that would actually be sent: energy from a constant call
   * against the token contract, bandwidth from the byte length of the assembled signed transaction.
   * A native TRX transfer consumes no energy.
   */
  public async estimateGas(params: EstimateGasParams<TronChainKey>): Promise<TronGasEstimate> {
    const { from, to, value, token, data } = params.tx;
    const isNative = token === this.chainConfig.nativeToken;

    const energy = isNative ? 0n : await this.estimateTrc20Energy(from, to, token, value);

    // Bandwidth is charged on the serialized signed transaction, so size the real thing: the built
    // raw body, the memo it carries, and a signature of the fixed 65-byte length.
    const rawData = isNative
      ? await this.buildNativeTransfer(from, to, value)
      : await this.buildTrc20Transfer(from, to, token, value);
    const memo = isHex(data) && data.length === MEMO_PLACEHOLDER.length ? data : MEMO_PLACEHOLDER;
    const signed = assembleBroadcastHex(spliceMemo(rawData, memo), SIGNATURE_PLACEHOLDER);

    return { energy, bandwidth: BigInt(signed.length / 2) } satisfies TronGasEstimate;
  }

  /** Energy a TRC-20 `transfer` would consume, from a constant (non-broadcasting) call. */
  private async estimateTrc20Energy(from: string, to: string, token: string, amount: bigint): Promise<bigint> {
    const res = await this.rpc<{ energy_used?: number }>('/wallet/triggerconstantcontract', {
      owner_address: from,
      contract_address: token,
      function_selector: 'transfer(address,uint256)',
      parameter: encodeTrc20TransferParams(to, amount),
      visible: true,
    });
    return BigInt(res.energy_used ?? 0);
  }

  /**
   * Withdraw / borrow (hub→Tron) via the MPC relay's signature-mode pipeline.
   *
   * The `payload` is the hub-wallet calls to run (e.g. `AssetManager.transfer` that burns the wrapped
   * token and requests the release); `dstAddress` is the hub wallet that executes them. The Tron
   * identity signs the withdraw-auth digest (scheme 1), and the relay verifies → burns on the hub →
   * MPC-signs the native release to the Tron recipient. Resolves to the `trackingId` (Raw: false) to
   * poll {@link waitForWithdrawal} with. Raw mode is not supported — there is no spoke tx to return.
   */
  public async sendMessage<Raw extends boolean>(
    params: SendMessageParams<TronChainKey, Raw>,
  ): Promise<TxReturnType<TronChainKey, Raw>> {
    if ('raw' in params && params.raw) {
      throw new Error('[TronSpokeService.sendMessage] raw mode is not supported for Tron withdrawals');
    }

    const sender = tronIdentityBytes(params.srcAddress);
    const message = {
      to: params.dstAddress as Hex, // hub wallet that executes the calls
      data: params.payload,
      nonce: randomNonce(),
      chainId: BigInt(this.chainId), // the relay's source-chain id, not the hub's
      sender,
    };

    // The tracking id is derived from the nonce, so log it before signing: if the submit response is
    // lost in flight the withdrawal is still recoverable, and a rejected replay is diagnosable.
    this.config.logger.debug('[TronSpokeService.sendMessage] withdraw nonce', {
      sender,
      nonce: message.nonce.toString(),
    });

    const signature = await params.walletProvider.signMessage(computeSignedMessageHash(message));

    const res = await submitWithdraw(this.relayApiUrl, {
      message: { ...message, nonce: message.nonce.toString(), chainId: message.chainId.toString() },
      signature,
      scheme: getMpcRelayChainInfo(ChainKeys.TRON_MAINNET).withdrawScheme,
    });
    if (!res.ok) throw res.error;

    return res.value.trackingId satisfies string as TxReturnType<TronChainKey, Raw>;
  }

  /**
   * Wait for a hub→Tron withdrawal to reach `released`, via the MPC relay.
   * `trackingId` is the value returned by {@link sendMessage}.
   */
  public async waitForWithdrawal(trackingId: string, timeout?: number): Promise<Result<WithdrawalRecord>> {
    return waitForWithdrawal(this.relayApiUrl, trackingId, {
      // Never below what the chain physically needs — see TRON_SETTLEMENT_FLOOR_MS.
      timeout: Math.max(timeout ?? 0, TRON_SETTLEMENT_FLOOR_MS),
      pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
    });
  }

  /** Poll TronGrid until the transaction is included in a block, mapping the receipt to the SDK shape. */
  public async waitForTransactionReceipt(
    params: WaitForTxReceiptParams<TronChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<TronChainKey>>> {
    const { txHash } = params;
    const pollingIntervalMs = params.pollingIntervalMs ?? this.chainConfig.pollingConfig.pollingIntervalMs;
    const maxTimeoutMs = params.maxTimeoutMs ?? this.chainConfig.pollingConfig.maxTimeoutMs;
    const value = txHash.replace(/^0x/, '');
    const maxAttempts = Math.max(1, Math.round(maxTimeoutMs / pollingIntervalMs));

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const info = await this.rpc<{
          id?: string;
          blockNumber?: number;
          receipt?: { result?: string };
        }>('/wallet/gettransactioninfobyid', { value });
        if (info.blockNumber) {
          const reverted = info.receipt?.result && info.receipt.result !== 'SUCCESS';
          if (reverted) {
            return {
              ok: true,
              value: { status: 'failure', error: new Error(`tron tx reverted: ${info.receipt?.result}`) },
            };
          }
          return { ok: true, value: { status: 'success', receipt: info } };
        }
      } catch (error) {
        this.config.logger.debug('[TronSpokeService.waitForTransactionReceipt] poll error', { error });
      }
      await new Promise(r => setTimeout(r, pollingIntervalMs));
    }
    return { ok: true, value: { status: 'timeout', error: new Error(`tron tx ${txHash} not confirmed in time`) } };
  }
}
