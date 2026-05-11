# apps/node

Node.js scripts for E2E-testing `@sodax/sdk` against real chains. One file per chain or feature, each runnable via a `pnpm run <name>` script that builds with `tsc` then runs the compiled JS.

## Run

```bash
cd apps/node
pnpm build              # tsc → dist/
pnpm sonic              # then: node dist/sonic.js
pnpm moneyMarket
pnpm swap
# … etc — see package.json scripts
```

Or in one shot per script (each `pnpm run <x>` does `pnpm run build && node dist/<x>.js`).

### Prerequisites

Create `.env` in `apps/node/` with:

```
PRIVATE_KEY=0x…   # used by every script
```

Some scripts also expect chain-specific RPC URLs or extra keys — check the imports in the script you're running. Public RPCs are used as fallback where possible.

## Structure

```
src/
├── btc.ts, evm.ts, sonic.ts, sui.ts, …    # one file per chain (spoke or hub)
├── moneymarket.ts, moneymarket-actions.ts, moneymarket-ops.ts
├── swap.ts                                 # intent-based swap E2E
├── soda-staking.ts
├── bitcoin-radfi.ts                        # Bitcoin via Radfi provider
├── config.ts                               # shared config (RPC URLs, addresses)
└── tests/                                  # focused regression scripts
    ├── bnusd-migration.test.ts
    ├── estimate-gas.test.ts
    ├── backend-api.test.ts
    ├── mm-cross-chain.test.ts
    ├── bridge-limits.test.ts
    ├── raw-spoke-provider.test.ts
    └── submit-swap-tx.test.ts
```

The files named `*.test.ts` are *not* Vitest — they're standalone scripts run via the matching `pnpm run <…>-test` script.

## What this app is for

- Pre-release smoke testing each chain integration against mainnet.
- Reproducing partner-reported bugs with a minimal Node script.
- Reference for backend partners using `@sodax/sdk` without React.

## Scripts

```bash
pnpm build        # tsc — emits to dist/
pnpm checkTs      # tsc --noEmit
pnpm lint         # biome lint --write
pnpm pretty       # biome format --write
```

`pnpm test` is a no-op (`true`) — these scripts run interactively against real chains and aren't part of CI.

## Common pitfalls

- **Real funds.** Every script signs with `PRIVATE_KEY` and broadcasts to mainnet. Use a dedicated test wallet with minimal balance; never use a wallet that holds real value.
- **ICON chain is being phased out.** `icon.ts` and ICON-touching tests may fail — that's expected, don't treat as a regression.
- **Type module.** `package.json` declares `"type": "module"` and tsconfig is `NodeNext`. Relative imports in source must use `.js` extensions (resolved post-build).
- **Build before run.** Every `pnpm run <x>` script already chains `pnpm build` first, but if you're iterating with `node dist/...` directly remember to rebuild after edits.
- **Don't add Vitest here.** The `tests/` directory uses `*.test.ts` naming convention but they're plain scripts. The package's `test` script is intentionally `true` — these run against live chains and aren't suited for CI.
