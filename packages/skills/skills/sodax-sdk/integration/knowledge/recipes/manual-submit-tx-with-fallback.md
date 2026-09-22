# Manual submit-tx with client-side fallback

`sodax.swaps.swap()` already does this internally: it creates the intent, tries the backend submit-tx path, and on **any** non-success falls back to the client-side relay. Prefer `swap()` unless the consumer must own each step (a bot that persists every transition, a backend with its own signing boundary, a UI that reports phases).

When they do own the steps, reproduce **both** paths. The orchestration helpers behind `swap()` are package-internal — `SwapService.submitTx` and `SwapService.fallbackSwapSteps` are private, and the attempt budget and poll loop are not exported — so the loop is hand-written from the public pieces below.

Bindings shared by every step below:

```ts
import type { IEvmWalletProvider, SpokeChainKey } from '@sodax/sdk';

declare const evmWallet: IEvmWalletProvider;
declare const srcChainKey: SpokeChainKey;   // === params.srcChainKey
declare const timeoutMs: number;            // per-attempt budget, e.g. DEFAULT_RELAY_TX_TIMEOUT
```

## 1. Create the intent, keep all three values

```ts
const created = await sodax.swaps.createIntent({ params, walletProvider: evmWallet });
if (!created.ok) return created;

const { tx: spokeTxHash, intent, relayData } = created.value;
```

## 2. Build the request

```ts
import type { SubmitTxRequestV2 } from '@sodax/sdk';

const request: SubmitTxRequestV2 = {
  txHash: spokeTxHash as string,
  srcChainKey: params.srcChainKey,
  walletAddress: params.srcAddress,   // the SOURCE address that signed, not the destination
  intent,                             // passes straight through from createIntent
  relayData: relayData.payload,       // the hex STRING, not the { address, payload } object
};
```

Persist `request` **before** submitting. Re-submitting the same `(txHash, srcChainKey)` is idempotent (`data.status: 'duplicate'`); never sign a second deposit to recover.

`request.intent` carries `bigint` fields (`intentId`, `inputAmount`, `minOutputAmount`, `deadline`, `srcChain`, `dstChain`), so plain `JSON.stringify(request)` THROWS — in the exact crash window this step exists to survive. Serialize them, and coerce them back on resume:

```ts
const serialized = JSON.stringify(request, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
```

Passing `intent` straight to `submitTx` still needs no conversion — the wire client serializes internally. Only your own storage does.

## 3. Submit — check both flags

```ts
const submitted = await sodax.api.swaps.submitTx(request);

// `ok` is transport-level only. A 200 can still report the submission was not queued,
// and then there is nothing to poll for.
if (!submitted.ok || !submitted.value.success) return fallback();
```

Do **not** call `verifyTxHash` before this. The backend verifies itself, so a client-side confirmation wait only delays every backend success. Verification belongs to the fallback.

## 4. Poll until `solved`

```ts
import { isAuthFailure } from '@sodax/sdk';
import type { SubmitTxStatusQueryV2 } from '@sodax/sdk';

const query: SubmitTxStatusQueryV2 = { txHash: spokeTxHash as string, srcChainKey };
const deadline = Date.now() + 120_000;

while (Date.now() < deadline) {
  const snapshot = await sodax.api.swaps.getSubmitTxStatus(query);

  if (snapshot.ok) {
    const { status, result, abandonedAt } = snapshot.value.data;
    // Terminal success needs BOTH fields.
    if (status === 'solved' && result?.dstIntentTxHash && result.intent_hash) {
      return { dstTxHash: result.dstIntentTxHash, intentHash: result.intent_hash };
    }
    if (status === 'failed' || abandonedAt) break;          // terminal failure
    // pending | relaying | relayed | posting_execution | posted_execution → keep polling
  } else if (isAuthFailure(snapshot.error)) {
    break;   // a rejected API key cannot become success by waiting
  }

  await new Promise(r => setTimeout(r, 1_000));
}

return fallback();   // every exit other than `solved` is a non-success
```

## 5. Fallback — the client-side relay

```ts
import { relayTxAndWaitPacket, RELAY_FALLBACK_FLOOR_MS, isHubChainKeyType } from '@sodax/sdk';

async function fallback() {
  const verified = await sodax.spoke.verifyTxHash({ txHash: spokeTxHash as string, chainKey: srcChainKey });
  if (!verified.ok) return verified;

  let hubTxHash: string;
  if (isHubChainKeyType(srcChainKey)) {
    hubTxHash = spokeTxHash as string;    // source IS the hub — nothing to relay
  } else {
    const packet = await relayTxAndWaitPacket({
      srcTxHash: spokeTxHash as string,
      data: relayData,                     // the OBJECT here, not the payload string
      chainKey: srcChainKey,
      relayerApiEndpoint: sodax.swaps.relayerApiEndpoint,
      timeout: Math.max(timeoutMs, RELAY_FALLBACK_FLOOR_MS),   // a FRESH budget
    });
    if (!packet.ok) return packet;
    hubTxHash = packet.value.dst_tx_hash;
  }

  return sodax.swaps.postExecution({ intent_tx_hash: hubTxHash as `0x${string}` });
}
```

## Rules

- **Two budgets, never one.** The backend attempt gets a timeout; the fallback relay gets a *fresh* one. A single shared deadline leaves the fallback only what the backend did not spend — that is how a relay that needs longer ends in a timeout.
- **Falling back is safe.** Re-relaying and re-posting an already-processed swap is idempotent: the relay deduplicates and returns the existing `executed` packet, and the solver re-affirms the intent rather than filling twice. It is also load-bearing — the backend keeps processing after the poll gives up, so the two relays can race.
- **Solana / Bitcoin need the exact `relayData` bytes** — those deposits commit only a hash of the payload on-chain. If the runtime value is gone, recover it with `sodax.swaps.getIntentSubmitTxExtraData({ txHash })`, where `txHash` is the **hub-chain** tx hash (it reads the intent off the hub) — not the source-chain `spokeTxHash` used elsewhere here. From an `Intent` you already hold, `sodax.swaps.reconstructRelayData(intent)` derives the same bytes offline.
- **Read status with `getDetailedStatus`**, which routes between the backend record and the solver — do not hand-roll that fallback too.
- Opting out entirely is a config flag, not hand-written code: `new Sodax({ swaps: { useBackendSubmitTx: false } })` makes `swap()` take the client-side path only.

---

## Cross-references

- [`README.md`](README.md) — recipe index.
- [`../features/swap.md`](../features/swap.md) — `SwapService` surface, action params, error codes.
- [`result-and-errors.md`](result-and-errors.md) — branching on `result.ok` and `(feature, code)`.
- [`backend-server-init.md`](backend-server-init.md) — bot / partner-backend setup around this flow.
