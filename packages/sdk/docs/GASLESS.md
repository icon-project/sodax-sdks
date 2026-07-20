# Gasless Documentation

> **Error handling conventions:** the brain (`sodax.gasless`) uses the canonical
> `SodaxError<GaslessOrchestrationErrorCode>` / `SodaxError<GaslessLookupError>` shape — discriminate
> on `result.error.code` (`'VALIDATION_FAILED'`, `'GAS_ESTIMATION_FAILED'`, `'TX_SUBMIT_FAILED'`,
> `'TX_VERIFICATION_FAILED'`, `'RELAY_TIMEOUT'`/`'RELAY_FAILED'`, `'LOOKUP_FAILED'`, `'EXECUTION_FAILED'`,
> `'UNKNOWN'`); structured detail lives on `result.error.context` (`srcChainKey`, `field`, `reason`,
> `phase`). A backend fulfilling the wire contract maps these to a `GaslessApiErrorCode` with
> `toGaslessApiErrorCode` (see **Error Handling** below).

Gasless enables **EIP-7702 + ERC-4337, Pimlico-sponsored** ERC20 spoke deposits for a user **EOA**: a
normal deposit (`approve` + `SpokeAssetManager.transfer`) is batched into one atomic, gas-sponsored
operation, so an EOA with **zero native balance** can deposit. Because EIP-7702 runs the smart-account
code *at* the EOA address, `msg.sender` for the inner `transfer` is still the user EOA — no contract
changes, and the emitted cross-chain message is identical to a normal deposit.

It is a **feature-agnostic primitive**: the caller supplies the hub recipient (`to`) and hub payload
(`data`), typically from a feature's `create*Intent({ raw: true })` (e.g.
`sodax.bridge.createBridgeIntent({ raw: true })`).

## The three cooperating pieces

The feature is one wire contract with two interchangeable implementations:

| Piece | Where | Role |
|---|---|---|
| **Contract** `IGaslessApi` + DTOs | `@sodax/types` | JSON-safe `getCapabilities` / `prepare` / `submit` shapes (string amounts, hex UserOp fields) + `GaslessApiErrorCode`. |
| **Brain** `sodax.gasless` | `@sodax/sdk` (viem) | Implements the contract in-process. Holds the Pimlico key via config. This is what the **backend embeds**. |
| **HTTP client** `sodax.api.gasless` | `@sodax/sdk` | Implements the same contract over HTTP. Carries **no** Pimlico key. This is what a **dApp without a Pimlico key** uses to reach the backend. |

Both SDK-side implementations satisfy the same `Result<T>`-wrapped shape, so a consumer can swap
"direct brain" ↔ "via backend" without any code change.

## How to use — pick your path

The sender is always a user-controlled **EOA**, and the SDK **never custodies the user key**. Which
API you use depends on who you are and how the EOA signs:

