import * as rlp from 'rlp';
import type { Address } from 'viem';
import type { PacketData } from '../shared/types/relay-types.js';

/**
 * Decodes a relay packet payload (RLP) and returns field[1] — the cross-chain message target —
 * as a lowercase `0x`-prefixed hex string, or `undefined` if the payload is malformed or has no
 * field[1]. Never throws.
 */
export function decodePacketIntentTarget(payload: string): string | undefined {
  try {
    const hex = payload.startsWith('0x') ? payload.slice(2) : payload;
    const decoded = rlp.decode(Buffer.from(hex, 'hex')) as unknown as Uint8Array[];
    const field1 = decoded?.[1];
    if (!field1 || field1.length === 0) return undefined;
    return `0x${Buffer.from(field1).toString('hex')}`.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Selects the user-facing `IntentFilled` destination packet from candidates that share a src tx
 * hash. A single solver fill tx emits multiple relay packets; the correct one is the packet whose
 * payload field[1] equals the hub intents contract. Without this, the relayer's array order picks
 * the wrong packet (its `dst_tx_hash` is an internal hop, not the user's delivery tx).
 *
 * Fallbacks (deliberate last resort, not an oversight). These rely on two assumptions:
 *   (a) the relayer returns all packets for a fill tx together, so a single-candidate poll is the
 *       genuine single-packet case rather than a partial-indexing window mid-fill; and
 *   (b) `field[1]` stays the message target so the primary match identifies the right packet.
 * If either breaks, the symptom is a wrong `dst_tx_hash` (or silent drift) — at that point switch
 * to strict matching (return the field[1] match or `undefined`, letting the poller time out loudly).
 *  - exactly one candidate → that candidate (single-packet flows, unchanged)
 *  - multiple candidates, no field[1] match → the highest `conn_sn` (last ordered by conn_sn)
 */
export function selectSolvedIntentPacket(packets: PacketData[], intentsContract: Address): PacketData | undefined {
  if (packets.length <= 1) return packets[0];
  const target = intentsContract.toLowerCase();
  const matched = packets.find(packet => decodePacketIntentTarget(packet.payload) === target);
  if (matched) return matched;
  return packets.reduce((highest, packet) => (packet.conn_sn > highest.conn_sn ? packet : highest));
}
