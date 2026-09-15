import { isJsonRpcPayloadResponse, isResponseAddressType, isResponseSigningType } from '../../guards.js';
import type { IconAddress, Result } from '@sodax/types';
export type { ResponseAddressType, ResponseSigningType, JsonRpcPayloadResponse } from './icon-wallet-types.js';
import type { JsonRpcPayloadResponse } from './icon-wallet-types.js';

export type IconJsonRpcVersion = '2.0';

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

interface RelayResponseEventDetail {
  type: HanaWalletResponseEvent;
  payload: unknown;
}

const ICONEX_RELAY_REQUEST = 'ICONEX_RELAY_REQUEST';
const ICONEX_RELAY_RESPONSE = 'ICONEX_RELAY_RESPONSE';
const DEFAULT_JSON_RPC_ID = 99999;
// Upper bound for a single ICONEX round-trip. Deliberately generous because signing/tx
// approval is user-interactive; its purpose is to release the serialization queue and the
// response listener when the wallet never answers (e.g. the popup is closed), not to rush
// the user.
const ICONEX_REQUEST_TIMEOUT_MS = 300_000;

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

export function requestAddress(): Promise<Result<IconAddress>> {
  return sendIconexRequest<Result<IconAddress>>({ type: 'REQUEST_ADDRESS' }, detail =>
    isResponseAddressType(detail) ? { kind: 'resolve', value: { ok: true, value: detail.payload } } : { kind: 'wait' },
  );
}

export function requestSigning(from: IconAddress, hash: string): Promise<Result<string>> {
  return sendIconexRequest<Result<string>>({ type: 'REQUEST_SIGNING', payload: { from, hash } }, detail => {
    if (isResponseSigningType(detail)) return { kind: 'resolve', value: { ok: true, value: detail.payload } };
    if (detail.type === 'CANCEL_SIGNING') return { kind: 'reject', error: new Error('CANCEL_SIGNING') };
    return { kind: 'wait' };
  });
}

export function requestJsonRpc(
  rawTransaction: unknown,
  id = DEFAULT_JSON_RPC_ID,
): Promise<Result<JsonRpcPayloadResponse>> {
  return sendIconexRequest<Result<JsonRpcPayloadResponse>>(
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
        if (isJsonRpcPayloadResponse(payload)) return { kind: 'resolve', value: { ok: true, value: payload } };
        return { kind: 'reject', error: new Error('Invalid payload response type (expected JsonRpcPayloadResponse)') };
      }
      if (type === 'CANCEL_JSON-RPC') return { kind: 'reject', error: new Error('CANCEL_JSON-RPC') };
      return { kind: 'wait' };
    },
  );
}
