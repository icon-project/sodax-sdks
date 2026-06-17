import { describe, expect, it } from 'vitest';
import { ChainKeys } from '@sodax/types';
import { Sodax } from '../index.js';

/**
 * E2e test that hits the live relayer API (default `relayerApiEndpoint`) with a real solver fill
 * tx and asserts `getSolvedIntentPacket` returns the user-facing `IntentFilled` delivery packet.
 *
 * The fill tx lives on the Sonic hub (relay `chain_id` 146). The relayer returns TWO packets
 * sharing this `src_tx_hash`; the fix must select the delivery packet (conn_sn 174635 → HyperEVM
 * 26745), not the internal-hop packet (conn_sn 174634 → 0x29dd…) that the old `.find()` picked.
 *
 * Network-dependent by design: if the relayer ever prunes this tx, it surfaces as RELAY_TIMEOUT
 * and the `result.ok` assertion fails loudly rather than silently passing.
 */
const FILL_TX_HASH = '0xf113095ccbadfefbf7bc8b62eb1c894d75ca485843b9bbd351c4a2f78b94ce61';
const EXPECTED_DST_TX_HASH = '0xcc4cc5b6977d98909696859d0d6b9c967f573ea87d9503ab960b8f22c2db79f4';
const WRONG_DST_TX_HASH = '0x29dd2ae8a3c6e1a4ed791aca307a8754fc3951b2f067564f38e40e49f435cc54';

describe('SwapService.getSolvedIntentPacket (e2e, live relayer)', () => {
  const sodax = new Sodax();

  it('selects the user-facing IntentFilled packet for a multi-packet fill tx', async () => {
    const result = await sodax.swaps.getSolvedIntentPacket({
      chainId: ChainKeys.SONIC_MAINNET, // → relay chain_id "146", the fill tx's source chain
      fillTxHash: FILL_TX_HASH,
      timeout: 60_000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.conn_sn).toBe(174635);
      expect(result.value.dst_tx_hash).toBe(EXPECTED_DST_TX_HASH);
      expect(result.value.dst_tx_hash).not.toBe(WRONG_DST_TX_HASH);
      expect(result.value.dst_chain_id).toBe(26745); // HyperEVM
    }
  });
});
