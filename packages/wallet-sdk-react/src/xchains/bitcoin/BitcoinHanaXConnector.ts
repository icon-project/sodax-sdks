import type { XAccount } from '@/types/index.js';
import { detectBitcoinAddressType, type IBitcoinWalletProvider, type BtcAddressType, type BtcWalletAddressType } from '@sodax/types';
import type { BitcoinWalletDefaults } from '@sodax/wallet-sdk-core';
import { AddressPurpose, MessageSigningProtocols } from 'sats-connect';
import { WALLET_METADATA } from '@/constants.js';
import { BitcoinXConnector } from './BitcoinXConnector.js';

// Hana ships a sats-connect-compatible Bitcoin provider at window.hanaWallet.bitcoin.
// It is read only for install detection — every RPC goes through sats-connect's
// request() pinned to HANA_PROVIDER_ID, so the surface is typed as opaque here.
declare global {
  interface Window {
    hanaWallet?: {
      bitcoin?: Record<string, unknown>;
    };
  }
}

// Pins every sats-connect call to Hana so requests never fall through to another
// installed sats-connect wallet (e.g. Xverse). `request(method, params, providerId)`
// resolves 'hanaWallet.bitcoin' → window.hanaWallet.bitcoin.
const HANA_PROVIDER_ID = 'hanaWallet.bitcoin';

// sats-connect types
interface SignPsbtResult {
  psbt: string; // base64 signed PSBT
}

interface GetAccountsResult {
  address: string;
  publicKey: string;
  purpose: string;
  addressType: string;
}

interface SignMessageResult {
  signature: string;
}

class BitcoinHanaWalletProvider implements IBitcoinWalletProvider {
  readonly chainType = 'BITCOIN' as const;
  private address: string;
  private publicKey: string;
  private readonly defaults: BitcoinWalletDefaults | undefined;

  constructor(address: string, publicKey: string, defaults?: BitcoinWalletDefaults) {
    this.address = address;
    this.publicKey = publicKey;
    this.defaults = defaults;
  }

  async getWalletAddress(): Promise<string> {
    return this.address;
  }

  async getPublicKey(): Promise<string> {
    return this.publicKey;
  }

  async getAddressType(_address: string): Promise<BtcAddressType> {
    return detectBitcoinAddressType(this.address);
  }

  /**
   * Parse a base64-encoded PSBT to count the number of inputs.
   * Reads the unsigned transaction from the PSBT global section.
   */
  private countPsbtInputs(psbtBase64: string): number {
    const data = Buffer.from(psbtBase64, 'base64');
    // Skip 5-byte magic (0x70736274FF = "psbt" + separator)
    let offset = 5;

    // Global section: first key-value pair should be key 0x00 (unsigned tx)
    const keyLen = data[offset++] ?? 0;
    if (keyLen !== 1 || data[offset++] !== 0x00) {
      return 1; // fallback: assume 1 input
    }

    // Read value length (compact size)
    const firstByte = data[offset++] ?? 0;
    if (firstByte === 0xfd) offset += 2;
    else if (firstByte === 0xfe) offset += 4;
    else if (firstByte === 0xff) offset += 8;
    // else firstByte IS the length (< 0xfd), no extra bytes

    // Unsigned tx: skip 4-byte version
    offset += 4;

    // Read input count (varint)
    const inputByte = data[offset] ?? 0;
    if (inputByte < 0xfd) return inputByte;
    return 1; // fallback for unusual cases
  }

  async signTransaction(psbtBase64: string, finalize?: boolean): Promise<string> {
    const effectiveFinalize = finalize ?? this.defaults?.defaultFinalize ?? false;
    const { request } = await import('sats-connect');

    const inputCount = this.countPsbtInputs(psbtBase64);
    const signingIndexes = Array.from({ length: inputCount }, (_, i) => i);

    const response = await request(
      'signPsbt',
      {
        psbt: psbtBase64,
        broadcast: false,
        signInputs: {
          [this.address]: signingIndexes,
        },
      },
      HANA_PROVIDER_ID,
    );

    if (response.status === 'error') {
      throw new Error(response.error?.message || 'Hana PSBT signing failed');
    }

    const result = response.result as SignPsbtResult;

    if (effectiveFinalize) {
      // Return hex for broadcast
      return Buffer.from(result.psbt, 'base64').toString('hex');
    }

    // Return base64 signed PSBT (partially signed)
    return result.psbt;
  }

