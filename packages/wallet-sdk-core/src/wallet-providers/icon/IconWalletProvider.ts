import type { IconTransactionResult, IcxCallTransaction, IIconWalletProvider } from '@sodax/types';
import type { IconService } from 'icon-sdk-js';
import * as IconSdkRaw from 'icon-sdk-js';
import { BaseWalletProvider } from '../BaseWalletProvider.js';
import type {
  BrowserExtensionIconWalletConfig,
  HanaWalletResponseEvent,
  Hash,
  IconAddress,
  IconBrowserExtensionWallet,
  IconEoaAddress,
  IconPkWallet,
  IconWallet,
  IconWalletConfig,
  IconWalletDefaults,
  JsonRpcPayloadResponse,
  PrivateKeyIconWalletConfig,
  RelayRequestDetail,
  RelayRequestSigning,
  ResponseAddressType,
  ResponseSigningType,
} from './types.js';

const IconSdk = ('default' in IconSdkRaw.default ? IconSdkRaw.default : IconSdkRaw) as typeof IconSdkRaw;
const { Converter, CallTransactionBuilder, Wallet } = IconSdk;

const DEFAULT_STEP_LIMIT = 3_000_000;
const DEFAULT_VERSION = '0x3';
const DEFAULT_JSON_RPC_ID = 99999;

const ICONEX_RELAY_REQUEST = 'ICONEX_RELAY_REQUEST';
const ICONEX_RELAY_RESPONSE = 'ICONEX_RELAY_RESPONSE';
// Upper bound for a single ICONEX round-trip. Deliberately generous because signing/tx
// approval is user-interactive; its purpose is to release the serialization queue and the
// response listener when the wallet never answers (e.g. the popup is closed), not to rush
// the user.
const ICONEX_REQUEST_TIMEOUT_MS = 300_000;

interface RelayResponseEventDetail {
  type: HanaWalletResponseEvent;
  payload: unknown;
}

export class IconWalletProvider extends BaseWalletProvider<IconWalletDefaults> implements IIconWalletProvider {
  public readonly chainType = 'ICON' as const;
  public readonly iconService: IconService;
  private readonly wallet: IconWallet;

  constructor(wallet: IconWalletConfig) {
    super(wallet.defaults);

    if (isPrivateKeyIconWalletConfig(wallet)) {
      this.wallet = { type: 'PRIVATE_KEY', wallet: Wallet.loadPrivateKey(wallet.privateKey.slice(2)) };
      this.iconService = new IconSdk.IconService(new IconSdk.IconService.HttpProvider(wallet.rpcUrl));
      return;
    }

    if (isBrowserExtensionIconWalletConfig(wallet)) {
      this.wallet = { type: 'BROWSER_EXTENSION', wallet: wallet.walletAddress };
      this.iconService = new IconSdk.IconService(new IconSdk.IconService.HttpProvider(wallet.rpcUrl));
      return;
    }

    throw new Error('Invalid Icon wallet config');
  }

  public async sendTransaction(tx: IcxCallTransaction, options?: IconWalletDefaults): Promise<Hash> {
    const policy = this.mergeDefaults(options);
    const stepLimit = policy.stepLimit ?? DEFAULT_STEP_LIMIT;
    const version = tx.version ?? policy.version ?? DEFAULT_VERSION;
    const timestamp = tx.timestamp ?? policy.timestampProvider?.() ?? Date.now() * 1000;
    const jsonRpcId = policy.jsonRpcId ?? DEFAULT_JSON_RPC_ID;

    const builtTx = new CallTransactionBuilder()
      .from(tx.from)
      .to(tx.to)
      .stepLimit(Converter.toHex(stepLimit))
      .nid(tx.nid)
      .version(version)
      .timestamp(Converter.toHex(timestamp))
      .value(tx.value)
      .method(tx.method)
      .params(tx.params)
      .build();

    if (!isIconPkWallet(this.wallet)) {
      const result = await requestJsonRpc(builtTx, jsonRpcId);
      return result.result satisfies string as Hash;
    }
    const signedTx = new IconSdk.IconService.SignedTransaction(builtTx, this.wallet.wallet);
    const result = await this.iconService.sendTransaction(signedTx).execute();
    return result satisfies string as Hash;
  }

  public async waitForTransactionReceipt(txHash: Hash): Promise<IconTransactionResult> {
    const result = await this.iconService.waitTransactionResult(txHash).execute();
    return {
      ...result,
      status: +result.status,
      cumulativeStepUsed: BigNumberToBigInt(result.cumulativeStepUsed),
      stepUsed: BigNumberToBigInt(result.stepUsed),
      stepPrice: BigNumberToBigInt(result.stepPrice),
    } satisfies IconTransactionResult;
  }

  async getWalletAddress(): Promise<IconEoaAddress> {
    if (!this.wallet.wallet) {
      throw new Error('Wallet not initialized');
    }
    return isIconPkWallet(this.wallet) ? (this.wallet.wallet.getAddress() as IconEoaAddress) : this.wallet.wallet;
  }
}

/**
 * Icon Type Guards
 */

export function isIconPkWallet(wallet: IconWallet): wallet is IconPkWallet {
  return wallet.type === 'PRIVATE_KEY';
}

export function isIconBrowserExtensionWallet(wallet: IconWallet): wallet is IconBrowserExtensionWallet {
  return wallet.type === 'BROWSER_EXTENSION';
}

