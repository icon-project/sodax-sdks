# apps/demo

Vite + React showcase for the full SDK surface. The "kitchen sink" — every feature service in `@sodax/sdk` has a page here exercised through `@sodax/dapp-kit` hooks and `@sodax/wallet-sdk-react`.

Package name: `sodax-demo-v2`. Dev server port: **3000**.

## Run

```bash
pnpm dev:demo                        # from repo root
# or
pnpm --filter sodax-demo-v2 dev
```

Requires `pnpm build:packages` first if the SDK packages haven't been built.

## Structure

```
src/
├── App.tsx              # react-router routes — one route per feature
├── providers.tsx        # SodaxProvider + SodaxWalletProvider + QueryClientProvider stack
├── constants.ts         # solver env configs (production / staging / dev)
├── pages/               # one folder per feature
│   ├── solver/          # intent-based swaps
│   ├── money-market/    # cross-chain lending/borrowing (per-chain route param)
│   ├── bridge/          # cross-chain token transfers
│   ├── dex/             # concentrated liquidity / AMM
│   ├── staking/         # SODA staking
│   ├── partner-fee-claim/
│   └── recovery/        # withdraw stuck hub-wallet assets
├── components/          # feature components grouped by domain (mm, dex, bridge, staking, swaps, bitcoin, shared, ui)
├── hooks/               # demo-specific composite hooks
├── lib/                 # utilities (chains, scan URLs, logging, etc.)
└── zustand/useAppStore  # UI state: selected chain, wallet modal, solver env switcher
```

## How it wires up

- **Routing.** `App.tsx` defines routes with react-router. `/` redirects to `/solver`. Money market uses a `:chainId` route param (defaults to Arbitrum).
- **Providers.** `providers.tsx` is the canonical stack to copy when integrating: `SodaxProvider` → `QueryClientProvider` (via `createSodaxQueryClient`) → `SodaxWalletProvider`. RPC URLs are read from `process.env.*` with public-RPC fallbacks. WalletConnect is opt-in via `VITE_WALLETCONNECT_PROJECT_ID`.
- **Solver env switcher.** `useAppStore.solverEnvironment` picks between `productionSolverConfig` / `stagingSolverConfig` / `devSolverConfig` from `constants.ts`. The `Providers` component re-memoizes the SDK config when this changes.
- **UI.** Tailwind v4 + Radix primitives + shadcn-style components in `src/components/ui/`.

## What this app is for

- Manual QA / smoke testing every feature against a real wallet.
- Reference implementation for partners integrating `@sodax/dapp-kit` — the pages and `providers.tsx` are the "how do I wire this up" answer.

Not production-grade UX. Intentionally exposes raw SDK knobs (solver env, recovery, raw chain IDs) that a real dApp would hide.

## Scripts

```bash
pnpm dev          # vite dev server on :3000
pnpm build        # NODE_OPTIONS=--max-old-space-size=8192 vite build
pnpm preview      # serve built bundle
pnpm checkTs      # tsc --noEmit
pnpm lint         # biome lint --write
pnpm pretty       # biome format --write
```

`pnpm test` is a no-op (`true`) — there are no tests in this app.

## Common pitfalls

- **Node polyfills.** Uses `@bangjelkoski/vite-plugin-node-polyfills` (Bitcoin/Solana deps pull in `buffer`, `crypto`, etc.). If a new dependency requires a polyfill, add it there rather than in app code.
- **Env vars.** Vite-side env vars must be `VITE_*` (e.g. `VITE_WALLETCONNECT_PROJECT_ID`). The RPC overrides in `providers.tsx` read from `process.env.*` which is replaced at build time — leaving them unset is fine (public fallbacks).
- **Build memory.** Build script sets `--max-old-space-size=8192` because the bundle is large. Don't drop that flag.
- **Don't add business logic here.** This app demos the SDK; real wallet/registration/ToS flows belong in partner apps, not in `demo/`.
