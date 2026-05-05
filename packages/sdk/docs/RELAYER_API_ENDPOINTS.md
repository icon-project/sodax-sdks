# Relayer API Endpoints

The intent relay service bridges spoke-chain transactions to the SODAX hub (Sonic). All cross-chain operations — swaps, bridges, money market deposits/withdrawals, staking — submit a spoke-chain transaction hash to the relay, then poll until the hub confirms execution.

## Mainnet

URL: `https://xcall-relay.nw.iconblockchain.xyz`

This is the default value of `DEFAULT_RELAYER_API_ENDPOINT` (exported from `@sodax/sdk`). It is set automatically in `relayConfig.relayerApiEndpoint` and picked up by `ConfigService` — no manual configuration is needed unless you are overriding the endpoint.

## Testnet

URL: `https://testnet-xcall-relay.nw.iconblockchain.xyz`

Pass this URL as the `relayerApiEndpoint` override in your `SodaxConfig` when targeting testnet.

---

## SDK integration

`IntentRelayApiService` (`packages/sdk/src/shared/services/intentRelay/IntentRelayApiService.ts`) is an **internal** module. Callers never construct it directly. The relay is accessed through high-level service methods:

- `sodax.swaps.createIntent(...)` — submits the spoke tx and waits for hub execution internally
- `sodax.bridge.bridge(...)` — similarly manages the full relay lifecycle
- `sodax.moneyMarket.*`, `sodax.staking.*`, and related methods do the same