  async signEcdsaMessage(message: string): Promise<string> {
    const { request } = await import('sats-connect');

    const response = await request(
      'signMessage',
      {
        address: this.address,
        message,
        protocol: MessageSigningProtocols.ECDSA,
      },
      HANA_PROVIDER_ID,
    );

    if (response.status === 'error') {
      throw new Error(response.error?.message || 'Hana ECDSA signing failed');
    }

    return (response.result as SignMessageResult).signature;
  }

  async signBip322Message(message: string): Promise<string> {
    const { request } = await import('sats-connect');

    const response = await request(
      'signMessage',
      {
        address: this.address,
        message,
        protocol: MessageSigningProtocols.BIP322,
      },
      HANA_PROVIDER_ID,
    );

    if (response.status === 'error') {
      throw new Error(response.error?.message || 'Hana BIP322 signing failed');
    }

    return (response.result as SignMessageResult).signature;
  }

  async sendBitcoin(toAddress: string, satoshis: bigint): Promise<string> {
    const { request } = await import('sats-connect');

    const response = await request(
      'sendTransfer',
      {
        recipients: [
          {
            address: toAddress,
            amount: Number(satoshis),
          },
        ],
      },
      HANA_PROVIDER_ID,
    );

    if (response.status === 'error') {
      throw new Error(response.error?.message || 'Hana sendTransfer failed');
    }

    return (response.result as { txid: string }).txid;
  }
}

const HANA_ADDRESS_TYPE_KEY = 'hana-address-type';

export class BitcoinHanaXConnector extends BitcoinXConnector {
  private walletProvider: BitcoinHanaWalletProvider | undefined;

  /** Address purpose used when connecting. Taproot (Ordinals) by default to match Bound Exchange. */
  public addressPurpose: AddressPurpose;

  constructor(defaults?: BitcoinWalletDefaults) {
    // id is chain-suffixed (cf. OKX `okx-bitcoin`) so it stays distinct from the
    // ICON Hana connector (`id='hana'`); brand matching still resolves via the
    // shared `hana` substring on id/name.
    super('Hana Wallet', 'hana-bitcoin', defaults);
    // Restore saved preference, default to Taproot
    const saved = typeof window !== 'undefined' ? localStorage.getItem(HANA_ADDRESS_TYPE_KEY) : null;
    this.addressPurpose = saved === 'segwit' ? AddressPurpose.Payment : AddressPurpose.Ordinals;
  }

  /** Set address purpose and persist to localStorage. */
  public setAddressPurpose(type: BtcWalletAddressType): void {
    this.addressPurpose = type === 'taproot' ? AddressPurpose.Ordinals : AddressPurpose.Payment;
    if (typeof window !== 'undefined') {
      localStorage.setItem(HANA_ADDRESS_TYPE_KEY, type);
    }
  }

  public static isAvailable(): boolean {
    return typeof window !== 'undefined' && !!window.hanaWallet?.bitcoin;
  }

  public override get isInstalled(): boolean {
    return BitcoinHanaXConnector.isAvailable();
  }

  public override get installUrl(): string {
    return WALLET_METADATA.hana.installUrl;
  }

  public override get icon(): string {
    return WALLET_METADATA.hana.icon;
  }

  async connect(): Promise<XAccount | undefined> {
    if (!BitcoinHanaXConnector.isAvailable()) {
      throw new Error('Hana wallet is not installed');
    }

    const { request } = await import('sats-connect');

    const response = await request(
      'getAccounts',
      {
        purposes: [this.addressPurpose],
        message: 'Connect to Sodax',
      },
      HANA_PROVIDER_ID,
    );

    if (response.status === 'error') {
      throw new Error(response.error?.message || 'Hana connection failed');
    }

    const accounts = response.result as GetAccountsResult[];
    const paymentAccount = accounts.find(a => a.purpose === this.addressPurpose) || accounts[0];

    if (!paymentAccount) return undefined;

    this.walletProvider = new BitcoinHanaWalletProvider(paymentAccount.address, paymentAccount.publicKey, this.defaults);

    return {
      address: paymentAccount.address,
      publicKey: paymentAccount.publicKey,
      xChainType: 'BITCOIN',
    };
  }

  async disconnect(): Promise<void> {
    this.walletProvider = undefined;
  }

  getWalletProvider(): IBitcoinWalletProvider | undefined {
    return this.walletProvider;
  }

  recreateWalletProvider(xAccount: XAccount): IBitcoinWalletProvider | undefined {
    if (!xAccount.address || !xAccount.publicKey) return undefined;
    return new BitcoinHanaWalletProvider(xAccount.address, xAccount.publicKey, this.defaults);
  }
}
