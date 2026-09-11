import { ChainTypeArr, type ChainType } from '@sodax/types';
import type { XConnection } from './types/index.js';

export type PersistedXWalletState = {
  xConnections: Partial<Record<ChainType, XConnection>>;
  userDisconnected: Partial<Record<ChainType, boolean>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Sanitize the persisted wallet state read from localStorage before it merges into the store.
 * localStorage is same-origin writable, so the blob is untrusted: keep only well-formed entries for
 * known chains and build fresh objects (never reuse references from the parsed input). This is
 * schema-hardening/robustness only — it does NOT stop a well-formed attacker address.
 */
export function sanitizePersistedXWalletState(persisted: unknown): PersistedXWalletState {
  const out: PersistedXWalletState = { xConnections: {}, userDisconnected: {} };
  if (!isRecord(persisted)) return out;

  const xConnections = isRecord(persisted.xConnections) ? persisted.xConnections : {};
  const userDisconnected = isRecord(persisted.userDisconnected) ? persisted.userDisconnected : {};

  // Iterate the known chain list, never the input's keys, so unknown/`__proto__` keys are ignored.
  for (const chainType of ChainTypeArr) {
    const conn = xConnections[chainType];
    if (
      isRecord(conn) &&
      typeof conn.xConnectorId === 'string' &&
      conn.xConnectorId.length > 0 &&
      isRecord(conn.xAccount)
    ) {
      const { address, xChainType, publicKey } = conn.xAccount;
      if (
        (address === undefined || typeof address === 'string') &&
        xChainType === chainType &&
        (publicKey === undefined || typeof publicKey === 'string')
      ) {
        out.xConnections[chainType] = {
          xConnectorId: conn.xConnectorId,
          xAccount: { address, xChainType: chainType, ...(publicKey !== undefined ? { publicKey } : {}) },
        };
      }
    }

    if (userDisconnected[chainType] === true) {
      out.userDisconnected[chainType] = true;
    }
  }

  return out;
}