All of these methods return `Promise<Result<T>>`. On relay failure the `Result` carries an error whose `message` is `'RELAY_TIMEOUT'` or `'SUBMIT_TX_FAILED'` (CODE form — see [error convention](#error-message-convention)).

---

## Chain IDs used by the relay

The relay API identifies chains by **`IntentRelayChainId`** — a `bigint` value that is distinct from the `ChainKeys.*` string keys used everywhere else in the SDK.

Use `getIntentRelayChainId(chainKey)` (exported from `@sodax/sdk`) to convert a `SpokeChainKey` to its relay chain ID. The SDK does this conversion internally; callers only need it when constructing raw relay requests directly (advanced usage).

Full mapping (`RelayChainIdMap` in `@sodax/sdk`):

| Chain key (`ChainKeys.*`) | Relay chain ID |
|---|---|
| `AVALANCHE_MAINNET` | `6n` |
| `ARBITRUM_MAINNET` | `23n` |
| `BASE_MAINNET` | `30n` |
| `BSC_MAINNET` | `4n` |
| `INJECTIVE_MAINNET` | `19n` |
| `SONIC_MAINNET` | `146n` |
| `OPTIMISM_MAINNET` | `24n` |
| `POLYGON_MAINNET` | `5n` |
| `SOLANA_MAINNET` | `1n` |
| `SUI_MAINNET` | `21n` |
| `STELLAR_MAINNET` | `27n` |
| `ICON_MAINNET` | `1768124270n` |
| `HYPEREVM_MAINNET` | `26745n` |
| `LIGHTLINK_MAINNET` | `27756n` |
| `NEAR_MAINNET` | `15n` |
| `ETHEREUM_MAINNET` | `2n` |
| `BITCOIN_MAINNET` | `627463n` |
| `REDBELLY_MAINNET` | `726564n` |
| `KAIA_MAINNET` | `27489n` |
| `STACKS_MAINNET` | `60n` |

---

## Relay API actions

All requests are JSON `POST` to the relay URL. The `action` field selects the operation.

### `submit` — submit a transaction for relaying

```ts
// TypeScript type (from IntentRelayApiService.ts)
type SubmitTxParams = {
  chain_id: string;   // relay chain ID as a decimal string (e.g. "2" for Ethereum)
  tx_hash: string;    // spoke-chain transaction hash
  data?: RelayExtraData; // required only for Solana and Bitcoin (split-tx chains)
};
```

`RelayExtraData` (`{ address: Hex; payload: Hex }`) carries the hub destination address and the full call payload. Solana and Bitcoin use split transactions: the on-chain tx stores only a verification hash; the full call data is submitted off-chain here.

```
curl --location 'https://xcall-relay.nw.iconblockchain.xyz/' \
--header 'Content-Type: application/json' \
--data '{
    "action": "submit",
    "params": {
        "chain_id": "2",
        "tx_hash": "0x882370113410cf4db551d89f2a8dc1819a2e4d9e1d5efe19068156d3ff1b91b7"
    }
}'
```

Response (`SubmitTxResponse`):

```json
{ "success": true, "message": "..." }
```

### `get_transaction_packets` — poll for relay packets by tx hash

```ts
type GetTransactionPacketsParams = {
  chain_id: string;
  tx_hash: string;
};
```

```
curl --location 'https://xcall-relay.nw.iconblockchain.xyz/' \
--header 'Content-Type: application/json' \
--data '{
    "action": "get_transaction_packets",
    "params": {
        "chain_id": "2",
        "tx_hash": "0x882370113410cf4db551d89f2a8dc1819a2e4d9e1d5efe19068156d3ff1b91b7"
    }
}'
```

Response (`GetTransactionPacketsResponse`):

```ts
type RelayTxStatus = 'pending' | 'validating' | 'executing' | 'executed';

type PacketData = {
  src_chain_id: number;
  src_tx_hash: string;
  src_address: string;
  status: RelayTxStatus;
  dst_chain_id: number;
  conn_sn: number;
  dst_address: string;
  dst_tx_hash: string;   // hub-chain tx hash — use this for subsequent solver queries
  signatures: string[];
  payload: string;
};

type GetTransactionPacketsResponse = {
  success: boolean;
  data: PacketData[];
};
```

The packet is complete when `status === 'executed'`. Use `dst_tx_hash` as the hub-chain transaction hash for subsequent solver interactions.

### `get_packet` — fetch a single packet by connection serial number

```ts
type GetPacketParams = {
  chain_id: string;
  tx_hash: string;
  conn_sn: string;   // connection serial number
};
```

```
curl --location 'https://xcall-relay.nw.iconblockchain.xyz/' \
--header 'Content-Type: application/json' \
--data '{
    "action": "get_packet",
    "params": {
        "chain_id": "2",
        "tx_hash": "0x882370113410cf4db551d89f2a8dc1819a2e4d9e1d5efe19068156d3ff1b91b7",
        "conn_sn": "169"
    }
}'
```

Response (`GetPacketResponse`):

```ts
type GetPacketResponse =
  | { success: true; data: PacketData }
  | { success: false; message: string };
```

---

## Low-level functions (advanced usage)

These are exported from `IntentRelayApiService` for callers that need direct relay access (e.g. custom orchestration, bots):

| Function | Signature | Description |
|---|---|---|
| `submitTransaction` | `(payload, apiUrl) => Promise<Result<SubmitTxResponse>>` | Submit a tx to the relay. |
| `getTransactionPackets` | `(payload, apiUrl) => Promise<Result<GetTransactionPacketsResponse>>` | Fetch packets for a tx hash. |
| `getPacket` | `(payload, apiUrl) => Promise<Result<GetPacketResponse>>` | Fetch a single packet by `conn_sn`. |
| `waitUntilIntentExecuted` | `(payload) => Promise<Result<PacketData>>` | Poll until a packet reaches `'executed'` status or times out. |
| `relayTxAndWaitPacket` | `(params: RelayAndWaitParams) => Promise<Result<PacketData>>` | Submit + poll in one call. Handles `getIntentRelayChainId` conversion and split-tx chains automatically. |

All functions return `Promise<Result<T>>` — no throws across service boundaries. Check `result.ok` before using `result.value`. On failure, `result.error` is an `Error` instance:
- `result.error.message === 'RELAY_TIMEOUT'` — packet did not arrive within the timeout (default: 120 000 ms)
- `result.error.message === 'SUBMIT_TX_FAILED'` — the relay rejected the submission; check `result.error.cause.message` for the relay's rejection reason
- `result.error.message === 'HTTP_REQUEST_FAILED'` — network-level failure; check `result.error.cause` for details

`RelayAndWaitParams`:

```ts
type RelayAndWaitParams = {
  srcTxHash: string;
  data: RelayExtraData;         // required for Solana/Bitcoin; ignored for all other chains
  chainKey: SpokeChainKey;      // e.g. ChainKeys.ETHEREUM_MAINNET
  relayerApiEndpoint: HttpUrl;  // relay base URL
  timeout: number | undefined;  // ms; defaults to DEFAULT_RELAY_TX_TIMEOUT (120 000 ms)
};
```

Example:

```ts
import { relayTxAndWaitPacket, getIntentRelayChainId } from '@sodax/sdk';
import { ChainKeys, DEFAULT_RELAY_TX_TIMEOUT } from '@sodax/sdk';

const result = await relayTxAndWaitPacket({
  srcTxHash: '0x...',
  data: undefined,  // not a Solana/Bitcoin tx
  chainKey: ChainKeys.ETHEREUM_MAINNET,
  relayerApiEndpoint: 'https://xcall-relay.nw.iconblockchain.xyz',
  timeout: DEFAULT_RELAY_TX_TIMEOUT,
});

if (!result.ok) {
  if (result.error instanceof Error && result.error.message === 'RELAY_TIMEOUT') {
    // timed out waiting for hub execution
  }
  return;
}

const hubTxHash = result.value.dst_tx_hash;
```