| You are… | Use | Signer | Guide | Live in |
|---|---|---|---|---|
| **Browser dApp with a connected wallet** (MetaMask/Rabby/Coinbase) | **Mode A** — `sodax.gasless.sendCalls` (or the `useGaslessSendCalls` hook) | the wallet, via EIP-5792 `wallet_sendCalls` | [Mode A walkthrough](#mode-a-external-eip-5792-wallet-browser) | **demo** |
| **Backend / bot / script with a Pimlico key** | **path (a)** — `sodax.gasless.prepare` / `submit` | a programmatic key you control (viem `LocalAccount`, HSM) | [Walkthrough a](#walkthrough-a-backend-or-key-holder) | **node** |
| **Service / client WITHOUT a Pimlico key** | **path (b)** — `sodax.api.gasless.prepare` / `submit` (HTTP → your backend) | a programmatic key you control | [Walkthrough b](#walkthrough-b-client-via-backend) | — |
| **Building the backend gasless API** | embed the brain, expose `IGaslessApi` | n/a (verifies the caller's signature) | [Building the backend](#building-the-backend-gasless-api) | — |

Why the split: paths (a)/(b) hand the EOA a **raw UserOp hash + EIP-7702 authorization** to sign —
which a **programmatic** signer does trivially but browser wallets don't expose to dApps — so browser
apps use **Mode A**, where the wallet builds/sponsors/submits the batch itself. Both reach the same
outcome (a sponsored atomic `[approve, transfer]` from a zero-native EOA).

## Configuration

Gasless config is passed to `new Sodax(...)`, never fetched from or merged into the backend-fetched
config. With `pimlicoApiKey` the synthesized paymaster/bundler URLs embed the key **client-side**; use
`paymasterProxyUrl` (below) to keep the key on your backend while still running Mode A.

```ts
// Backend / key-holder (path a): the Pimlico key lives here, server-side.
const sodax = new Sodax({
  gasless: {
    pimlicoApiKey: process.env.PIMLICO_API_KEY, // synthesizes per-chain paymaster + bundler URLs
    chains: {
      '0x2105.base': { supports7702: true },     // or explicit { paymasterUrl, bundlerUrl, sponsorshipPolicyId }
    },
  },
});
```

```ts
// dApp (path b): no Pimlico key; point the client at the backend + supply opaque auth headers.
const sodax = new Sodax({ api: { gaslessApiConfig: { baseURL: 'https://gasless.my-backend.com' } } });
sodax.api.gasless.setHeaders({ Authorization: `Bearer ${token}` }); // or per-call RequestOverrideConfig
```

**Mode A with a paymaster proxy (browser dApp, key stays on your backend).** Set `paymasterProxyUrl`
instead of `pimlicoApiKey`: the wallet POSTs ERC-7677 `pm_getPaymasterStubData` / `pm_getPaymasterData`
to `<paymasterProxyUrl>/<chainId>`, and your backend adds the Pimlico key and forwards to Pimlico — the
key never reaches the client. An explicit per-chain `paymasterUrl` still overrides it.

```ts
const sodax = new Sodax({
  gasless: {
    paymasterProxyUrl: 'https://gasless.my-backend.com', // your ERC-7677 proxy; no pimlicoApiKey in the browser
    chains: { '0x2105.base': { supports7702: true } },
  },
});
```

The proxy URL is **absolute** (the wallet, not the page, fetches it) and must send permissive **CORS**;
the URL and any `paymasterContext` are client-visible, so the proxy should authorize by **validating the
UserOperation** (only sponsor SODAX `[approve, transfer]` to the `SpokeAssetManager`), not a client-carried
secret. Proxy mode is Mode A only — it provides no bundler (Mode A uses the wallet's own; Mode B still needs
`pimlicoApiKey` or a per-chain `bundlerUrl`). Runnable reference: `apps/demo/scripts/paymaster-proxy.mjs`.

`getCapabilities` / `prepare` do on-chain reads (`eth_getCode`, gas estimation), so the brain's
`Sodax` needs the spoke chain's `rpcUrl` configured (standard SDK chain config).

## Contract methods (`IGaslessApi`)

### getCapabilities

`getCapabilities({ srcChainKey, srcAddress }) → Result<GaslessCapabilitiesResponse>`

Read-only eligibility for a chain + EOA sender: `configured` (chain gasless-configured), `senderIsEoa`
(rejects deployed smart-contract accounts via `getCode`), `sponsorshipAvailable` (paymaster resolvable),
and `eligible` (all of the above **and** a bundler endpoint — the same preconditions `prepare` enforces).
Use it to gate the UI/flow before `prepare`.

### prepare

`prepare({ srcChainKey, srcAddress, token, amount, to, data }) → Result<GaslessPrepareResponse>`

Builds the atomic `[approve, transfer]` batch, resolves ERC-7677 paymaster sponsorship (paymaster data
is fixed **before** signing), and returns the fully-built **unsigned** UserOperation plus the artifacts
the EOA must sign: the **UserOp hash**, and — when delegation is still needed — an **EIP-7702
authorization tuple** (`{ chainId, address, nonce }`). `amount` is a decimal string (base units).

`GaslessPrepareResponse` echoes `srcChainKey` / `chainId` / `sender` / `entryPoint`, so it is
**self-contained** — `submit` needs no server-held state and can run on a different instance.

**Per-request sponsorship override (multi-tenant).** `prepare` (and Mode A `sendCalls`) accept an
optional second argument — `prepare(body, { sponsorshipPolicyId?, paymasterContext? })` — that overrides
the per-chain `GaslessChainConfig.sponsorshipPolicyId` / `paymasterContext` **for that call only**. It is
**brain-only** (never part of the `IGaslessApi` wire DTO), so a single `new Sodax(...)` can sponsor
different senders under different policies without standing up a `Sodax` per partner, and an untrusted
HTTP client can't name someone else's policy. Precedence, highest first: request `paymasterContext` →
request `sponsorshipPolicyId` → per-chain default. Resolve the policy from your own auth, never the
request body:

```ts
const sponsorshipPolicyId = resolveSponsorshipPolicyForCaller(apiKey); // trusted — from YOUR auth
const prep = await sodax.gasless.prepare(body, { sponsorshipPolicyId });
```

### submit

`submit({ prepared, signatures }) → Result<GaslessSubmitResponse>`

Attaches the external signature(s), **verifies the UserOp signature and (when present) the EIP-7702
authorization signature both recover to `prepared.sender`** — rejecting anything else with
`VALIDATION_FAILED` / `context.reason: 'SIGNATURE_MISMATCH'` — then broadcasts the exact prepared op via
the Pimlico bundler. Returns `{ txHash, alreadyKnown? }`. **Execution-only**: it does not relay to the hub.

`signatures = { userOp: <hex sig over userOpHash>, authorization?: { r, s, yParity } }` — the
authorization signature is required **iff** `prepared.authorization` is present.

**Idempotent on `userOpHash`.** A re-broadcast of an already-known / already-included op — e.g. a client's
network retry of a submit that already succeeded — recovers that op's receipt and returns the same `txHash`
with `alreadyKnown: true`, instead of failing as `TX_SUBMIT_FAILED`. This is safe and stateless: ERC-4337
EntryPoint nonce uniqueness means a replayed op cannot double-execute, and the bundler (shared across API
instances) is the dedup authority keyed on `prepared.userOpHash`. A reverted op — or a rejection with no
recoverable receipt for that exact hash — is still a genuine failure.

## Walkthrough a: backend or key-holder

Holds the Pimlico key and a programmatic signer; drives the brain (`sodax.gasless`) end-to-end.

```ts
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(userPrivateKey); // the signer is the caller's, never the SDK's

// 0) gate
const caps = await sodax.gasless.getCapabilities({ srcChainKey, srcAddress: account.address });
if (!caps.ok || !caps.value.eligible) return; // caps.value.reason explains why

// 1) build `to` + `data` (feature-agnostic) — e.g. from a raw bridge intent
const intent = await sodax.bridge.createBridgeIntent({ raw: true, params: { /* … */ } });
if (!intent.ok) return;
const { address: to, payload: data } = intent.value.relayData;

// 2) prepare (keyless)
const prep = await sodax.gasless.prepare({ srcChainKey, srcAddress: account.address, token, amount: amount.toString(), to, data });
if (!prep.ok) return;

// 3) sign the returned artifacts (this is the ONLY place the key is used)
const userOp = await account.sign({ hash: prep.value.userOpHash });
const authorization = prep.value.authorization
  ? (({ r, s, yParity }) => ({ r, s, yParity: yParity ?? 0 }))(await account.signAuthorization(prep.value.authorization))
  : undefined;

// 4) submit (execution-only)
const sub = await sodax.gasless.submit({ prepared: prep.value, signatures: { userOp, authorization } });
if (!sub.ok) return;

// 5) relay the spoke tx to the hub (the caller owns the tail)
const relayed = await sodax.gasless.relay({ srcChainKey, srcChainTxHash: sub.value.txHash, relayData: { address: to, payload: data } });
// relayed.value → { srcChainTxHash, dstChainTxHash }
```

## Walkthrough b: client via backend

A service **without** a Pimlico key that reaches a backend over HTTP. It is **the same code as
walkthrough (a)** with two swaps — the client is `sodax.api.gasless` instead of `sodax.gasless`, and
the SDK is pointed at the backend (no Pimlico key). The signer is still yours; the backend holds the
Pimlico key and does the viem work. Browser dApps should use **Mode A** for the interactive path
rather than this (a browser can't sign the raw UserOp hash + 7702 authorization — see the router above).

```ts
// point at the backend + supply opaque auth; NO Pimlico key on this client
const sodax = new Sodax({ api: { gaslessApiConfig: { baseURL: 'https://gasless.my-backend.com' } } });
sodax.api.gasless.setHeaders({ Authorization: `Bearer ${token}` });

const gasless = sodax.api.gasless; // ← the only change vs walkthrough (a)
const caps = await gasless.getCapabilities({ srcChainKey, srcAddress: account.address });
if (!caps.ok || !caps.value.eligible) return;

const prep = await gasless.prepare({ srcChainKey, srcAddress: account.address, token, amount: amount.toString(), to, data });
if (!prep.ok) return;

const userOp = await account.sign({ hash: prep.value.userOpHash });
const authorization = prep.value.authorization
  ? (({ r, s, yParity }) => ({ r, s, yParity: yParity ?? 0 }))(await account.signAuthorization(prep.value.authorization))
  : undefined;

const sub = await gasless.submit({ prepared: prep.value, signatures: { userOp, authorization } });
// sub.value.txHash → relay via your own relay path (sodax.gasless.relay is brain-only)
```

Because both clients satisfy the same `Result<T>`-wrapped contract, swapping `sodax.gasless` ↔
`sodax.api.gasless` (or the dapp-kit `source: 'brain' | 'api'` toggle) is the only difference.

## Building the backend gasless API

The backend embeds the brain, guards access, and exposes the raw `IGaslessApi` endpoints. Unwrap the
brain's `Result<T>` and translate its `SodaxError` to a `GaslessApiErrorCode`:

```ts
import { Sodax, toGaslessApiErrorCode, gaslessApiErrorCodeToHttpStatus } from '@sodax/sdk';
import type { IGaslessApi } from '@sodax/sdk';

export class GaslessBackend implements IGaslessApi {
  private readonly sodax = new Sodax({ gasless: { pimlicoApiKey: process.env.PIMLICO_API_KEY } });

  async prepare(body: GaslessPrepareRequest): Promise<GaslessPrepareResponse> {
    // Per-request sponsorship: resolve the policy from YOUR auth, not the request body.
    const result = await this.sodax.gasless.prepare(body, { sponsorshipPolicyId: this.policyForCaller() });
    if (!result.ok) {
      const code = toGaslessApiErrorCode(result.error);                          // wire code → response body
      throw httpError(gaslessApiErrorCodeToHttpStatus[code] ?? 500, code, result.error.message); // status from the map
    }
    return result.value; // already JSON-safe
  }
  // getCapabilities / submit: identical shape (submit takes no sponsorship override — paymaster data is baked into `prepared`)
}
```

The backend's responsibilities (out of SDK scope, but the SDK fits them):

- **Auth** — the brain does not authenticate; add your own (the dApp client forwards opaque headers via
  `setHeaders` / `RequestOverrideConfig.headers`).
- **Signature recovery** — the brain's `submit` already verifies the signature recovers to `srcAddress`;
  a defense-in-depth re-check at the edge is optional.
- **Error mapping** — `toGaslessApiErrorCode(error)` (from `@sodax/sdk`) maps a brain `SodaxError` to the
  wire enum (`SENDER_NOT_EOA`, `INVALID_TOKEN`, `CHAIN_NOT_CONFIGURED`, `SPONSORSHIP_UNAVAILABLE`,
  `SIGNATURE_MISMATCH`, `BUNDLER_REJECTED`, `INVALID_REQUEST`, `INTERNAL_ERROR`), and
  `gaslessApiErrorCodeToHttpStatus[code]` gives a matching HTTP status (override as you see fit). Put the
  **wire `code` in the JSON error body**: the SDK HTTP client keeps `error.context.code` only when the
  body's `code` is a valid `GaslessApiErrorCode` and silently drops anything else (e.g. a raw
  `SodaxErrorCode`), so a dApp on `sodax.api.gasless` can discriminate on it.

## Error Handling

| Layer | Error type | Discriminator |
|---|---|---|
| Brain `sodax.gasless.*` | `SodaxError` (`feature: 'gasless'`) | `error.code` + `error.context.{field,reason,phase}` |
| HTTP client `sodax.api.gasless.*` | `SodaxError<'EXTERNAL_API_ERROR'>` (`feature: 'backend'`) | `error.context.api === 'gasless'`, `error.context.code` (a `GaslessApiErrorCode`), `error.context.status` |
| Wire (backend ⇄ dApp) | `GaslessApiErrorCode` | the JSON error-body `code` |

`toGaslessApiErrorCode` resolution order: a wire-code `context.reason` (e.g. `SIGNATURE_MISMATCH`, or
`SPONSORSHIP_UNAVAILABLE` for a gasless-configured chain with no resolvable paymaster) →
`VALIDATION_FAILED` by tripped `field` (`srcAddress`→`SENDER_NOT_EOA`, `token`→`INVALID_TOKEN`,
`srcChainKey`→`CHAIN_NOT_CONFIGURED`, else `INVALID_REQUEST`) → `TX_SUBMIT_FAILED`→`BUNDLER_REJECTED` →
everything else `INTERNAL_ERROR`.

## Mode A: external EIP-5792 wallet (browser)

Browser wallets can't sign a raw UserOp hash + EIP-7702 authorization, so `sendCalls` is retained for
them: an EIP-5792 wallet executes the sponsored batch itself via `wallet_sendCalls`. Mode A is
**brain-only** (not part of the `IGaslessApi` wire contract) and **execution-only** (returns
`{ srcChainTxHash, relayData }`) — relay with `relay(...)`.

Step by step (SDK; the dapp-kit equivalent is `useGaslessSendCalls` → `useGaslessRelay`, see the
`sodax-dapp-kit` skill):

```ts
// 0) gate on the connected wallet's EIP-5792 (atomic + paymaster) support
const wc = await sodax.gasless.getWalletCapabilities({ chainKey: srcChainKey, walletProvider });
if (!wc.ok || wc.value.resolvedMode !== 'walletCalls') return; // wallet can't do gasless

// 1) build `to` + `data` (same as the prepare path — e.g. a raw bridge intent)
const intent = await sodax.bridge.createBridgeIntent({ raw: true, params: { /* … */ } });
if (!intent.ok) return;
const { address: to, payload: data } = intent.value.relayData;

// 2) execute — the wallet builds/sponsors/submits the atomic [approve, transfer]
const sent = await sodax.gasless.sendCalls({ srcChainKey, srcAddress, token, amount, to, data, walletProvider });
if (!sent.ok) return;

// 3) relay the spoke tx to the hub
const relayed = await sodax.gasless.relay({ srcChainKey, srcChainTxHash: sent.value.srcChainTxHash, relayData: sent.value.relayData });
// relayed.value → { srcChainTxHash, dstChainTxHash }
```

## Swap-aware gasless (`IGaslessSwapApi`)

Everything above is the **feature-agnostic** primitive: the caller builds the hub `to` + `data` (from a
raw intent) and threads it through gasless + relay by hand. `IGaslessSwapApi` is the **swap-aware**
sibling — it takes `CreateIntentParamsV2` (the same DTO `sodax.api.swaps` uses), builds the intent
internally, drives gasless, and completes the swap (relay to hub + notify the solver) **server-side**.
It exists in the same three pieces, and covers **both** modes end-to-end:

| Piece | Where | Role |
|---|---|---|
| **Contract** `IGaslessSwapApi` + DTOs | `@sodax/types` | JSON-safe swap-gasless shapes (`GaslessSwapPrepareResponse`, `GaslessSwapBuildCallsResponse`, `GaslessSwapCompleteRequest`) + `GaslessSwapApiErrorCode`. |
| **Brain** `sodax.gaslessSwap` | `@sodax/sdk` | Implements the contract in-process by composing `sodax.swaps` (`createIntent`/`postExecution`) + `sodax.gasless`. |
| **HTTP client** `sodax.api.gaslessSwap` | `@sodax/sdk` | Implements the same contract over HTTP (`/gasless-swap/*`, on the gasless backend base URL). |

The six methods (all `Result<T>`-wrapped on the SDK side):

- `getCapabilities(body)` — eligibility (delegates to the gasless brain).
- **Mode B** — `prepareSwap(CreateIntentParamsV2)` → `{ prepared, intent, relayData }`; the client signs
  `prepared.userOpHash` (+ the EIP-7702 `authorization` tuple when present) → `submitSwap({ prepared, signatures })` → `{ txHash }`.
- **Mode A** — `buildSwapCalls(CreateIntentParamsV2)` → `{ calls, capabilities, intent, relayData }`, where `calls`
  is the **encoded EIP-5792 `[approve, transfer]` batch** (`{ to, data, value }` strings) and `capabilities` is
  `{ chainId, atomic, paymasterService? }`. A **pure-HTTP (non-SDK) client** passes them straight to its wallet —
  `wallet_sendCalls({ calls, chainId: capabilities.chainId, capabilities })` — no SDK or ABI encoders needed. (An
  SDK consumer may instead pass the intent to `sodax.gasless.sendCalls`.)
- **Both** converge on `completeSwap(GaslessSwapCompleteRequest)` → `submitTx`-style ack (`inserted` / `duplicate`),
  then poll `getSwapCompletionStatus({ txHash, srcChainKey })` to a terminal `SubmitTxStatusResponseV2`
  (`status === 'solved' | 'failed'`, or `data.abandonedAt != null`).

**Mode A over pure HTTP — the paymaster is client-safe by construction.** `capabilities.paymasterService` is
present **only** when the backend is configured with a client-safe paymaster — an explicit per-chain
`paymasterUrl` or a `paymasterProxyUrl` proxy — because its `url` is handed to the client. When the only
sponsorship source is a `pimlicoApiKey`, the key-bearing URL is **withheld** (`paymasterService` is omitted), so a
gasless-swap backend must run a **paymaster proxy** to enable sponsored Mode A over HTTP. The wallet
interaction itself (`wallet_sendCalls`) is inherently client-side — a backend cannot invoke a browser wallet —
but the wire now carries everything a thin client needs to make that call without the SDK.
`minOutputAmount` / `deadline` are **not** on this interface — source them from `sodax.api.swaps.getQuote` /
`getDeadline` first, exactly like the normal swap flow.

```ts
// Mode B (private key): build → sign → submit → complete → poll
const prep = await sodax.gaslessSwap.prepareSwap(params); // params: CreateIntentParamsV2
if (!prep.ok) return;
const userOp = await account.sign({ hash: prep.value.prepared.userOpHash });
const authorization = prep.value.prepared.authorization
  ? (({ r, s, yParity }) => ({ r, s, yParity: yParity ?? 0 }))(await account.signAuthorization(prep.value.prepared.authorization))
  : undefined;
const sub = await sodax.gaslessSwap.submitSwap({ prepared: prep.value.prepared, signatures: { userOp, authorization } });
if (!sub.ok) return;
const done = await sodax.gaslessSwap.completeSwap({
  txHash: sub.value.txHash, srcChainKey: params.srcChainKey, walletAddress: params.srcAddress,
  intent: prep.value.intent, relayData: prep.value.relayData,
});
// then poll sodax.gaslessSwap.getSwapCompletionStatus({ txHash: sub.value.txHash, srcChainKey: params.srcChainKey })
```

The brain completes **synchronously to a terminal state** (in-process convenience, no background worker),
so the first status poll already returns `solved` / `failed`; a real backend runs the submit-tx worker
and the poll is genuinely async. `completeSwap` is idempotent on `(txHash, srcChainKey)`. The wire error
enum is `GaslessSwapApiErrorCode = GaslessApiErrorCode | 'INTENT_BUILD_FAILED'` (guard: `isGaslessSwapApiErrorCode`);
the HTTP client surfaces it on `error.context.code` with `error.context.api === 'gasless-swap'`.

## Run it live (smoke test)

Both signer types have a full live path — the private-key/prepare-submit path in **`apps/node`**, and
the browser-wallet Mode A path in **`apps/demo`**. Each needs a real chain, a funded Pimlico
sponsorship policy, and an EOA that holds the ERC20 (native balance can be zero — that's the point).

**Private-key path — `apps/node`** (runs `getCapabilities → prepare → sign → submit → relay`):

```bash
cd apps/node
# EVM_SPOKE_CHAIN_KEY must be a 7702-live, gasless-configured spoke.
EVM_SPOKE_CHAIN_KEY=0x2105.base \
PRIVATE_KEY=0x…            \  # the test EOA's key — signs the UserOp hash + 7702 authorization
PIMLICO_API_KEY=…          \  # server-side; synthesizes the paymaster + bundler URLs
pnpm gasless-swap <srcSymbol> <dstChainKey> <dstSymbol> <amount>
# e.g. swap USDC on Base → WETH on Arbitrum, gas sponsored:
# EVM_SPOKE_CHAIN_KEY=0x2105.base pnpm gasless-swap USDC 0xa4b1.arbitrum WETH 1000000
```

Success prints `srcChainTxHash` + `dstChainTxHash`; the inner `SpokeAssetManager.transfer` runs with
`msg.sender == EOA` (EIP-7702), identical to a normal deposit.

**Wallet path (Mode A) — `apps/demo`**:

```bash
# apps/demo/.env → VITE_PIMLICO_API_KEY=…
pnpm dev:demo            # from repo root
```

Open `/gasless`, connect an EIP-5792 wallet on a gasless-configured chain, pick token + amount, and
click **"Mode A: send + relay"**. (The demo's **Prepare** button only *displays* the sign-requests —
a browser wallet can't complete the raw-hash + 7702-authorization signing; that path is the node one.)

## Caveats

- **EOA sender only.** A deployed smart-contract account is rejected (`getCode`); `submit` rejects a
  signature that does not recover to `srcAddress`.
- **Do not mutate `prepared` between `prepare` and `submit`.** `submit` re-broadcasts the exact op; any
  change invalidates the signature.
- **Nonce staleness (TOCTOU).** `prepare` freezes the ERC-4337 and EIP-7702 nonces. `submit` is
  **idempotent on `userOpHash`**, so retrying a submit that already succeeded returns the same `txHash`
  (`alreadyKnown: true`), not a spurious failure. But if the EOA transacts on-chain between `prepare` and
  `submit`, a *different* op consumes the nonce — no receipt exists for this `userOpHash`, so the stale op is
  still a genuine failure: treat it as "re-prepare". Don't transact from the sender EOA between the two calls.
- **ERC20 only.** The native token has no `approve` step and is rejected.
- **Real-chain validation.** The SDK unit tests mock the Pimlico/bundler/viem-account-abstraction seam.
  Validate the real prepare → (sign) → submit round-trip against a live chain + funded Pimlico key with
  `apps/node/src/gasless-swap.ts` before relying on it in production.

## Related

- `apps/node/src/gasless-swap.ts` — runnable prepare → (external sign) → submit → relay smoke script.
- `@sodax/dapp-kit` gasless hooks — React wrappers (`useGaslessCapabilities`, `useGaslessPrepare`,
  `useGaslessSubmit`, `useGaslessSendCalls`, `useGaslessRelay`) with a `source: 'brain' | 'api'` toggle.
- [`BRIDGE.md`](BRIDGE.md) — the deposit action gasless most commonly wraps (source of `to` + `data`).
