# PRD + Plan — Single-step (atomic approve+transfer) for EIP-5792 EVM wallets

Status: draft · Owner: TBD · Feature area: `packages/sdk` swap + wallet

> Scope note: high-level on purpose. Signatures/placement/naming are the implementer's call after a short spike. Confirm every claim against `src/` before coding — the gasless code refactors.

## Problem
EVM swap/deposit today = 2 confirmations: `approve` then `transfer` (spoke deposit). Two signatures, two round-trips, a failure window between them. Every EIP-5792 wallet (MetaMask/Rabby/Coinbase) can batch these atomically ([MetaMask batch txs](https://docs.metamask.io/metamask-connect/evm/guides/send-transactions/batch-transactions)). We don't use that for the normal (non-gasless) path.

## Goal
Collapse `approve + transfer` into ONE atomic `wallet_sendCalls` confirmation. User still pays own gas (NOT gasless). Works on any EVM chain with an atomic-capable wallet — not only gasless-configured chains. Graceful fallback to 2-step when unsupported.

Core SDK exposes the full flow: (1) probe "wallet atomic-capable on this chain?", (2) build+send atomic `[approve, transfer]`, (3) fall back if not.

## Non-goals
- Not gasless: no paymaster / bundler / EIP-7702 sponsorship. (Gasless Mode A already exists — this is its unsponsored sibling.)
- ERC20 only (native has no `approve`).
- No rename of `IGaslessCapableEvmWalletProvider` (churn) — treat it as the EIP-5792 interface it already is.
- v1 = swap deposit only. Primitive generalizes to bridge / MM-supply later — note, don't build.

## Users / UX
dApp + SDK consumers. Demo `SwapCard`: when wallet atomic-capable → single "Swap" button (one confirm); else current Approve→Swap pair. No behavior change for non-5792 wallets.

## Existing building blocks (investigation — reuse map)
Gasless Mode A already did the hard parts; gap = it all assumes a paymaster + gasless-configured chain.

| Piece | Verdict |
|---|---|
| [`IGaslessCapableEvmWalletProvider`](packages/types/src/evm/evm.ts) + viem impl [`EvmWalletProvider.ts`](packages/wallet-sdk-core/src/wallet-providers/evm/EvmWalletProvider.ts) (`getCapabilities`/`sendCalls`/`waitForCallsStatus`, `forceAtomic`, optional `paymasterService`) | REUSE as-is |
| [`buildDepositCalls`](packages/sdk/src/gasless/internal/buildDepositCalls.ts) — encodes `[approve, assetManager.transfer]`, gasless-agnostic | REUSE as-is |
| [`detectWalletCapabilities`](packages/sdk/src/gasless/internal/capabilities.ts) — exposes `atomicSupported` but `resolvedMode` needs paymaster AND early-returns `unsupported` when chain not gasless-configured | RELAX: atomic-only resolution, decoupled from `config.gasless.isSupported` |
| [`executeSendCalls`](packages/sdk/src/gasless/internal/sendCallsExecutor.ts) — requires `paymasterUrl`, always sets `paymasterService` | RELAX: paymaster optional; keep `atomic:{status:'required'}` |
| [`GaslessService.sendCalls`/`getWalletCapabilities`](packages/sdk/src/gasless/GaslessService.ts) | REFERENCE — exact shape to mirror, unsponsored |
| [`SwapService`](packages/sdk/src/swap/SwapService.ts) `isAllowanceValid`/`approve`/`createIntent`/`swap` (already has opt-in gasless Mode A branch `gaslessSwapSteps`) | INTEGRATE — single-step = same tail minus sponsorship: build → sendCalls → relay → notify solver |
| dapp-kit `useGaslessWalletCapabilities`/`useGaslessSendCalls`, `useSwapAllowance`/`useSwapApprove`/`useSwap`; demo `SwapCard` gasless toggle | REFERENCE/INTEGRATE |

## Design sketch (not prescriptive)
- Relax the two internals so the atomic batch runs unsponsored; reuse `buildDepositCalls` untouched.
- Expose SDK: an atomic-batch capability probe (`{srcChainKey, walletProvider}` → atomic yes/no) + single-step execute. Likely on `SwapService`, mirroring the gasless branch. Implementer decides: fold into `swap()` opt-in branch vs. a distinct method — pick after spike.
- Guard: input must be ERC20 (typed error on native), like gasless.

## Implementation plan (tracer-bullet, dependency order)
Each phase self-contained + tested. Demo-able marker = where it's observable.

- **P0 — Spike (timeboxed).** Confirm `wallet_sendCalls` w/o `paymasterService` + `atomic:required` works on a live EIP-5792 wallet (user pays gas). Decide surface placement/naming + capability-decoupling approach. Output: 1-paragraph decision note in this file.
- **P1 — Relax internals + unit tests.** Paymaster-optional `executeSendCalls`; atomic-only capability resolution not gated on gasless config. Existing gasless tests stay green.
- **P2 — SDK public surface.** Capability probe + single-step execute (build `[approve,transfer]` → unsponsored `sendCalls` → return spoke txHash + relayData). Tests. *Demo-able: SDK-level.*
- **P3 — Swap integration.** Single-step branch in swap flow: one confirm → relay → notify solver; auto-fallback to 2-step when not atomic-capable. E2E/unit. *Demo-able: full swap via SDK.*
- **P4 — dapp-kit hooks.** Capability hook + single-step mutation hook (mirror gasless hooks; register in `_mutationContract.test.ts`).
- **P5 — Demo.** `SwapCard`: single button when capable, else Approve→Swap. *Demo-able: user-visible.*
- **P6 — Docs.** `packages/skills` (swap + single-step note), maybe `docs/`; `pnpm check:ai` green.

## Open questions (implementer resolves)
- Fold into `swap()` vs. standalone `sodax.swap.<x>` primitive?
- Reuse `GaslessWalletCapabilities.atomicSupported` for the probe vs. new lighter type?
- Partial atomic (`atomic.status` variants) — reject or best-effort? Confirm wallet behavior when `atomic:required` unsupported.
- Analytics: new action or reuse swap action w/ a flag?
- Interplay when BOTH gasless-eligible and atomic-capable — precedence?

## Risks
- Wallet EIP-5792 support uneven → capability probe must be conservative + fallback bulletproof.
- Sharing internals with gasless: don't regress the sponsored path (tests as guard).
- `atomic:required` semantics differ per wallet — verify, don't assume.

## Definition of done
- [ ] Probe: atomic support w/o paymaster and w/o gasless-configured chain.
- [ ] Execute: unsponsored atomic `[approve,transfer]` (user gas), `atomic:required` enforced, returns spoke txHash + relayData.
- [ ] Single-step swap: 1 confirm → relay → notify; auto-fallback to 2-step.
- [ ] Native/non-ERC20 rejected (typed error).
- [ ] Tests: atomic-only detection, unsponsored executor, build reuse, fallback; gasless tests green.
- [ ] dapp-kit hook(s) + demo one-button wiring.
- [ ] `packages/skills` updated; `pnpm build:packages && pnpm checkTs && pnpm test && pnpm check:ai` green from root.
