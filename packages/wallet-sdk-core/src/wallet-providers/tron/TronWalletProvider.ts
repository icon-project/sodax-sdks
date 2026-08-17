import { concat, keccak256, sha256, stringToBytes, toBytes, type Hex } from 'viem';
import { privateKeyToAccount, sign } from 'viem/accounts';
import type {
  ITronWalletProvider,
  TronRawTransactionReceipt,
  TronSignedTransaction,
  TronUnsignedTransaction,
} from '@sodax/types';
import { BaseWalletProvider } from '../BaseWalletProvider.js';
import type {
  BrowserExtensionTronWalletConfig,
  PrivateKeyTronWalletConfig,
  TronWalletConfig,
  TronWalletDefaults,
  TronWebLike,
} from './types.js';

const DEFAULT_RPC = 'https://api.trongrid.io';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
// TronLink `signMessageV2` prefix for scheme-1 withdrawal-auth signatures.
//
// The length is 66, not 32: `signMessageV2` follows ethers' `hashMessage` semantics, where a
// STRING argument is UTF-8 encoded rather than hex-decoded. Passing the 0x-prefixed hash therefore
// signs its 66-ASCII-character hex representation, not the 32 raw bytes. The NEAR bridge's
// `tron_signmessagev2_digest` computes the identical digest; a mismatch here recovers a valid but
// wrong address and fails `submit_withdraw_message` with "Recovered address does not match sender".
const TRON_MESSAGE_PREFIX = '\x19TRON Signed Message:\n66';

export function isPrivateKeyTronWalletConfig(config: TronWalletConfig): config is PrivateKeyTronWalletConfig {
  return 'privateKey' in config;
}

export function isBrowserExtensionTronWalletConfig(
  config: TronWalletConfig,
): config is BrowserExtensionTronWalletConfig {
  return 'tronWeb' in config;
}

const bufHex = (u: Uint8Array): string => Buffer.from(u).toString('hex');
const sha256d = (b: Uint8Array): Uint8Array => sha256(sha256(b, 'bytes'), 'bytes');

/** base58check-encode a 21-byte Tron payload (`0x41 ‖ 20-byte hash`). */
function toBase58Check(payload: Uint8Array): string {
  const full = Uint8Array.from([...payload, ...sha256d(payload).slice(0, 4)]);
  let n = BigInt(`0x${bufHex(full)}`);
  let s = '';
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of full) {
    if (b === 0) s = `1${s}`;
    else break;
  }
  return s;
}

/** Derive the base58 Tron address from a private key (EVM address == the 20-byte Tron hash). */
function privateKeyToTronAddress(privateKey: `0x${string}`): string {
  const evm = privateKeyToAccount(privateKey).address;
  return toBase58Check(Uint8Array.from([0x41, ...Buffer.from(evm.slice(2), 'hex')]));
}

/**
 * Tron wallet provider. Two modes:
 *   - browser extension: wraps the injected `window.tronWeb` (TronLink) — `trx.sign` /
 *     `trx.signMessageV2` prompt the user.
 *   - private key: signs locally via secp256k1 (raw txID for transactions, TRON-prefixed digest for
 *     scheme-1 messages), used for headless flows/tests.
 *
 * Implements {@link ITronWalletProvider}: the sdk's `TronSpokeService` builds the memo transfer +
 * withdraw messages and delegates only the signing here.
 */
export class TronWalletProvider extends BaseWalletProvider<TronWalletDefaults> implements ITronWalletProvider {
  public readonly chainType = 'TRON' as const;
  private readonly rpcUrl: string;
  private readonly privateKey?: `0x${string}`;
  private readonly tronWeb?: TronWebLike;
  private readonly browserAddress?: string;