export function isPrivateKeyIconWalletConfig(config: IconWalletConfig): config is PrivateKeyIconWalletConfig {
  return 'privateKey' in config && config.privateKey.startsWith('0x');
}

export function isBrowserExtensionIconWalletConfig(
  config: IconWalletConfig,
): config is BrowserExtensionIconWalletConfig {
  return 'walletAddress' in config && (isIconEoaAddress(config.walletAddress) || !config.walletAddress);
}

export function isIconAddress(value: unknown): value is IconAddress {
  return typeof value === 'string' && /^hx[a-f0-9]{40}$|^cx[a-f0-9]{40}$/.test(value);
}

export function isIconEoaAddress(value: unknown): value is IconEoaAddress {
  return typeof value === 'string' && /^hx[a-f0-9]{40}$/.test(value);
}

export function isResponseAddressType(value: unknown): value is ResponseAddressType {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'payload' in value &&
    value.type === 'RESPONSE_ADDRESS' &&
    isIconAddress(value.payload)
  );
}

export function isResponseSigningType(value: unknown): value is ResponseSigningType {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'payload' in value &&
    value.type === 'RESPONSE_SIGNING' &&
    typeof value.payload === 'string'
  );
}

export function isJsonRpcPayloadResponse(value: unknown): value is JsonRpcPayloadResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'result' in value &&
    typeof value.result === 'string'
  );
}

/**
 * Methods to interact with Icon Browser Extension Wallet (e.g. Hana Wallet)
 */

type IconexMatch<T> =
  | { readonly kind: 'resolve'; readonly value: T }
  | { readonly kind: 'reject'; readonly error: Error }
  | { readonly kind: 'wait' };

// The ICONEX relay is a single shared window-event channel with no per-request correlation
// id. Serializing requests guarantees at most one is in flight, so a response can never
// resolve a different request's promise. Each request times out and removes its listener on
// settle. (Security audit WALLET-L-1.)
let iconexQueue: Promise<unknown> = Promise.resolve();

function sendIconexRequest<T>(
  request: RelayRequestDetail | RelayRequestSigning,
  match: (detail: RelayResponseEventDetail) => IconexMatch<T>,
): Promise<T> {
  const run = (): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (typeof window === 'undefined') {
        reject(new Error('ICONEX relay requests require a browser environment'));
        return;
      }
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const settle = (apply: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener(ICONEX_RELAY_RESPONSE, handler as EventListener, false);
        apply();
      };
      const handler = (event: Event): void => {
        const result = match((event as CustomEvent<RelayResponseEventDetail>).detail);
        if (result.kind === 'wait') return;
        settle(result.kind === 'resolve' ? () => resolve(result.value) : () => reject(result.error));
      };
      timer = setTimeout(
        () => settle(() => reject(new Error('ICONEX relay request timed out'))),
        ICONEX_REQUEST_TIMEOUT_MS,
      );
      window.addEventListener(ICONEX_RELAY_RESPONSE, handler as EventListener, false);
      window.dispatchEvent(new CustomEvent(ICONEX_RELAY_REQUEST, { detail: request }));
    });

  // Serialize: run after the previous request settles. The tail swallows outcomes so the
  // queue promise never rejects — hence a single `.then(run)` is enough and a failed request
  // can't poison the ones behind it.
  const result = iconexQueue.then(run);
  iconexQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function requestAddress(): Promise<IconAddress> {
  return sendIconexRequest<IconAddress>({ type: 'REQUEST_ADDRESS' }, detail =>
    isResponseAddressType(detail) ? { kind: 'resolve', value: detail.payload } : { kind: 'wait' },
  );
}

export function requestSigning(from: IconAddress, hash: string): Promise<string> {
  return sendIconexRequest<string>({ type: 'REQUEST_SIGNING', payload: { from, hash } }, detail => {
    if (isResponseSigningType(detail)) return { kind: 'resolve', value: detail.payload };
    if (detail.type === 'CANCEL_SIGNING') return { kind: 'reject', error: new Error('CANCEL_SIGNING') };
    return { kind: 'wait' };
  });
}

export function requestJsonRpc(rawTransaction: unknown, id = DEFAULT_JSON_RPC_ID): Promise<JsonRpcPayloadResponse> {
  return sendIconexRequest<JsonRpcPayloadResponse>(
    {
      type: 'REQUEST_JSON-RPC',
      payload: { jsonrpc: '2.0', method: 'icx_sendTransaction', params: rawTransaction, id },
    },
    detail => {
      const { type, payload } = detail;
      if (type === 'RESPONSE_JSON-RPC') {
        // Serialization guarantees this is a response to the one in-flight request. Accept a
        // well-formed payload; a malformed RESPONSE_JSON-RPC is a hard error (fail fast rather
        // than hang until the timeout).
        if (isJsonRpcPayloadResponse(payload)) return { kind: 'resolve', value: payload };
        return { kind: 'reject', error: new Error('Invalid payload response type (expected JsonRpcPayloadResponse)') };
      }
      if (type === 'CANCEL_JSON-RPC') return { kind: 'reject', error: new Error('CANCEL_JSON-RPC') };
      return { kind: 'wait' };
    },
  );
}

/**
 * Icon Utils
 */

export function BigNumberToBigInt(bigNumber: BigNumber): bigint {
  if (!bigNumber.isInteger()) {
    throw new Error('Cannot convert decimal number to BigInt');
  }
  return BigInt(bigNumber.toFixed(0));
}
