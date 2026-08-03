---
"@sodax/wallet-sdk-core": minor
"@sodax/dapp-kit": minor
"@sodax/types": minor
"@sodax/sdk": minor
---

Added Stellar account activation via the sponsoring API: `sodax.sponsoring` (activate, check, config),
the `sodax.api.sponsoring` wire client, and the `useStellarAccountActive` / `useSponsorConfig` /
`useActivateStellarAccount` hooks. A sponsored account is created with the sponsor paying its base
reserve; the user's wallet signs.

`sponsoringApiConfig.baseURL` is the service base URL **including** any version or gateway prefix — the
SDK appends only `SPONSORING_API_STELLAR_BASE_PATH` (`/sponsorships/stellar`). It defaults to
`https://api.sodax.com/v1`; a locally-run service mounts the routes at its bare origin, so point it at
`http://localhost:3011`. Trailing slashes on any backend base URL are now trimmed before the endpoint is
appended, so `https://api.sodax.com/v1/` no longer produces a double slash, and the sponsoring config is
canonicalized on resolution — `sodax.api.sponsoring.getBaseURL()` returns the trimmed form, so two
spellings of one endpoint compare equal and share a `/config` cache entry.

`IStellarWalletProvider.signTransaction` now takes an optional `{ address }` naming the signer, and
`StellarWalletProvider` forwards it to the wallet. Without it a browser wallet signs with whatever
account is active — a wrong-but-well-formed signature. Additive: existing calls are unaffected.

`BackendHttpError` and `isBackendHttpError` are now exported from `@sodax/sdk`. A failed backend
request keeps the HTTP status and parsed error body on `error.cause`; use the guard rather than
`instanceof`, which is unreliable across duplicate copies of the SDK in one bundle. `classifySponsorError`
turns a sponsoring failure into the caller's next action (`rebuildAndResign`, `retrySameRequest`,
`backoff`, `contactOperator`, …) so consumers need not branch on status codes themselves.

`useStellarGate` (dapp-kit) sequences the Stellar destination prerequisites, which are ordered and easy
to get wrong: the account must exist, must trust the destination token, and — only if it does not —
must hold enough XLM to pay for the trustline it needs. Activation is sponsored, so it deliberately
leaves the account with **zero spendable XLM**; it can receive, but cannot yet send. The trustline is
checked before affordability on purpose: an account that already trusts the asset needs no XLM at all,
since the sender pays the fee and the reserve is already locked, so asking about affordability first
would block a correctly-configured user and tell them to fund an account that needs nothing.

Pairing `useStellarTrustlineCheck` with `useEstablishTrustline`
directly conflates "account missing" with "trustline missing", because `hasSufficientTrustline` throws
for an account that does not exist. The gate also distinguishes **unknown** from **unmet**: a failed
check sets `checkFailed` with the `error` and a `retry()` to re-run both reads, rather than leaving the
action disabled with nothing on screen. `sodax.sponsoring.getStellarAccountStatus` is the underlying read
(`{ exists, nativeBalanceStroops, availableBalanceStroops, canAffordTrustline, trustlineMinXlmStroops }`,
one Horizon account round-trip), and `StellarSpokeService.requestTrustline` now sets a 300s validity
window instead of accidentally passing milliseconds into a seconds parameter.

Reserve accounting follows the **network's** base reserve, read from the latest Horizon ledger and cached
for an hour, rather than assuming the 0.5 XLM that validators have voted since protocol 12 — that value
is a network setting, so hardcoding it would silently mis-report `availableBalanceStroops` and
`canAffordTrustline` after an upgrade. Render `status.trustlineMinXlmStroops` (the live requirement);
`STELLAR_TRUSTLINE_MIN_XLM_STROOPS` remains exported as the value assumed when that read fails.

The sponsored-create builder now checks the published **per-operation** fee band
(`minPerOperationFeeStroops` / `maxPerOperationFeeStroops`) as well as the total band, before the wallet
is prompted. The two are independent — a recommended fee can total inside the accepted range while
violating the per-operation floor — and the server enforces both, so a mismatch previously cost the user
a signature and returned a `400`.

**Migration:**

- `SodaxFeature` gained a `'sponsoring'` member. An exhaustive `Record<SodaxFeature, …>` in consumer
  code needs a new entry; `Partial` records and the analytics `features` allowlist are unaffected.
- `StellarAccountStatus` gained a required `trustlineMinXlmStroops`. Code that only *reads* the status
  is unaffected; a test double or fixture that **constructs** the type needs the new field.
- **`useEstablishTrustline` supersedes `useRequestTrustline`** — additively, so nothing breaks. The new
  hook is a standard mutation hook: `{ mutationOptions }` in, `{ mutate, mutateAsync, mutateAsyncSafe,
  isPending, … }` out, with the same vars (`{ token, amount, srcChainKey, walletProvider }`) and the
  same rejection of `amount: 0n`. `useRequestTrustline` keeps its released signature and return shape
  (`{ requestTrustline, isLoading, isRequested, error, data }`, positional `token` still ignored) as a
  deprecated wrapper over it, and will be removed in the next major. Migrate with
  `const { mutateAsync: requestTrustline } = useEstablishTrustline()`, then swap `isLoading` →
  `isPending` and `isRequested` → `isSuccess`; note `data` is `string | undefined` on the new hook,
  where the wrapper reports `string | null`.
