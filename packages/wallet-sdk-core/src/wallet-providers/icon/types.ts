import type { Wallet as IconSdkWallet } from 'icon-sdk-js';

export type IconJsonRpcVersion = '2.0';

export type Hex = `0x${string}`;
export type Hash = `0x${string}`;
export type IconAddress = `hx${string}` | `cx${string}`;
export type IconEoaAddress = `hx${string}`;

/** Defaults applied to every call. Per-call options shallow-merge over these. */
export type IconWalletDefaults = {
  /** Step limit (gas) for transactions. Default `3_000_000`. */
  stepLimit?: number;
  /** Transaction version. Default `'0x3'`. */
  version?: string;
  /** Timestamp generator (microseconds). Default `() => Date.now() * 1000`. */
  timestampProvider?: () => number;
  /** Event ID for `requestJsonRpc` (browser-extension path). Default `99999`. */
  jsonRpcId?: number;
};

/** Configuration for constructing an `IconWalletProvider` backed by a raw private key. */
export type PrivateKeyIconWalletConfig = {
  privateKey: `0x${string}`;
  rpcUrl: `http${string}`;
  defaults?: IconWalletDefaults;
};

/** Configuration for constructing an `IconWalletProvider` backed by a browser-extension wallet (Hana Wallet). */
export type BrowserExtensionIconWalletConfig = {
  walletAddress?: IconEoaAddress;
  rpcUrl: `http${string}`;
  defaults?: IconWalletDefaults;
};

export type IconWalletConfig = PrivateKeyIconWalletConfig | BrowserExtensionIconWalletConfig;

export type IconPkWallet = {
  type: 'PRIVATE_KEY';
  wallet: IconSdkWallet;
};

export type IconBrowserExtensionWallet = {
  type: 'BROWSER_EXTENSION';
  wallet?: IconEoaAddress;
};

export type IconWallet = IconPkWallet | IconBrowserExtensionWallet;

export type HanaWalletRequestEvent =
  | 'REQUEST_HAS_ACCOUNT'
  | 'REQUEST_HAS_ADDRESS'
  | 'REQUEST_ADDRESS'
  | 'REQUEST_JSON'
  | 'REQUEST_SIGNING'
  | 'REQUEST_JSON-RPC';

export type HanaWalletResponseEvent =
  | 'RESPONSE_HAS_ACCOUNT'
  | 'RESPONSE_HAS_ADDRESS'
  | 'RESPONSE_ADDRESS'
  | 'RESPONSE_JSON-RPC'
  | 'RESPONSE_SIGNING'
  | 'CANCEL_SIGNING'
  | 'CANCEL_JSON-RPC';

export type ResponseAddressType = {
  type: 'RESPONSE_ADDRESS';
  payload: IconAddress;
};

export type ResponseSigningType = {
  type: 'RESPONSE_SIGNING';
  payload: string;
};

export type RelayRequestDetail = {
  type: HanaWalletRequestEvent;
  payload?: {
    jsonrpc: IconJsonRpcVersion;
    method: string;
    params: unknown;
    id: number | undefined;
  };
};

export type RelayRequestSigning = {
  type: 'REQUEST_SIGNING';
  payload: {
    from: IconAddress;
    hash: string;
  };
};

export type JsonRpcPayloadResponse = {
  id: number;
  result: string;
};
