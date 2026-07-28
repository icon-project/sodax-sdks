import { describe, expect, it } from 'vitest';
import { type Intent, getChainKeyFromRelayChainId, relayTxAndWaitPacket, Sodax } from '../index.js';

/**
 * Live (mainnet) proof of the idempotency guarantee that `SwapService.swap()`'s backend 2-step
 * fallback relies on: re-relaying an already-relayed tx returns the existing `executed` packet, and
 * re-posting an already-posted intent returns `{ answer: 'OK', intent_hash }`. So falling back after a
 * backend submit-tx non-success cannot double-fill. Runs under `test:e2e` (the hardcoded inputs below
 * must be real already-relayed/posted data) — not part of the normal `pnpm test` gate.
 */
describe('e2e relay/submit/post solver execution tests', () => {
  const sodax = new Sodax();

  it('test post solver execution response for already posted intent', async () => {
    const postExecResult = await sodax.swaps.postExecution({
      intent_tx_hash: '0x8afb42d1239c10c39fa02fb54ff9884315038c62085f4f358e1a2a4be153f8e5',
    });
    expect(postExecResult.ok).toBe(true);
    expect(postExecResult.ok && postExecResult.value.answer).toBe('OK');
    expect(postExecResult.ok && postExecResult.value.intent_hash).toBe(
      '0x8afb42d1239c10c39fa02fb54ff9884315038c62085f4f358e1a2a4be153f8e5',
    );
  }, 20_000);

  it('test relay response for existing relayed intent data', async () => {
    const intent = {
      intentId: BigInt('61230497544774697971291360728544462101061514235049718291661154643969539650550'),
      creator: '0xA227B184a182BC87CC8DBa6be54C132361FdB568',
      inputToken: '0xDcd9578b51EF55239B6e68629D822A8D97C95b86',
      outputToken: '0x9Ee17486571917837210824b0d4CAdfe3B324D12',
      inputAmount: BigInt('100000000000000'),
      minOutputAmount: BigInt('2105821135111652250'),
      deadline: BigInt('1781185289'),
      allowPartialFill: false,
      srcChain: 23n,
      dstChain: 5n,
      srcAddress: '0x0ab764ab3816cd036ea951be973098510d8105a6',
      dstAddress: '0x0ab764ab3816cd036ea951be973098510d8105a6',
      solver: '0x0000000000000000000000000000000000000000',
      data: '0x',
    } satisfies Intent;
    const relayData = sodax.swaps.reconstructRelayData(intent);

    if (!relayData.ok) {
      throw new Error('Failed to reconstruct relay data');
    }

    const packet = await relayTxAndWaitPacket({
      srcTxHash: '0x8b9f0fa54446343fdcef1f0adbe9a4121bb469207085e277c3a2a9cb817a675b',
      data: relayData.value,
      chainKey: getChainKeyFromRelayChainId(intent.srcChain),
      relayerApiEndpoint: sodax.config.relay.relayerApiEndpoint,
      timeout: 20_000,
    });

    expect(packet.ok).toBe(true);
    expect(packet.ok && packet.value.status).toBe('executed');
  }, 20_000);
});