  constructor(config: TronWalletConfig) {
    super(config.defaults);
    this.rpcUrl = config.endpoint ?? this.defaults.rpcUrl ?? DEFAULT_RPC;

    if (isPrivateKeyTronWalletConfig(config)) {
      this.privateKey = `0x${config.privateKey.replace(/^0x/, '')}`;
      return;
    }
    if (isBrowserExtensionTronWalletConfig(config)) {
      this.tronWeb = config.tronWeb;
      this.browserAddress = config.address;
      return;
    }
    throw new Error('Invalid Tron wallet configuration');
  }

  public async getWalletAddress(): Promise<string> {
    if (this.privateKey) return privateKeyToTronAddress(this.privateKey);
    const address = this.browserAddress ?? this.tronWeb?.defaultAddress?.base58;
    if (!address) throw new Error('Tron wallet not connected (no address)');
    return address;
  }

  public async signTransaction(tx: TronUnsignedTransaction): Promise<TronSignedTransaction> {
    if (this.privateKey) {
      const s = await sign({ hash: `0x${tx.txID}`, privateKey: this.privateKey });
      const signature = `${s.r.slice(2)}${s.s.slice(2)}${Number(s.yParity).toString(16).padStart(2, '0')}`;
      return { ...tx, signature: [signature] };
    }
    // TronLink signs `tx.txID` and attaches `signature`.
    return this.tronWeb!.trx.sign(tx);
  }

  public async signMessage(hash: `0x${string}`): Promise<`0x${string}`> {
    if (this.privateKey) {
      // Scheme 1: keccak256("\x19TRON Signed Message:\n66" ‖ "0x<64 lowercase hex>") — the same
      // digest TronLink's signMessageV2 produces for the browser branch below, so both paths
      // verify against the bridge's `tron_signmessagev2_digest`.
      //
      // `stringToBytes`, NOT `toBytes`: viem's `toBytes` hex-decodes a 0x-prefixed value back to
      // the 32 raw bytes, which is exactly the digest this is fixing.
      const digest = keccak256(concat([toBytes(TRON_MESSAGE_PREFIX), stringToBytes(hash.toLowerCase())]));
      const s = await sign({ hash: digest, privateKey: this.privateKey });
      return `0x${s.r.slice(2)}${s.s.slice(2)}${Number(s.yParity).toString(16).padStart(2, '0')}`;
    }
    const sig = await this.tronWeb!.trx.signMessageV2(hash);
    return (sig.startsWith('0x') ? sig : `0x${sig}`) as Hex;
  }

  public async waitForTransactionReceipt(txHash: string): Promise<TronRawTransactionReceipt> {
    const value = txHash.replace(/^0x/, '');
    for (let i = 0; i < 30; i++) {
      const info = (await this.rpc('/wallet/gettransactioninfobyid', { value })) as TronRawTransactionReceipt & {
        blockNumber?: number;
      };
      if (info?.blockNumber) return info;
      await new Promise(r => setTimeout(r, 3000));
    }
    throw new Error(`Tron tx ${txHash} not confirmed in time`);
  }

  /** Broadcast an already-signed transaction. Returns the tx id. */
  public async sendTransaction(signedTx: TronSignedTransaction): Promise<string> {
    const res = (await this.rpc('/wallet/broadcasttransaction', signedTx)) as { result?: boolean; message?: string };
    if (!res?.result) throw new Error(`Tron broadcast failed: ${res?.message ?? 'unknown'}`);
    return signedTx.txID;
  }

  /** TRX balance in sun. Errors are swallowed → `0n` (cannot distinguish zero from fetch failure). */
  public async getBalance(address?: string): Promise<bigint> {
    try {
      const addr = address ?? (await this.getWalletAddress());
      const acct = (await this.rpc('/wallet/getaccount', { address: addr, visible: true })) as { balance?: number };
      return BigInt(acct?.balance ?? 0);
    } catch {
      return 0n;
    }
  }

  private async rpc(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.rpcUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`tron rpc ${path}: ${res.status}`);
    return res.json();
  }
}
