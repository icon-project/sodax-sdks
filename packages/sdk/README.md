# @sodax/sdk

## Get started

### Installation

```bash
# Using npm
npm install @sodax/sdk

# Using yarn
yarn add @sodax/sdk

# Using pnpm
pnpm add @sodax/sdk
```

### Local Installation

Package can be locally installed by following this steps:

1. Clone this repository to your local machine.
2. `cd` into repository folder location.
3. Execute `pnpm install` command in your CLI to install dependencies.
4. Execute `pnpm run build` to build the packages.
5. In your app repository `package.json` file, define dependency named `"@sodax/sdk"` under `"dependencies"`. Instead of version define absolute path to your SDK repository `"file:<sdk-repository-path>"` (e.g. `"file:/Users/dev/.../operation-liquidity-layer/packages/sdk"`). Full example: `"@sodax/sdk": "file:/Users/dev/operation-liquidity-layer/sdk-new/packages/sdk"`.

### Local Development

How to setup local development

1. Clone repository.
2. Make sure you have [Node.js](https://nodejs.org/en/download/package-manager) v18+ and corresponding npm installed on your system.
3. Execute `pnpm install` command (from root of the project) in your CLI to install dependencies.
4. Make code changes.
   1. Do not forget to export TS files in same folder `index.ts`.
   2. Always import files using `.js` postfix.

### Functional Modules inside the SDK

<a href="https://docs.sodax.com/developers/packages/sdk/swaps" class="button secondary" data-icon="rotate">Swaps (Solver)</a> -  Cross-chain intent-based swaps

* EVM (Arbitrum, Avalanche, Base, BSC, Optimism, Polygon, Sonic, HyperEVM, Lightlink) ✅
* Sui ✅
* Stellar ✅
* ICON ✅
* Solana ✅
* Injective ✅

<a href="https://docs.sodax.com/developers/packages/sdk/money_market" class="button secondary" data-icon="sack-dollar">Lend / Borrow (Money Market)</a>- Cross-chain lending and borrowing

* EVM (Arbitrum, Avalanche, Base, BSC, Optimism, Polygon, Sonic, HyperEVM, Lightlink) ✅
* Sui ✅
* Stellar ✅
* ICON ✅
* Solana ✅
* Injective ✅

<a href="https://docs.sodax.com/developers/packages/sdk/bridge" class="button secondary" data-icon="bridge-suspension">Bridge</a>- Cross-chain token bridging

* EVM (Arbitrum, Avalanche, Base, BSC, Optimism, Polygon, Sonic, HyperEVM, Lightlink) ✅
* Sui ✅
* Stellar ✅
* ICON ✅
* Solana ✅
* Injective ✅

<a href="https://docs.sodax.com/developers/packages/sdk/migration" class="button secondary" data-icon="truck">Migration</a>- Token migration (ICX, bnUSD, BALN)

<a href="https://docs.sodax.com/developers/packages/sdk/staking" class="button secondary" data-icon="seedling">Staking</a>- SODA token staking

* EVM (Arbitrum, Avalanche, Base, BSC, Optimism, Polygon, Sonic, HyperEVM, Lightlink) ✅
* Sui ✅
* Stellar ✅
* ICON ✅
* Solana ✅
* Injective ✅

### Tooling Modules inside the SDK

<a href="https://docs.sodax.com/developers/packages/sdk/backend_api" class="button secondary" data-icon="plug">Backend API</a>- Solver API endpoint documentation

<a href="https://docs.sodax.com/developers/packages/sdk/intent_relay_api" class="button secondary" data-icon="envelope">Intent Relay API</a>- Relayer API endpoint documentation

## AI agent docs

`@sodax/sdk` ships an AI-ready documentation tree at `node_modules/@sodax/sdk/ai-exported/`. It's tool-neutral: any agent that can read files (Claude Code, Cursor, Aider, Copilot Chat, ChatGPT with file context, etc.) can use it without further setup.

### Get started

Point your agent at `node_modules/@sodax/sdk/ai-exported/AGENTS.md` — it routes to the rest. Three sample prompts covering the typical entry points:

```
> Read node_modules/@sodax/sdk/ai-exported/AGENTS.md and integrate
> SODAX cross-chain swaps from Arbitrum to Stellar into my Node service.

> Read node_modules/@sodax/sdk/ai-exported/AGENTS.md. My code uses
> @sodax/sdk v1 — port my call sites to v2.

> Look up the v2 SodaxError code for a relay timeout in
> node_modules/@sodax/sdk/ai-exported/integration/reference/error-codes.md.
```

### What's inside

```
ai-exported/
├── AGENTS.md                          # Tool-neutral entry point — start here
├── integration/                       # Building NEW v2 code
│   ├── README.md, ai-rules.md         # Index + DO / DO NOT / workflow for agents
│   ├── quickstart.md                  # Install + initialize + first-run troubleshooting
│   ├── architecture.md                # Type system + design concepts (Result, ChainKeys, …)
│   ├── chain-specifics.md             # Non-EVM quirks (Stellar, BTC, Solana, ICON, NEAR)
│   ├── features/                      # 7 feature pages: swap, money-market, staking, bridge,
│   │                                  #   dex, icx-bnusd-baln, auxiliary-services
│   ├── recipes/                       # 8 copy-pasteable patterns: init, signed-/raw-tx flow,
│   │                                  #   error handling, narrowing, testing, gas, backend init
│   └── reference/                     # 5 lookup tables: chain keys, wallet providers,
│                                      #   error codes, public API surface, glossary
└── migration/                         # Porting EXISTING v1 code to v2
    ├── README.md, ai-rules.md         # Index + workflow for porting agents
    ├── checklist.md                   # 17-step cross-cutting checklist
    ├── breaking-changes/              # 3 cross-cutting changes: type-system, architecture,
    │                                  #   result-and-errors
    ├── features/                      # 7 per-feature porting playbooks (same names as
    │                                  #   integration/features/)
    ├── recipes.md                     # Codemods + error-shape and Result adapters
    └── reference/                     # 4 reference tables: deleted exports, sodax-config
                                       #   reshape, error-code crosswalk, return-shape diffs
```

### Scope

This tree documents `@sodax/sdk` (the Core SDK) only. It assumes:

- **TypeScript** — examples are TS; the SDK ships dual ESM/CJS.
- **Runtime-agnostic** — Node.js, browsers, bundled apps. **No React or Next.js content** — the SDK is UI-framework-agnostic and the docs reflect that.
- **`@sodax/types` is re-exported** through `@sodax/sdk`'s barrel; consumers don't add it as a separate dependency.

`@sodax/wallet-sdk-core` is **mentioned** in a few places as a pointer — it's a separate SODAX package that ships ready-made `I*WalletProvider` implementations for all 9 chain families. Consumers can install it separately or implement the wallet-provider interfaces themselves. React-layer packages (`@sodax/wallet-sdk-react`, `@sodax/dapp-kit`) are **out of scope here** and may have their own `ai-exported/` trees in their respective packages.

### Integrity guarantees

Every release passes four CI checks against `ai-exported/`:

| Guard | What it catches |
|---|---|
| `check:ai-exported` | Each top-level `sodax.X` reference matches a real public member of the `Sodax` class in `src/shared/entities/Sodax.ts`. (Shallow — `sodax.partners.invented` would still pass.) |
| `check:ai-scope` | No accidental sibling-package, React, or Next.js content leaks in. |
| `check:ai-links` | Every relative link between markdown files resolves. |
| `check:ai-imports` | Every `import … from '@sodax/sdk'` example in the docs typechecks against the SDK source. |

If you're contributing to this repo, run them with `pnpm -C packages/sdk run check:ai-exported` (or `:scope`, `:links`, `:imports`).

***

## Contributing

We welcome contributions! Please see our [Contributing Guide](https://github.com/icon-project/sodax-document/blob/main/developers/packages/sdk/CONTRIBUTING.md) for details.

***

## Development Commands

```bash
# Install dependencies
pnpm install

# Build the package
pnpm build

# Run in development mode
pnpm dev

# Run type checking
pnpm checkTs

# Format code
pnpm pretty

# Lint code
pnpm lint
```

***

## License

* [MIT](https://github.com/icon-project/sodax-document/blob/main/developers/packages/sdk/LICENSE/README.md)

***

## Support

* [GitHub Issues](https://github.com/icon-project/sodax-sdks/issues)
* [Discord Community](https://discord.gg/xM2Nh4S6vN)
