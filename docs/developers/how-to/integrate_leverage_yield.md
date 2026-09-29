---
title: "Integrate Leverage Yield (LST vaults)"
sidebarTitle: "Integrate Leverage Yield"
description: "Add SODAX leverage-yield LST vaults to your app: what the loop earns and risks, the default @sodax/sdk and dapp-kit flow, the HTTP API alternative, and the gotchas that stop an intent from filling."
icon: money-bill-trend-up
---

Use this guide to let your users deposit into and withdraw from SODAX leverage-yield vaults. The SDK is the default path. The HTTP API is live on production too, for backends and non-TypeScript stacks.

| Find an answer | Section |
| --- | --- |
| What a vault does, and what can go wrong | [What it is](#what-it-is) · [Risks](#risks) |
| Which integration path to pick | [Choose a path](#choose-a-path) |
| TypeScript deposit and withdraw | [SDK path](#sdk-path) |
| React hooks for the same flow | [dapp-kit hooks](#dapp-kit-hooks) |
| REST from any language | [API path](#api-path) |
| Why an intent never fills | [Gotchas](#gotchas) |
| Method-by-method reference | [Leverage Yield (SDK)](/developers/packages/foundation/sdk/functional-modules/leverage_yield) · [Leverage yield API](/developers/http-api/leverage) |

## What it is {#what-it-is}

A leverage-yield vault loops a liquid staking token (LST). It supplies the LST as collateral, borrows a correlated asset against it, swaps what it borrowed back into more of the LST, and supplies that again. It repeats until the position reaches the vault's target loan-to-value (`targetLTV`). Your users earn the spread between the supply side (lending rate plus LST staking yield) and the borrow rate, multiplied by the loop's leverage.

```
effectiveNetApr = effectiveSupply + leverage × (effectiveSupply − borrowApr)
leverage        = targetLTV / (1 − targetLTV)        # 85% LTV → 5.67×
```

Three facts shape the integration:

- **A position is an ERC-4626 share token, `lsoda*`** (for example `lsodaWEETH`), held on the Sonic hub. The vault address and the share-token address are the same.
- **Deposit and withdraw are intent-based swaps.** A deposit swaps any supported token on any supported network into `lsoda*` shares, and a withdraw swaps shares back into any token. A solver fills both, so there is no vault-specific deposit call on the user's network.
- **Shares land in the user's hub wallet**, not on the network they paid from. A later withdraw spends them from there.

`sodax.leverageYield.listVaults()` returns the vault registry that ships with your SDK version. The live list is `GET https://api.sodax.com/v1/leverage-yield/vaults`. Do not hard-code either.

### Risks {#risks}

<Warning>
  Leverage multiplies the spread in both directions. Show these risks to users before they deposit.
</Warning>

- **APR can go negative.** If the borrow rate rises above the supply side, every loop costs money. At 85% LTV, supply 3% against borrow 5% gives roughly **−8.3%**. The SDK returns net APR as a signed value so a UI can show it.
- **Depeg and liquidation risk.** The position holds real debt against the LST. If the LST depegs or its price moves against the borrowed asset, the health factor falls, and a health factor below 1 means liquidation territory. `getPosition()` returns the live `healthFactor`, `ltv`, `collateral` and `debt` so you can warn early.
- **The APR is a steady-state estimate, not a realised return.** It assumes today's lending rates hold and the vault stays at `targetLTV`. Real returns move with rate volatility and how often the vault rebalances.

The derivation and a worked example are on [Effective APR](/developers/packages/foundation/sdk/functional-modules/leverage_yield_apr).

## Choose a path {#choose-a-path}

| | SDK (default) | HTTP API (option) |
| --- | --- | --- |
| Use when | TypeScript product UI, React dApp, Node service | A backend or bot in any language, or you want to own every step |
| Package | `@sodax/sdk` (+ `@sodax/dapp-kit` for React) | None — `https://api.sodax.com/v1/leverage-yield` (or the `useLeverageYieldApi*` hooks) |
| Relay and settlement | Handled by `vaultSwap()`, with a client-side fallback | You sign, broadcast, hand off with `/submit-tx`, and poll |
| Your own `partnerFee` on a withdraw | Yes | Not yet — see [API path](#api-path) |

## SDK path (default) {#sdk-path}

The sequence is the same in both directions:

**`getQuote` → apply slippage → `deposit()` / `withdraw()` → `vaultSwap()` → `getDetailedStatus()`**

`deposit()` and `withdraw()` only **build** a payload. `vaultSwap()` signs, broadcasts, and drives the intent to completion. A deposit adds one step between the two: approve the input token on the user's network.

### Set up

```bash
pnpm add @sodax/sdk @sodax/wallet-sdk-core
```

```typescript
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax({
  // Optional. Vault flows use the leverage-yield fee, never swaps.partnerFee.
  leverageYield: { partnerFee: { address: '0xYourFeeReceiver', percentage: 100 } }, // 100 bps = 1%
  // apiKey: process.env.SODAX_API_KEY, // server-side only; optional today
});
await sodax.initialize();
```

Wallet providers come from `@sodax/wallet-sdk-core` (Node) or `@sodax/wallet-sdk-react` (browser). See [Wallet providers](/developers/how-to/wallet_providers).

### Deposit: any token → `lsoda*`

```typescript
import { ChainKeys, type Address } from '@sodax/sdk';

const SLIPPAGE_BPS = 50n; // 0.5%
const applySlippage = (amount: bigint) => (amount * (10_000n - SLIPPAGE_BPS)) / 10_000n;

const vault = sodax.leverageYield.getVault('lsodaWEETH');
if (!vault) throw new Error('Unknown vault');

// evmWalletProvider: an IEvmWalletProvider for srcChainKey (see Wallet providers above).
const srcChainKey = ChainKeys.ARBITRUM_MAINNET;
const srcAddress = await evmWalletProvider.getWalletAddress();
const inputToken: Address = '0x…'; // the token the user pays with, on srcChainKey
const inputAmount = 1_000_000_000_000_000_000n; // in inputToken decimals

// 1. Quote. The vault is the destination token, and it always lives on Sonic.
const quote = await sodax.leverageYield.getQuote({
  token_src: inputToken,
  token_src_blockchain_id: srcChainKey,
  token_dst: vault.vault,
  token_dst_blockchain_id: ChainKeys.SONIC_MAINNET,
  amount: inputAmount,
  quote_type: 'exact_input',
});
if (!quote.ok) throw quote.error;

// 2. Slippage. lsoda* shares are always 18 decimals.
const minOutputAmount = applySlippage(quote.value.quoted_amount);

// 3. Build the payload.
const built = await sodax.leverageYield.deposit({
  vault: vault.vault,
  srcChainKey,
  srcAddress,
  inputToken,
  inputAmount,
  minOutputAmount,
});
if (!built.ok) throw built.error;

// 4. Approve the input token on the source network (deposit only, swap-domain helpers).
const allowance = await sodax.swaps.isAllowanceValid({ params: built.value.params, walletProvider: evmWalletProvider });
if (!allowance.ok) throw allowance.error;
if (!allowance.value) {
  // Pin the network so the result narrows to an EVM tx hash.
  const approval = await sodax.swaps.approve<typeof srcChainKey, false>({
    params: { ...built.value.params, srcChainKey },
    walletProvider: evmWalletProvider,
  });
  if (!approval.ok) throw approval.error;
  await evmWalletProvider.waitForTransactionReceipt(approval.value);
}

// 5. Execute: sign, broadcast, relay, and notify the solver.
const swap = await sodax.leverageYield.vaultSwap({ ...built.value, walletProvider: evmWalletProvider });
if (!swap.ok) throw swap.error;

// 6. Track it from the source-network transaction hash.
const status = await sodax.leverageYield.getDetailedStatus({
  srcChainKey,
  srcTxHash: swap.value.intentDeliveryInfo.srcTxHash,
});
```

### Withdraw: `lsoda*` → any token

A withdraw is the mirror image, with the vault as the **source** token. It needs no approval: the payload carries `hubWalletSwap: true`, so the user authorises the share spend with a cross-chain message transaction (`Connection.sendMessage`) they send on `srcChainKey`. That transaction pays gas on `srcChainKey`.

```typescript
const dstChainKey = ChainKeys.ARBITRUM_MAINNET; // where the output token is delivered
const outputToken: Address = '0x…'; // the token the user receives, on dstChainKey

// Same srcChainKey and srcAddress as the deposit: the shares sit in that address's hub wallet.
// A full exit spends the whole share balance (lsoda*, 18 decimals).
const balance = await sodax.leverageYield.getShareBalanceForUser(vault.vault, srcChainKey, srcAddress);
if (!balance.ok) throw balance.error;
const shares = balance.value;

const quote = await sodax.leverageYield.getQuote({
  token_src: vault.vault,
  token_src_blockchain_id: ChainKeys.SONIC_MAINNET,
  token_dst: outputToken,
  token_dst_blockchain_id: dstChainKey,
  amount: shares,
  quote_type: 'exact_input',
});
if (!quote.ok) throw quote.error;

const built = await sodax.leverageYield.withdraw({
  vault: vault.vault,
  srcChainKey, // the network the user signs on
  srcAddress,
  dstChainKey, // where the output token is delivered
  outputToken,
  inputAmount: shares,
  minOutputAmount: applySlippage(quote.value.quoted_amount),
  // recipient defaults to srcAddress
});
if (!built.ok) throw built.error;

const swap = await sodax.leverageYield.vaultSwap({ ...built.value, walletProvider: evmWalletProvider });
if (!swap.ok) throw swap.error;
```

### Track completion

After broadcasting, `vaultSwap()` hands the transaction to the backend by default. If that step doesn't complete, it finishes the relay client-side. A failure before broadcast (for example, the user rejects the signature), or in the client-side relay itself, still returns `ok: false`. `getDetailedStatus()` reads the result from whichever source can answer, keyed on the source-network transaction hash:

```typescript
import { DETAILED_STATUS_NOT_DELIVERED, isAuthFailure } from '@sodax/sdk';

if (status.ok) {
  if (status.value.source === 'backend') {
    console.log(status.value.data.status); // pending … posted_execution | solved
  } else {
    // A failed or abandoned backend record lands here. data.status is a SolverIntentStatusCode.
    console.log(status.value.data.status, status.value.dstTxHash);
  }
} else if (isAuthFailure(status.error)) {
  // A rejected API key: fix the key, don't retry.
} else if (status.error.context?.reason === DETAILED_STATUS_NOT_DELIVERED) {
  // No relay packet yet: retry, within a budget.
}
```

It is a one-off read. Poll it yourself, or use `useLeverageYieldDetailedStatus` in React. The backend branch never carries a failure: a `failed` or abandoned record goes to the solver branch, so a solver `FAILED` code is how failure shows up. `DETAILED_STATUS_NOT_DELIVERED` means the relay has no packet for the transaction yet. It is the only failure worth capping with a retry budget. Compare against the imported constant, not its name as a string. Keep retrying other `LOOKUP_FAILED` errors until the dependency recovers.

### dapp-kit hooks {#dapp-kit-hooks}

Every SDK step has a matching `@sodax/dapp-kit` hook. Mutations expose `mutateAsyncSafe`, which returns a `Result` instead of throwing.

| Step | Hook | Kind |
| --- | --- | --- |
| Quote | `useLeverageYieldQuote({ params: { payload } })` — `data` is the SDK `Result`; refreshes every 3 s | Query |
| Build a deposit | `useLeverageYieldDeposit()` | Mutation |
| Build a withdraw | `useLeverageYieldWithdraw()` | Mutation |
| Approve (deposit only) | `useSwapAllowance({ params: { payload: built.params, srcChainKey, walletProvider } })` · `useSwapApprove()`, called with `{ params: built.params, walletProvider }` | Query · Mutation |
| Execute | `useLeverageYieldVaultSwap()` — call with `{ ...built, walletProvider }` | Mutation |
| Track | `useLeverageYieldDetailedStatus({ params: { srcChainKey, srcTxHash } })` — polls every 3 s. Stops when the status is terminal, on a rejected API key, or after 40 reads in a row that can't tell in-flight from lost | Query |
| Display | `useLeverageYieldEffectiveApr`, `useLeverageYieldPosition`, `useLeverageYieldTotalAssets`, `useLeverageYieldPreviewRedeem`, `useLeverageYieldShareBalances` (returns an array, one row per holder) | Query |

```tsx
import {
  useLeverageYieldDeposit,
  useLeverageYieldVaultSwap,
  useLeverageYieldDetailedStatus,
} from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';

function DepositButton({ vault, srcChainKey, srcAddress, inputToken, inputAmount, minOutputAmount }: DepositProps) {
  const walletProvider = useWalletProvider({ xChainId: srcChainKey });
  const { mutateAsyncSafe: buildDeposit } = useLeverageYieldDeposit();
  const { mutateAsyncSafe: vaultSwap, data: swap } = useLeverageYieldVaultSwap();
  const { data: status } = useLeverageYieldDetailedStatus({
    params: { srcChainKey, srcTxHash: swap?.intentDeliveryInfo.srcTxHash },
  });

  const onClick = async () => {
    if (!walletProvider) return;
    const built = await buildDeposit({ vault, srcChainKey, srcAddress, inputToken, inputAmount, minOutputAmount });
    if (!built.ok) return;
    // Gate on useSwapAllowance / useSwapApprove before this call for a deposit.
    await vaultSwap({ ...built.value, walletProvider });
  };

  return (
    <>
      <button onClick={onClick}>Deposit</button>
      {status?.ok && status.value.source === 'backend' && <p>{status.value.data.status}</p>}
    </>
  );
}
```

`built` is the value a successful `useLeverageYieldDeposit` / `useLeverageYieldWithdraw` call returns. `minOutputAmount` comes from `useLeverageYieldQuote` with slippage applied. `DepositProps` is your own type. The [dapp-kit leverage yield recipe](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-dapp-kit/integration/knowledge/recipes/leverage-yield.md) has separate snippets for a deposit with its approve call, vault stats, and share balances.

## API path (option) {#api-path}

Every route is live on production:

```
https://api.sodax.com/v1/leverage-yield
```

Amounts are decimal strings in the token's smallest unit. Network identifiers are SODAX chain keys, such as `0xa4b1.arbitrum` for Arbitrum and `sonic` for the hub.

<Note>
  **Withdraw routes don't take `partnerFee` yet.** `POST /quote/withdraw` and `POST /intents/withdraw` have no `partnerFee` field, and the backend rejects unknown body fields. On HTTP you can only set a per-request partner fee on deposits. Withdraws always pay the backend's configured leverage-yield fee. Use the SDK if you need to monetize withdrawals.
</Note>

<Note>
  **API keys are currently optional.** The `POST` routes are wired to check an `x-api-key` header, but key checking is switched off on the public deployments. Send your key on every `POST` from your server anyway, so nothing breaks when enforcement is turned on. See [API keys](/developers/how-to/api-keys) and [API key good practices](/developers/how-to/api-key-good-practices).
</Note>

### The flow

| # | Step | Route | dapp-kit hook |
| --- | --- | --- | --- |
| 1 | Quote | `POST /quote/deposit` · `POST /quote/withdraw` | `useLeverageYieldApiDepositQuote` · `useLeverageYieldApiWithdrawQuote` |
| 2 | Check allowance (deposit only) | `POST /allowance/check` | `useLeverageYieldApiAllowance` |
| 3 | Approve (deposit only) | `POST /approve` → `{ tx, resetTx? }` | `useLeverageYieldApiApproveAndBroadcast` (hub, EVM and Stellar sources) or `useLeverageYieldApiApprove` (unsigned) |
| 4 | Build the intent | `POST /intents/deposit` · `POST /intents/withdraw` → `{ tx, intent, relayData }` | `useLeverageYieldApiCreateDepositIntent` · `useLeverageYieldApiCreateWithdrawIntent` |
| 5 | Sign and broadcast `tx` | Your wallet, on `srcChainKey` | No hook — your wallet provider (for example `sendTransaction` on EVM) |
| 6 | Hand off to the backend | `POST /submit-tx` with `operation` | `useLeverageYieldApiSubmitTx` — takes `{ request }` |
| 7 | Poll to a terminal state | `GET /submit-tx/status` | `useLeverageYieldApiSubmitTxStatus` — stops on `solved`, `failed`, `abandonedAt` or a rejected key |

For display, `useLeverageYieldApiVaults` and `useLeverageYieldApiEffectiveApr` read the registry and headline APR (`GET /vaults`, `GET /apr/effective?vault=<vault>`). The `tx` in step 4 is an unsigned transaction shaped for the source network's family (EVM, Solana, Sui, Stellar and so on).

Two details in React. The `intent` in the step 4 response is all decimal strings, and `useLeverageYieldApiSubmitTx` expects the bigint `IntentRequestV2`, so convert it before step 6. Vault reads such as `useLeverageYieldApiShareBalance` take the user's **hub wallet** as `owner`, which `useGetUserHubWalletAddress` resolves from their spoke address. The demo app's [leverage-yield API card](https://github.com/icon-project/sodax-sdks/blob/main/apps/demo/src/components/leverage-yield-api/LeverageCard.tsx) wires steps 1–6, and its [order status panel](https://github.com/icon-project/sodax-sdks/blob/main/apps/demo/src/components/leverage-yield-api/OrderStatus.tsx) polls step 7. The card also uses a [sign-and-broadcast helper](https://github.com/icon-project/sodax-sdks/blob/main/apps/demo/src/components/swaps-api/lib/signAndBroadcast.ts) and the [intent converter](https://github.com/icon-project/sodax-sdks/blob/main/apps/demo/src/components/swaps-api/lib/mappers.ts).

### Deposit with curl

The examples use `jq` to build the JSON bodies. Set the variables to your own values; `$SRC` is a chain key.

```bash
BASE=https://api.sodax.com/v1/leverage-yield
SRC=0xa4b1.arbitrum         # the network the user pays from
VAULT=0x…                   # from GET $BASE/vaults
INPUT_TOKEN=0x…             # the token the user pays with, on $SRC
USER_ADDRESS=0x…            # the user's address on $SRC
AMOUNT=10000000             # smallest unit of INPUT_TOKEN, e.g. 10 USDC (6 decimals)
SODAX_API_KEY=…             # server-side only
H=(-H 'content-type: application/json' -H "x-api-key: $SODAX_API_KEY")

# 1. Quote → .quotedAmount (lsoda* shares, 18 decimals).
#    Too small an amount returns 422 "Input amount too low" (code -23).
jq -n --arg vault "$VAULT" --arg token "$INPUT_TOKEN" --arg src "$SRC" --arg amount "$AMOUNT" \
  '{vault: $vault, tokenSrc: $token, tokenSrcChainKey: $src, amount: $amount, quoteType: "exact_input"}' \
  | curl -s -X POST "$BASE/quote/deposit" "${H[@]}" -d @- > quote.json

# 2. Apply 0.5% slippage (bc handles the 18-decimal integers)
MIN_SHARES=$(echo "$(jq -r .quotedAmount quote.json) * 9950 / 10000" | bc)

# One body serves allowance/check, approve and intents/deposit.
BODY=$(jq -n --arg vault "$VAULT" --arg src "$SRC" --arg user "$USER_ADDRESS" \
  --arg token "$INPUT_TOKEN" --arg amount "$AMOUNT" --arg min "$MIN_SHARES" \
  '{vault: $vault, srcChainKey: $src, srcAddress: $user, inputToken: $token, inputAmount: $amount, minOutputAmount: $min}')

# 3. Allowance → { "valid": true | false }
curl -s -X POST "$BASE/allowance/check" "${H[@]}" -d "$BODY"

# 4. If valid is false → { tx, resetTx? }. Sign and mine resetTx first when it is present, then tx.
curl -s -X POST "$BASE/approve" "${H[@]}" -d "$BODY"

# 5. Build → { tx, intent, relayData: { address, payload } }
curl -s -X POST "$BASE/intents/deposit" "${H[@]}" -d "$BODY" > created.json
```

Next the user signs `created.json`'s `tx` with their wallet on `$SRC`, and you broadcast it. That step happens outside the API. **Wait for the source-network receipt**, then hand off and poll:

```bash
TX_HASH=0x…   # hash of the broadcast tx

# 6. Hand off. relayData is the .payload string, not the whole object; operation is required.
jq --arg tx "$TX_HASH" --arg src "$SRC" --arg user "$USER_ADDRESS" \
  '{txHash: $tx, srcChainKey: $src, walletAddress: $user, intent: .intent, relayData: .relayData.payload, operation: "deposit"}' \
  created.json \
  | curl -s -X POST "$BASE/submit-tx" "${H[@]}" -d @-
# → { "success": true, "data": { "status": "inserted" | "duplicate", "message": "…" } }. Resubmitting the same txHash is safe.

# 7. Poll every few seconds until solved or failed (or abandonedAt is set)
curl -s "$BASE/submit-tx/status?txHash=$TX_HASH&srcChainKey=$SRC"
```

`data.status` moves through `pending → relaying → relayed → posting_execution → posted_execution` and ends at `solved` or `failed`. On failure, show the user `data.userMessage`, and handle it the way the [Swaps bot flow](/developers/http-api/swaps#bot-flow-create-submit-tx-poll) describes. The row also echoes `data.operation` as `leverage_deposit` or `leverage_withdraw`, so one poller can serve swaps and vaults.

### Withdraw with curl

A withdraw skips the allowance and approve steps. The backend builds it as a hub-wallet swap, so there is nothing to approve.

`/share-balance` takes the user's **hub wallet** as `owner`, and the leverage-yield API has no route that resolves it. Resolve it once with the SDK, `sodax.hubProvider.getUserHubWalletAddress(srcAddress, srcChainKey)`, and store it with the user.

```bash
DST=0xa4b1.arbitrum         # where the output token is delivered
OUTPUT_TOKEN=0x…            # the token the user receives, on $DST
SHARES=…                    # lsoda* to redeem (18 decimals): GET $BASE/share-balance?vault=…&owner=<hub wallet>

# 1. Quote: shares in → output token out. No partnerFee field on this route.
jq -n --arg vault "$VAULT" --arg src "$SRC" --arg token "$OUTPUT_TOKEN" --arg dst "$DST" --arg amount "$SHARES" \
  '{vault: $vault, srcChainKey: $src, tokenDst: $token, tokenDstChainKey: $dst, amount: $amount, quoteType: "exact_input"}' \
  | curl -s -X POST "$BASE/quote/withdraw" "${H[@]}" -d @- > quote.json
MIN_OUT=$(echo "$(jq -r .quotedAmount quote.json) * 9950 / 10000" | bc)

# 2. Build. No partnerFee field on this route either.
jq -n --arg vault "$VAULT" --arg src "$SRC" --arg user "$USER_ADDRESS" --arg dst "$DST" \
  --arg token "$OUTPUT_TOKEN" --arg amount "$SHARES" --arg min "$MIN_OUT" \
  '{vault: $vault, srcChainKey: $src, srcAddress: $user, dstChainKey: $dst, outputToken: $token, inputAmount: $amount, minOutputAmount: $min}' \
  | curl -s -X POST "$BASE/intents/withdraw" "${H[@]}" -d @- > created.json
```

Then sign and broadcast, `POST /submit-tx` with `"operation": "withdraw"`, and poll the same way as a deposit. The full route catalog is on [Leverage yield API](/developers/http-api/leverage).

## Gotchas {#gotchas}

1. **`deposit()` and `withdraw()` don't broadcast.** They only build a payload. Run it through `vaultSwap({ ...built, walletProvider })`, or the HTTP `submit-tx` flow.
2. **Quote with the leverage-yield quote.** Use `sodax.leverageYield.getQuote`, `useLeverageYieldQuote`, or `POST /quote/deposit|withdraw`, never `sodax.swaps.getQuote` or `useQuote`. The swap quote deducts the swap fee, so its `minOutputAmount` can be more than the vault intent can deliver, and the intent never fills.
3. **Use the same `partnerFee` on the quote and the intent, or omit it on both, and quote the gross amount.** The fee comes out of the input before the swap, and the leverage-yield quote deducts it for you. A fee mismatch, or an amount you already netted yourself, sizes `minOutputAmount` against the wrong net input.
4. **`swaps.partnerFee` never applies to vaults.** Configure `leverageYield.partnerFee` (or the global `fee`). A withdraw fee is taken in `lsoda*` shares, not in the output token.
5. **Only deposits need an approval, and it's the swap-domain one.** Approve the input token with `sodax.swaps.isAllowanceValid` / `approve` (or `useSwapAllowance` / `useSwapApprove`, or `/allowance/check` + `/approve`). Withdraws need no approval. `sodax.leverageYield.approve` / `isAllowanceValid` are for calling the vault directly on Sonic, and neither flow uses them.
6. **Mine `resetTx` before `tx`.** For some tokens (the 2017 TetherToken lineage), `/approve` returns a `resetTx` that zeroes the old allowance. Broadcast it and wait for it to be mined before `tx`. `useLeverageYieldApiApproveAndBroadcast` handles the ordering for you.
7. **Shares live in the hub wallet of the address that deposited.** That wallet is derived from the network and address the user deposited from, so withdraw with the same `srcChainKey` and `srcAddress`. `getShareBalanceForUser` takes the spoke address. `getShareBalance` and the HTTP `/share-balance` want the hub wallet address.
8. **A withdraw is sized in shares, not assets.** `inputAmount` is `lsoda*` shares, so size a full exit from the share balance (`getShareBalanceForUser`, `useLeverageYieldShareBalances`, `/share-balance`). `getMaxWithdraw*` and `/max-withdraw` return ERC-4626 `maxWithdraw`, which is in the underlying asset's units. `getMaxWithdrawForUser` also subtracts a small dust buffer.
9. **Headline APR is `getEffectiveApr`, not `getApr`.** `getApr` counts lending rates only and is often negative for an LST vault. The LST's staking yield is where the return comes from. On HTTP, use `GET /apr/effective?vault=<vault>`. The `vault` parameter is required.
10. **Mind the units.** `lsoda*` shares are always 18 decimals. APR values are RAY (`1e27` = 100%). The vault address is also the share-token address. The share side of a quote is always on Sonic.
11. **Terminal success is `solved`, not `executed`.** `executed` is the bridge API's terminal state. A set `abandonedAt` is terminal as well.
12. **The `submit-tx` body has traps.** `relayData` is `relayData.payload` (a string), and `operation` (`deposit` or `withdraw`) is required. In TypeScript, convert the create response's string `intent` to bigints before calling `submitTx`. `GET /submit-tx/status` needs both `txHash` and `srcChainKey`. Wait for the source-network receipt before you submit.
13. **Track by the source transaction.** Use `getDetailedStatus` / `useLeverageYieldDetailedStatus` with `(srcChainKey, srcTxHash)`. The backend record can be stale when the client-side fallback finished the swap.
14. **Branch on `result.ok`.** SDK and API client methods that return a `Result` never throw, so a `try/catch` misses every failure. The registry lookups (`listVaults`, `getVault`, `getVaultByAddress`) are synchronous and return plain values. Discriminate on `error.code`, never on `error.message`. A `getQuote` error can also be the solver's own response: check `isSodaxError(error)` first, and read `error.detail.code` on the solver's.
15. **Keep API keys on the server.** A key in a browser bundle, or behind `NEXT_PUBLIC_*` / `VITE_*`, is public.
16. **A vault isn't a leverage position.** Leverage positions (`sodax.leverageYield.openLeveragePosition`, `useOpenLeveragePosition`, `useLeveragePosition*`) share the service but are a separate product with their own sizing rules. `useLeverageYieldPosition` is the vault's snapshot.

## Build it with an AI agent {#ai-agents}

Install the [`@sodax/skills`](/ai-integration-guide) bundle and your agent loads the leverage-yield skills on its own: `sodax-sdk` (leverage-yield and leverage-yield-api) and `sodax-dapp-kit` (leverage-yield). Add the [Builders MCP](/builders-mcp) for live vault data and quotes. Then describe the task plainly, for example *"Add a deposit into the lsodaWEETH vault from Arbitrum with `@sodax/dapp-kit`"*. Point your agent at this page as well, and check its output against the [Gotchas](#gotchas): they are the rules generated code most often breaks.

## Related

<CardGroup cols={2}>
  <Card title="Leverage Yield (SDK)" icon="chart-line" href="/developers/packages/foundation/sdk/functional-modules/leverage_yield">
    Every `sodax.leverageYield` method, error code and type.
  </Card>
  <Card title="Effective APR" icon="percent" href="/developers/packages/foundation/sdk/functional-modules/leverage_yield_apr">
    How the headline APR is derived, with a worked example.
  </Card>
  <Card title="Leverage yield API" icon="server" href="/developers/http-api/leverage">
    Every `/v1/leverage-yield/*` route.
  </Card>
  <Card title="AI Integration Guide" icon="robot" href="/ai-integration-guide">
    Ship v2-correct SODAX code from your coding agent.
  </Card>
</CardGroup>
