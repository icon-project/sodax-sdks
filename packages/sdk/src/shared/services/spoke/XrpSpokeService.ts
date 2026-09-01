import { bytesToBigInt, type Hex } from 'viem';
import {
  ChainKeys,
  getMpcRelayChainInfo,
  type Result,
  type TxReturnType,
  type XrpChainKey,
  type XrpRawTransaction,
  type XrpRawTransactionReceipt,
  type XrpSpokeChainConfig,
  type XrpGasEstimate,
  type XrpUnsignedTransaction,
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
import { computeSignedMessageHash } from './mpc-message.js';
import { xrpCurrencyCode, xrpIdentityBytes } from './xrp-utils.js';

/** Per-request budget for a rippled call, mirroring the Tron service's own request cap. */
const XRP_RPC_TIMEOUT_MS = 15_000;

/**
 * Floor for an MPC-relay settlement wait, applied over the caller's own timeout.
 *
 * XRPL itself is fast — the relay attests at 0 confirmations because a validated ledger is already
 * final — but the wait is not bounded by XRPL. Aggregation, the NEAR submit and the hub transaction
 * still have to clear, and for a withdrawal the release has to be MPC-signed and land back on XRPL.
 * A caller's generic cross-chain timeout is not sized for that, so this floor prevents giving up on
 * a settlement that is merely mid-flight.
 */
const XRP_SETTLEMENT_FLOOR_MS = 300_000;

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
 * Spoke service for the XRP Ledger. Like Tron, XRPL deposits ride the **MPC relay** in memo mode: a
 * Payment to the shared reserve carries a 32-byte payload-hash memo that the NEAR chain-signatures
 * relay verifies before minting on the hub.
 *
 * Withdrawals use auth scheme 3, which differs from Tron's scheme 1 in two ways:
 *   - the signature is a RAW ed25519 signature over the message hash — no prefix, no envelope;
 *   - ed25519 cannot recover its signer, so the 33-byte `0xED`-prefixed public key is submitted
 *     alongside and the contract derives the AccountID from it to check against `sender`.
 *
 * @see MpcRelayApiService for the relay REST flow (deposit-address → notify → poll).
 */
export class XrpSpokeService {
  private readonly config: ConfigService;

  constructor(config: ConfigService) {
    this.config = config;
  }

  // Read live rather than captured in the constructor: `ConfigService` can swap in backend-fetched
  // config after construction, and an address pinned at startup (notably the reserve) would then be
  // stale for the lifetime of the Sodax instance.
  private get chainConfig(): XrpSpokeChainConfig {
    return this.config.getChainConfig(ChainKeys.XRP_MAINNET);
  }

  private get rpcUrl(): string {
    return this.chainConfig.rpcUrl;
  }

  private get relayApiUrl(): XrpSpokeChainConfig['mpcRelayApiEndpoint'] {
    return this.chainConfig.mpcRelayApiEndpoint;
  }

  /** The relay's id for this chain, from {@link MpcRelayChainMap} rather than the chain's own config. */
  private get chainId(): string {
    return getMpcRelayChainInfo(ChainKeys.XRP_MAINNET).chainId.toString();
  }

  /**
   * One rippled JSON-RPC call, bounded by {@link XRP_RPC_TIMEOUT_MS}. The signal covers the body
   * read too — a node can answer headers and then stall the stream, which would otherwise hang a
   * polling loop with no upper bound.
   */
  private async rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), XRP_RPC_TIMEOUT_MS);
    try {
      const res = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, params: [params] }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`xrpl rpc ${method}: ${res.status}`);
      const body = (await res.json()) as { result?: T & { error?: string; error_message?: string } };
      if (!body.result) throw new Error(`xrpl rpc ${method}: no result`);
      if (body.result.error) {
        throw new Error(`xrpl rpc ${method}: ${body.result.error} ${body.result.error_message ?? ''}`.trim());
      }
      return body.result as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`xrpl rpc ${method}: timed out after ${XRP_RPC_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Deposit XRP or an issued currency (IOU) into the hub via the MPC relay.
   *
   * `Raw: true` returns the unsigned transfer descriptor (no wallet needed). `Raw: false` registers
   * the hub `data`, builds the memo Payment, signs it with the wallet provider, submits it, and
   * notifies the relay — resolving to the source tx hash once accepted.
   *
   * Both token kinds ride the same memo mechanism: `Memos` is a transaction-level field, so it
   * rides an IOU Payment exactly as it rides a drops transfer. An IOU deposit needs no allowance,
   * but the RESERVE must already hold a trustline for that currency or the Payment fails on ledger.
   */
  public async deposit<R extends boolean = false>(
    params: DepositParams<XrpChainKey, R>,
  ): Promise<TxReturnType<XrpChainKey, R>> {
    const { srcAddress, token, amount, data, to } = params;
    const isNative = token === this.chainConfig.nativeToken;

    // Register the hub-side calls and get the shared reserve + the memo to tag the Payment with.
    const addr = await getDepositAddress(this.relayApiUrl, srcAddress, this.chainId, data);
    if (!addr.ok) throw addr.error;
    const { reserveAddress, memo, hubWallet } = addr.value;
    this.warnOnUnknownReserve(reserveAddress);

    // The relay derives the receiving hub wallet from `srcAddress` rather than taking `to`, so `to`
    // is an assertion here, not an instruction: if the two disagree the mint lands somewhere the
    // caller is not expecting (a mismatch means the identity encoding drifted from the relay's).
    if (to.toLowerCase() !== hubWallet.toLowerCase()) {
      throw new Error(
        `[XrpSpokeService.deposit] relay derives hub wallet ${hubWallet} for ${srcAddress}, but the deposit targets ${to}`,
      );
    }

    if ('raw' in params && params.raw) {
      return {
        from: srcAddress,
        to: reserveAddress,
        value: amount,
        data: memo,
        token,
      } satisfies XrpRawTransaction as TxReturnType<XrpChainKey, R>;
    }

    const walletProvider = params.walletProvider;

    const unsigned: XrpUnsignedTransaction = {
      TransactionType: 'Payment',
      Account: srcAddress,
      Destination: reserveAddress,
      Amount: isNative ? amount.toString() : this.iouAmount(token, amount),
      // MemoData is plain hex without `0x` — this is what the relay matches the deposit on.
      Memos: [{ Memo: { MemoData: memo.replace(/^0x/, '').toUpperCase() } }],
    };

    // Sequence/Fee/LastLedgerSequence are deliberately left to the wallet: GemWallet autofills and
    // rejects a transaction that pins them, and a raw-key provider has xrpl.js do the same. Filling
    // them here would mean racing the wallet for the account's Sequence.
    const signed = await walletProvider.signTransaction(unsigned);
    if (!signed.tx_blob) throw new Error('[XrpSpokeService.deposit] wallet returned no signed blob');

    const submitted = await this.rpc<{ engine_result?: string; tx_json?: { hash?: string } }>('submit', {
      tx_blob: signed.tx_blob,
    });
    // tesSUCCESS is the only unambiguous accept; tec* codes are applied-but-failed and ter*/tem* are
    // rejections. Treating anything else as success would notify the relay about a tx that never
    // moved funds.
    if (submitted.engine_result !== 'tesSUCCESS') {
      throw new Error(`[XrpSpokeService.deposit] submit failed: ${submitted.engine_result ?? 'unknown'}`);
    }
    const rawHash = signed.hash ?? submitted.tx_json?.hash;
    if (!rawHash) throw new Error('[XrpSpokeService.deposit] submitted but no transaction hash returned');
    // XRPL reports hashes as bare uppercase hex; the relay's API takes the 0x-prefixed form (the
    // Tron path normalises identically, and its hashes are natively unprefixed too).
    const hash = `0x${rawHash.replace(/^0x/, '').toLowerCase()}` as Hex;

    // Tell the relay a deposit tx exists so verifiers begin attesting it. The funds are already on
    // chain by now, so this is retried (notifying twice is harmless) and, if it still fails, the tx
    // hash goes into the error: without it the deposit cannot be polled or re-notified, and a
    // caller that only sees "notify failed" has lost the only handle to funds sitting in the reserve.
    try {
      // `retry` reacts to a throw, and `notify` reports failure in its Result — so rethrow to arm it.
      await retry(async () => {
        const res = await notify(this.relayApiUrl, this.chainId, hash);
        if (!res.ok) throw res.error;
      });
    } catch (error) {
      throw new Error(
        `[XrpSpokeService.deposit] deposit ${hash} submitted but the relay was not notified — re-notify this tx hash to settle it`,
        { cause: error },
      );
    }

    return hash satisfies string as TxReturnType<XrpChainKey, R>;
  }

  /**
   * IOU amount object for a Payment. XRPL identifies an issued currency by (currency, issuer), and
   * the token's `address` carries the issuer — XRPL has no token contracts. The currency code is
   * derived from the symbol rather than looked up, so a newly listed IOU cannot miss a registry
   * entry (see {@link xrpCurrencyCode}).
   *
   * `value` is a decimal STRING in whole units, not drops: XRPL IOUs are decimal, so the base-unit
   * amount has to be scaled down by the token's decimals or the Payment moves 10^decimals too much.
   */
  private iouAmount(token: string, amount: bigint): { currency: string; issuer: string; value: string } {
    const entry = Object.values(this.chainConfig.supportedTokens).find(t => t.address === token);
    if (!entry) {
      throw new Error(`[XrpSpokeService.deposit] unknown XRPL token ${token} — not in supportedTokens`);
    }
    const scale = 10n ** BigInt(entry.decimals);
    const whole = amount / scale;
    const frac = amount % scale;
    const value =
      frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(entry.decimals, '0').replace(/0+$/, '')}`;
    return { currency: xrpCurrencyCode(entry.symbol), issuer: entry.address, value };
  }

  /**
   * Warn when the relay's reserve differs from the one in the chain config, without blocking.
   *
   * The relay's client contract is explicit that `reserveAddress` is not a constant and that a
   * client must pay the address from the current response rather than a cached or hard-coded one.
   * XRPL in particular SHARDS its reserve across lanes (`set_xrp_reserve`), and a payment to a
   * retired lane is not credited — so this cannot be a hard pin without stranding deposits on a
   * legitimate rotation. It stays a loud signal instead.
   */
  private warnOnUnknownReserve(reserveAddress: string): void {
    const expected = this.chainConfig.addresses.reserve;
    if (reserveAddress !== expected) {
      this.config.logger.warn(
        `[XrpSpokeService] MPC relay returned reserve ${reserveAddress}, chain config expects ${expected} — paying the relay's address, but the config may be stale (XRPL shards its reserve across lanes)`,
      );
    }
  }

  /**
   * Wait for the hub mint to land for an XRPL deposit, via the MPC relay's deposit record.
   * `txHash` is the source XRPL tx hash returned by {@link deposit}.
   */
  public async waitForDeposit(txHash: string, timeout?: number): Promise<Result<DepositRecord>> {
    return waitForDeposit(this.relayApiUrl, toDepositId(this.chainId, txHash), {
      timeout: Math.max(timeout ?? 0, XRP_SETTLEMENT_FLOOR_MS),
      pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
    });
  }

  /**
   * On-chain balance for the deposit owner. XRPL memo-mode has no per-chain asset manager, so this
   * reads the holder's balance directly — native XRP from `account_info`, an IOU from the trustline
   * in `account_lines`.
   */
  public async getDeposit(params: GetDepositParams<XrpChainKey>): Promise<bigint> {
    const { token, srcAddress } = params;
    if (token === this.chainConfig.nativeToken) {
      const info = await this.rpc<{ account_data?: { Balance?: string } }>('account_info', {
        account: srcAddress,
        ledger_index: 'validated',
      });
      return BigInt(info.account_data?.Balance ?? '0');
    }

    const entry = Object.values(this.chainConfig.supportedTokens).find(t => t.address === token);
    if (!entry) throw new Error(`[XrpSpokeService.getDeposit] unknown XRPL token ${token}`);
    const currency = xrpCurrencyCode(entry.symbol);
    const lines = await this.rpc<{ lines?: { currency: string; account: string; balance: string }[] }>(
      'account_lines',
      { account: srcAddress, ledger_index: 'validated' },
    );
    const line = lines.lines?.find(l => l.currency === currency && l.account === entry.address);
    if (!line) return 0n;
    // IOU balances are decimal strings; scale back to base units for a uniform SDK return type.
    const [whole = '0', frac = ''] = line.balance.split('.');
    return BigInt(whole + frac.padEnd(entry.decimals, '0').slice(0, entry.decimals));
  }

  /**
   * The fee the ledger will burn for a Payment, in drops.
   *
   * XRPL charges a flat per-transaction fee rather than metering execution, so there is no
   * gas/limit pair to estimate — `server_info` reports the current base fee, which rises only
   * when the network is under load. Returned as drops so the caller can compare it against the
   * amount being sent.
   */
  public async estimateGas(_params: EstimateGasParams<XrpChainKey>): Promise<XrpGasEstimate> {
    const info = await this.rpc<{ info?: { validated_ledger?: { base_fee_xrp?: number } } }>('server_info', {});
    const baseFeeXrp = info.info?.validated_ledger?.base_fee_xrp;
    if (baseFeeXrp === undefined) {
      // A node that cannot report its fee is not a node to build a transaction against.
      throw new Error('[XrpSpokeService.estimateGas] server_info returned no base_fee_xrp');
    }
    return { fee: BigInt(Math.ceil(baseFeeXrp * 1_000_000)) };
  }

  /**
   * Withdraw / borrow (hub→XRPL) via the MPC relay's signature-mode pipeline.
   *
   * The `payload` is the hub-wallet calls to run (e.g. `AssetManager.transfer` that burns the
   * wrapped token and requests the release); `dstAddress` is the hub wallet that executes them. The
   * XRPL identity signs the withdraw-auth hash (scheme 3) and the relay verifies → burns on the hub
   * → MPC-signs the release to the XRPL recipient. Resolves to the `trackingId` to poll
   * {@link waitForWithdrawal} with. Raw mode is not supported — there is no spoke tx to return.
   */
  public async sendMessage<Raw extends boolean>(
    params: SendMessageParams<XrpChainKey, Raw>,
  ): Promise<TxReturnType<XrpChainKey, Raw>> {
    if ('raw' in params && params.raw) {
      throw new Error('[XrpSpokeService.sendMessage] raw mode is not supported for XRPL withdrawals');
    }

    const sender = xrpIdentityBytes(params.srcAddress);
    const message = {
      to: params.dstAddress as Hex, // hub wallet that executes the calls
      data: params.payload,
      nonce: randomNonce(),
      chainId: BigInt(this.chainId), // the relay's source-chain id, not the hub's
      sender,
    };

    // The tracking id is derived from the nonce, so log it before signing: if the submit response is
    // lost in flight the withdrawal is still recoverable, and a rejected replay is diagnosable.
    this.config.logger.debug('[XrpSpokeService.sendMessage] withdraw nonce', {
      sender,
      nonce: message.nonce.toString(),
    });

    // Scheme 3 signs the RAW 32-byte hash — no prefix, no envelope, unlike scheme 1's TIP-191
    // wrapping. The public key rides along because an ed25519 signature cannot recover its signer:
    // the contract derives ripemd160(sha256(publicKey)) and compares it to `sender`.
    const hash = computeSignedMessageHash(message);
    const [signature, publicKey] = await Promise.all([
      params.walletProvider.signMessage(hash),
      params.walletProvider.getPublicKey(),
    ]);

    const res = await submitWithdraw(this.relayApiUrl, {
      message: { ...message, nonce: message.nonce.toString(), chainId: message.chainId.toString() },
      signature,
      scheme: getMpcRelayChainInfo(ChainKeys.XRP_MAINNET).withdrawScheme,
      publicKey,
    });
    if (!res.ok) throw res.error;

    return res.value.trackingId satisfies string as TxReturnType<XrpChainKey, Raw>;
  }

  /**
   * Wait for a hub→XRPL withdrawal to reach `released`, via the MPC relay.
   * `trackingId` is the value returned by {@link sendMessage}.
   */
  public async waitForWithdrawal(trackingId: string, timeout?: number): Promise<Result<WithdrawalRecord>> {
    return waitForWithdrawal(this.relayApiUrl, trackingId, {
      timeout: Math.max(timeout ?? 0, XRP_SETTLEMENT_FLOOR_MS),
      pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
    });
  }

  /** Poll rippled until the transaction is in a validated ledger, mapping it to the SDK shape. */
  public async waitForTransactionReceipt(
    params: WaitForTxReceiptParams<XrpChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<XrpChainKey>>> {
    const { txHash } = params;
    const pollingIntervalMs = params.pollingIntervalMs ?? this.chainConfig.pollingConfig.pollingIntervalMs;
    const maxTimeoutMs = params.maxTimeoutMs ?? this.chainConfig.pollingConfig.maxTimeoutMs;
    const maxAttempts = Math.max(1, Math.round(maxTimeoutMs / pollingIntervalMs));

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const tx = await this.rpc<XrpRawTransactionReceipt>('tx', {
          transaction: txHash.replace(/^0x/, '').toUpperCase(),
          binary: false,
        });
        // Only a VALIDATED ledger is final on XRPL; an unvalidated result can still change.
        if (tx.validated) {
          const result = tx.meta?.TransactionResult;
          if (result && result !== 'tesSUCCESS') {
            return { ok: true, value: { status: 'failure', error: new Error(`xrpl tx failed: ${result}`) } };
          }
          return { ok: true, value: { status: 'success', receipt: tx } };
        }
      } catch (error) {
        // `txnNotFound` is expected until the tx is in a ledger, so a poll error is not terminal.
        this.config.logger.debug('[XrpSpokeService.waitForTransactionReceipt] poll error', { error });
      }
      await new Promise(r => setTimeout(r, pollingIntervalMs));
    }
    return { ok: true, value: { status: 'timeout', error: new Error(`xrpl tx ${txHash} not validated in time`) } };
  }
}
