# Backend API Service Documentation

The `BackendApiService` provides a comprehensive HTTP client for the SODAX backend API, covering intent lookup, swap submission, solver orderbook, money market data, and runtime configuration. It implements `IConfigApi` so that `ConfigService` and other services can fetch dynamic chain/token configuration without coupling to a concrete HTTP implementation.

The service is automatically instantiated when you create a `Sodax` instance and is available as `sodax.backendApi`.

All public methods return `Promise<Result<T>>` — they never throw. On network failure, timeout, or a non-2xx HTTP response the returned `Result` has `ok: false` with a descriptive `Error` in the `error` field.

## Table of Contents

- [Initialization](#initialization)
- [Configuration](#configuration)
- [Result\<T\> and Error Handling](#resultt-and-error-handling)
- [Intent Endpoints](#intent-endpoints)
- [Swap Endpoints](#swap-endpoints)
- [Solver Endpoints](#solver-endpoints)
- [Money Market Endpoints](#money-market-endpoints)
- [Config Endpoints](#config-endpoints)
- [Utility Methods](#utility-methods)
- [Complete Example](#complete-example)
- [Notes](#notes)

## Initialization

`BackendApiService` is automatically created when you construct a `Sodax` instance. Access it via `sodax.backendApi`.

### Basic Initialization

```typescript
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax();
const backendApi = sodax.backendApi;
```

### Custom Configuration

```typescript
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax({
  api: {
    baseURL: 'https://your-custom-api-endpoint.com',
    timeout: 60000, // 60 seconds
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Custom-Header': 'custom-value',
    },
  },
});

const backendApi = sodax.backendApi;
```

### Initialization with `sodax.config`

If you need dynamic chain/token config fetched from the backend, call `initialize()` on `ConfigService` after construction. `BackendApiService` is the underlying HTTP transport that `ConfigService` uses.

```typescript
const sodax = new Sodax();
const result = await sodax.config.initialize();
if (!result.ok) {
  console.error('Config initialization failed:', result.error);
}
```

## Configuration

### `ApiConfig` Type

```typescript
type ApiConfig = {
  baseURL: string;                   // API endpoint URL (default: 'https://api.sodax.com/v1/be')
  timeout: number;                   // Request timeout in milliseconds (default: 30000)
  headers: Record<string, string>;   // Request headers (default: Content-Type and Accept)
};
```

### `RequestOverrideConfig` Type

Every public method accepts an optional `RequestOverrideConfig` as its last argument. These per-call overrides take precedence over the `ApiConfig` the service was constructed with.

```typescript
type RequestOverrideConfig = {
  baseURL?: string;
  timeout?: number;
  headers?: Record<string, string>;
};
```

### Default Configuration

```typescript
const DEFAULT_BACKEND_API_ENDPOINT = 'https://api.sodax.com/v1/be';
const DEFAULT_BACKEND_API_TIMEOUT = 30000; // 30 seconds
const DEFAULT_BACKEND_API_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};
```

## Result\<T\> and Error Handling

All public methods return `Promise<Result<T>>`, defined as:

```typescript
type Result<T, E = Error | unknown> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

**Never use `try/catch` around `backendApi` calls** — errors are always captured in the `Result`.

### Checking results

```typescript
const result = await sodax.backendApi.getOrderbook({ offset: '0', limit: '10' });
if (!result.ok) {
  // result.error is an Error instance
  console.error(result.error.message); // e.g. 'HTTP_REQUEST_FAILED', 'REQUEST_TIMEOUT'
  if (result.error instanceof Error && result.error.cause) {
    console.error('Underlying cause:', result.error.cause);
  }
  return;
}
console.log(result.value); // OrderbookResponse
```

### Error codes on `error.message`

| `error.message` | Meaning |
|---|---|
| `'HTTP_REQUEST_FAILED'` | Non-2xx HTTP response. Check `error.cause` for `HTTP <status>: <body>`. |
| `'REQUEST_TIMEOUT'` | Request exceeded the configured timeout. Check `error.cause` for the timeout duration. |
| `'UNKNOWN_REQUEST_ERROR'` | Any other unexpected failure. |

## Intent Endpoints

### Get Intent by Transaction Hash

Retrieves swap intent details using a hub-chain transaction hash.

```typescript
const result = await sodax.backendApi.getIntentByTxHash('0x123...abc');
if (result.ok) {
  console.log(result.value); // IntentResponse
}
```

**Signature:**
```typescript
getIntentByTxHash(
  txHash: string,
  config?: RequestOverrideConfig,
): Promise<Result<IntentResponse>>
```

- **Method:** GET
- **Endpoint:** `/intent/tx/{txHash}`

**Response type:**
```typescript
interface IntentResponse {
  intentHash: string;
  txHash: string;
  logIndex: number;
  chainId: number;
  blockNumber: number;
  open: boolean;
  intent: {
    intentId: string;
    creator: string;
    inputToken: `0x${string}`;
    outputToken: `0x${string}`;
    inputAmount: string;
    minOutputAmount: string;
    deadline: string;
    allowPartialFill: boolean;
    srcChain: number;
    dstChain: number;
    srcAddress: `0x${string}`;
    dstAddress: `0x${string}`;
    solver: string;
    data: string;
  };
  events: unknown[];
}
```

### Get Intent by Intent Hash

Retrieves swap intent details using a canonical intent hash.

```typescript
const result = await sodax.backendApi.getIntentByHash('0x456...def');
```

**Signature:**
```typescript
getIntentByHash(
  intentHash: string,
  config?: RequestOverrideConfig,
): Promise<Result<IntentResponse>>
```

- **Method:** GET
- **Endpoint:** `/intent/{intentHash}`

**Response:** Same as `IntentResponse` above.

### Get User Intents

Retrieves a paginated list of all swap intents created by a specific wallet address, with optional date-range filtering.

`startDate` and `endDate` are Unix timestamps in **milliseconds**.

```typescript
const result = await sodax.backendApi.getUserIntents({
  userAddress: '0x789...ghi',
  startDate: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7 days ago
  endDate: Date.now(),
  limit: '20',
  offset: '0',
});
```

**Signature:**
```typescript
getUserIntents(
  params: {
    userAddress: Address;
    startDate?: number;
    endDate?: number;
    limit?: string;
    offset?: string;
  },
  config?: RequestOverrideConfig,
): Promise<Result<UserIntentsResponse>>
```

- **Method:** GET
- **Endpoint:** `/intent/user/{userAddress}?startDate=…&endDate=…&limit=…&offset=…`

**Response type:**
```typescript
interface UserIntentsResponse {
  total: number;
  offset: number;
  limit: number;
  items: IntentResponse[];
}
```

## Swap Endpoints

### Submit Swap Transaction

Submits a signed spoke-chain swap transaction to the backend for relay processing. The backend relays the transaction to the hub chain, posts execution data to the solver, and advances the intent through its lifecycle.

```typescript
const result = await sodax.backendApi.submitSwapTx({
  txHash: '0x123...abc',
  srcChainKey: 'arbitrum',
  // ... other SubmitSwapTxRequest fields
});
if (result.ok) {
  console.log(result.value.success, result.value.message);
}
```

**Signature:**
```typescript
submitSwapTx(
  params: SubmitSwapTxRequest,
  config?: RequestOverrideConfig,
): Promise<Result<SubmitSwapTxResponse>>
```

- **Method:** POST
- **Endpoint:** `/swaps/submit-tx`

### Get Submit Swap Transaction Status

Polls the backend relay pipeline for the current status of a previously submitted swap transaction.

Status progresses through: `pending` → `verifying` → `verified` → `relaying` → `relayed` → `posting_execution` → `executed` (or `failed`).

```typescript
const result = await sodax.backendApi.getSubmitSwapTxStatus({
  txHash: '0x123...abc',
  srcChainKey: 'arbitrum',
});
if (result.ok) {
  console.log(result.value.status, result.value.failureReason, result.value.dstIntentTxHash);
}
```

**Signature:**
```typescript
getSubmitSwapTxStatus(
  params: GetSubmitSwapTxStatusParams,
  config?: RequestOverrideConfig,
): Promise<Result<SubmitSwapTxStatusResponse>>
```

- **Method:** GET
- **Endpoint:** `/swaps/submit-tx/status?txHash=…&srcChainKey=…`

## Solver Endpoints

### Get Orderbook

Retrieves a paginated snapshot of the solver orderbook — open swap intents waiting to be filled.

```typescript
const result = await sodax.backendApi.getOrderbook({ offset: '0', limit: '10' });
if (result.ok) {
  console.log(result.value.total, result.value.data);
}
```

**Signature:**
```typescript
getOrderbook(
  params: { offset: string; limit: string },
  config?: RequestOverrideConfig,
): Promise<Result<OrderbookResponse>>
```

- **Method:** GET
- **Endpoint:** `/solver/orderbook?offset={offset}&limit={limit}`

**Response type:**
```typescript
interface OrderbookResponse {
  total: number;
  data: Array<{
    intentState: {
      exists: boolean;
      remainingInput: string;
      receivedOutput: string;
      pendingPayment: boolean;
    };
    intentData: {
      intentId: string;
      creator: string;
      inputToken: string;
      outputToken: string;
      inputAmount: string;
      minOutputAmount: string;
      deadline: string;
      allowPartialFill: boolean;
      srcChain: number;
      dstChain: number;
      srcAddress: string;
      dstAddress: string;
      solver: string;
      data: string;
      intentHash: string;
      txHash: string;
      blockNumber: number;
    };
  }>;
}
```

## Money Market Endpoints

### Get User Position

Retrieves the current money market position for a wallet address — all reserves where the user holds aTokens (supplied collateral) or variable-debt tokens (outstanding borrows).

```typescript
const result = await sodax.backendApi.getMoneyMarketPosition('0x789...ghi');
if (result.ok) {
  console.log(result.value.positions);
}
```

**Signature:**
```typescript
getMoneyMarketPosition(
  userAddress: string,
  config?: RequestOverrideConfig,
): Promise<Result<MoneyMarketPosition>>
```

- **Method:** GET
- **Endpoint:** `/moneymarket/position/{userAddress}`

**Response type:**
```typescript
interface MoneyMarketPosition {
  userAddress: string;
  positions: Array<{
    reserveAddress: string;
    aTokenAddress: string;
    variableDebtTokenAddress: string;
    aTokenBalance: string;
    variableDebtTokenBalance: string;
    blockNumber: number;
  }>;
}
```

### Get All Money Market Assets

Retrieves on-chain state snapshots for every active money market reserve asset.

```typescript
const result = await sodax.backendApi.getAllMoneyMarketAssets();
if (result.ok) {
  console.log(result.value); // MoneyMarketAsset[]
}
```

**Signature:**
```typescript
getAllMoneyMarketAssets(
  config?: RequestOverrideConfig,
): Promise<Result<MoneyMarketAsset[]>>
```

- **Method:** GET
- **Endpoint:** `/moneymarket/asset/all`

**Response type:**
```typescript
interface MoneyMarketAsset {
  reserveAddress: string;
  aTokenAddress: string;
  totalATokenBalance: string;
  variableDebtTokenAddress: string;
  totalVariableDebtTokenBalance: string;
  liquidityRate: string;
  symbol: string;
  totalSuppliers: number;
  totalBorrowers: number;
  variableBorrowRate: string;
  stableBorrowRate: string;
  liquidityIndex: string;
  variableBorrowIndex: string;
  blockNumber: number;
}
```

### Get Specific Money Market Asset

Retrieves the on-chain state snapshot for a single money market reserve asset.

```typescript
const result = await sodax.backendApi.getMoneyMarketAsset('0xabc...123');
```

**Signature:**
```typescript
getMoneyMarketAsset(
  reserveAddress: string,
  config?: RequestOverrideConfig,
): Promise<Result<MoneyMarketAsset>>
```

- **Method:** GET
- **Endpoint:** `/moneymarket/asset/{reserveAddress}`

**Response:** `MoneyMarketAsset` (same interface as above).

### Get Asset Borrowers

Retrieves a paginated list of wallets with an outstanding borrow against a specific reserve.

```typescript
const result = await sodax.backendApi.getMoneyMarketAssetBorrowers(
  '0xabc...123',
  { offset: '0', limit: '10' },
);
```

**Signature:**
```typescript
getMoneyMarketAssetBorrowers(
  reserveAddress: string,
  params: { offset: string; limit: string },
  config?: RequestOverrideConfig,
): Promise<Result<MoneyMarketAssetBorrowers>>
```

- **Method:** GET
- **Endpoint:** `/moneymarket/asset/{reserveAddress}/borrowers?offset={offset}&limit={limit}`

**Response type:**
```typescript
interface MoneyMarketAssetBorrowers {
  borrowers: string[];
  total: number;
  offset: number;
  limit: number;
}
```

### Get Asset Suppliers

Retrieves a paginated list of wallets with an active supply (aToken balance) in a specific reserve.

```typescript
const result = await sodax.backendApi.getMoneyMarketAssetSuppliers(
  '0xabc...123',
  { offset: '0', limit: '10' },
);
```

**Signature:**
```typescript
getMoneyMarketAssetSuppliers(
  reserveAddress: string,
  params: { offset: string; limit: string },
  config?: RequestOverrideConfig,
): Promise<Result<MoneyMarketAssetSuppliers>>
```

- **Method:** GET
- **Endpoint:** `/moneymarket/asset/{reserveAddress}/suppliers?offset={offset}&limit={limit}`

**Response type:**
```typescript
interface MoneyMarketAssetSuppliers {
  suppliers: string[];
  total: number;
  offset: number;
  limit: number;
}
```

### Get All Money Market Borrowers

Retrieves a paginated list of all wallet addresses that hold an active borrow position across any reserve.

```typescript
const result = await sodax.backendApi.getAllMoneyMarketBorrowers({
  offset: '0',
  limit: '10',
});
```

**Signature:**
```typescript
getAllMoneyMarketBorrowers(
  params: { offset: string; limit: string },
  config?: RequestOverrideConfig,
): Promise<Result<MoneyMarketBorrowers>>
```

- **Method:** GET
- **Endpoint:** `/moneymarket/borrowers?offset={offset}&limit={limit}`

**Response type:**
```typescript
interface MoneyMarketBorrowers {
  borrowers: string[];
  total: number;
  offset: number;
  limit: number;
}
```

## Config Endpoints

These methods implement `IConfigApi` and are consumed internally by `ConfigService`. You generally do not call them directly — use `sodax.config` instead. They are documented here for completeness and for custom `IConfigApi` implementations.

| Method | Endpoint | Returns |
|---|---|---|
| `getAllConfig()` | `GET /config/all` | `GetAllConfigApiResponse` — full `SodaxConfig` bundle |
| `getChains()` | `GET /config/spoke/chains` | `GetChainsApiResponse` — array of supported `SpokeChainKey` strings |
| `getSwapTokens()` | `GET /config/swap/tokens` | `GetSwapTokensApiResponse` — `Record<SpokeChainKey, readonly XToken[]>` |
| `getSwapTokensByChainId(chainKey)` | `GET /config/swap/{chainKey}/tokens` | `GetSwapTokensByChainIdApiResponse` |
| `getMoneyMarketTokens()` | `GET /config/money-market/tokens` | `GetMoneyMarketTokensApiResponse` |
| `getMoneyMarketTokensByChainId(chainKey)` | `GET /config/money-market/{chainKey}/tokens` | `GetMoneyMarketTokensByChainIdApiResponse` |
| `getMoneyMarketReserveAssets()` | `GET /config/money-market/reserve-assets` | `GetMoneyMarketReserveAssetsApiResponse` — array of reserve `Address` strings |
| `getRelayChainIdMap()` | `GET /config/relay/chain-id-map` | `GetRelayChainIdMapApiResponse` — `SpokeChainKey → relay chain ID` map |
| `getSpokeChainConfig()` | `GET /config/spoke/all-chains-configs` | `GetSpokeChainConfigApiResponse` — full `SpokeChainConfigMap` |

All methods accept an optional `RequestOverrideConfig` as their last argument and return `Promise<Result<T>>`.

## Utility Methods

### Set Custom Headers

Merges additional headers into the service's default header set. Useful for injecting authentication tokens or tracing headers at runtime without constructing a new service instance.

```typescript
sodax.backendApi.setHeaders({
  'Authorization': 'Bearer new-token',
  'X-Trace-Id': 'req-abc123',
});
```

### Get Base URL

Returns the base URL the service is currently pointing at.

```typescript
const baseURL = sodax.backendApi.getBaseURL();
console.log('API Base URL:', baseURL);
```

## Complete Example

```typescript
import { Sodax } from '@sodax/sdk';

async function example() {
  const sodax = new Sodax({
    api: {
      baseURL: 'https://api.sodax.com/v1/be',
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Authorization': 'Bearer your-api-token',
      },
    },
  });

  // Get solver orderbook
  const orderbookResult = await sodax.backendApi.getOrderbook({ offset: '0', limit: '5' });
  if (!orderbookResult.ok) {
    console.error('Orderbook error:', orderbookResult.error.message);
    return;
  }
  console.log('Orderbook:', orderbookResult.value);

  // Get user's money market position
  const positionResult = await sodax.backendApi.getMoneyMarketPosition('0x789...ghi');
  if (!positionResult.ok) {
    console.error('Position error:', positionResult.error.message);
    return;
  }
  console.log('User Position:', positionResult.value);

  // Get all money market assets
  const assetsResult = await sodax.backendApi.getAllMoneyMarketAssets();
  if (!assetsResult.ok) {
    console.error('Assets error:', assetsResult.error.message);
    return;
  }
  console.log('Available Assets:', assetsResult.value);

  // Get intent by transaction hash
  const intentResult = await sodax.backendApi.getIntentByTxHash('0x123...abc');
  if (!intentResult.ok) {
    console.error('Intent error:', intentResult.error.message);
    if (intentResult.error instanceof Error && intentResult.error.cause) {
      console.error('Cause:', intentResult.error.cause);
    }
    return;
  }
  console.log('Intent Details:', intentResult.value);
}

example();
```

## Notes

- All string amounts in responses are in wei format (18 decimals) unless the specific field description says otherwise.
- Pagination parameters (`offset` and `limit`) are strings, not numbers.
- All endpoints return JSON responses.
- Error messages follow the CODE form (`SCREAMING_SNAKE_CASE`) for transport failures (`HTTP_REQUEST_FAILED`, `REQUEST_TIMEOUT`). Check `error.cause` for the underlying detail.
- `XToken.chainKey` is the field used on token objects to identify the chain (not `xChainId`).
- Chain constants are accessed via `ChainKeys.*` (e.g. `ChainKeys.ETHEREUM_MAINNET`), not legacy `*_CHAIN_ID` constants.
