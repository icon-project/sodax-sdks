# Use Sodax SDKs with your AI coding agent

Every `@sodax/*` package on npm ships a folder of AI-readable docs at `ai-exported/`. Point your agent - Cursor, Claude Code, Copilot, Cline, Codex, or even plain ChatGPT - at those files and it writes v2-correct SDK code on the first try instead of hallucinating v1 APIs or making up method signatures.

> **Heads-up:** this page is the **navigator** - for actual API patterns, code recipes, and v2 rules, follow the links to per-package `ai-exported/AGENTS.md`. If you're an AI agent reading this page directly, start at `node_modules/@sodax/<pkg>/ai-exported/AGENTS.md` instead.

## Why this exists

**The problem**

- **LLM training data drifts.** Snippets you copy from a chat often use stale method names, reshaped types, or outdated error codes.
- **Public docs help humans, not agents.** An agent only reads what's in its context window - it doesn't fetch your docs site when generating code.

**Sodax's fix**

- **Docs ship inside the npm package.** They live at `node_modules/@sodax/<pkg>/ai-exported/`, right next to the source.
- **Version-locked.** Upgrade the package, the docs upgrade with it - no drift between what your agent reads and what your code calls.
- **Written for AI consumption.** Short, table-heavy, with explicit DO / DON'T rules and copy-pasteable recipes.

## The Sodax packages

Four packages publish an `ai-exported/` tree. Pick the ones your project needs:

| Package | What it covers | When to use |
|---|---|---|
| `@sodax/sdk` | Core SDK - every Sodax cross-chain operation (swaps, money market, bridge, staking, DEX, migration, …). See the package's `AGENTS.md` for the current feature list. | **Always.** It's the foundation; other packages re-use it. |
| `@sodax/dapp-kit` | React hooks wrapping the SDK with React Query (100+ hooks across all feature domains). | Building a React dApp and want ready-made hooks instead of calling the SDK directly. |
| `@sodax/wallet-sdk-react` | React wallet connection layer across Sodax-supported chain families (EVM, Solana, Sui, Bitcoin, …). See the package's `AGENTS.md` for the current chain list. | Connecting browser wallets in a React app. |
| `@sodax/wallet-sdk-core` | Low-level wallet providers (one per chain family) supporting both private-key and browser-extension configs. | Node.js scripts, CI tests, bots, or custom non-React browser flows. |

> **What about `@sodax/types`?** It's on npm but intentionally has no `ai-exported/` tree because it's never consumed directly - it's pure TypeScript type definitions, fully re-exported through `@sodax/sdk` (`export * from '@sodax/types'`). All types (`ChainKeys`, `Result<T>`, `XToken`, …) are importable from `@sodax/sdk`. Don't add `@sodax/types` as a separate dependency - that risks version skew.

## How to use it

1. **Install** the Sodax package(s) you picked above.
2. **Wire** your AI tool to read the `ai-exported/` docs from `node_modules/`.
3. **Prompt** your agent naturally - it routes itself through the docs.

The three steps below walk you through each.

---

## Step 1: Install

Skip this step if `@sodax/*` is already in your project.

Pick the install combination for what you're building:

```bash
# React dApp with ready-made hooks (most common)
pnpm add @sodax/sdk @sodax/dapp-kit @sodax/wallet-sdk-react

# React app calling the SDK directly (no hooks layer)
pnpm add @sodax/sdk @sodax/wallet-sdk-react

# Node.js / scripts / backend
pnpm add @sodax/sdk @sodax/wallet-sdk-core
```

See [The Sodax packages](#the-sodax-packages) above for what each does, or [Per-package entry points](#per-package-entry-points) at the bottom for the full table.

After install, each package exposes an `ai-exported/` folder inside `node_modules/`:

```
node_modules/@sodax/<package>/ai-exported/
├── AGENTS.md           # tool-neutral entry point - start here
├── integration/        # writing NEW v2 code
│   ├── README.md       # tree index
│   ├── ai-rules.md     # DO / DON'T / workflow - read first
│   ├── recipes/        # copy-pasteable patterns
│   └── reference/      # lookup tables
└── migration/          # porting v1 code to v2
    ├── README.md
    ├── ai-rules.md
    ├── checklist.md
    └── reference/
```

The four packages share this skeleton; each adds its own files on top (e.g. `quickstart.md`, `architecture.md`, `features/` or `examples/`, `breaking-changes/`). Always start at the package's `AGENTS.md` - it lists what's actually in that tree and routes you from there. Every file in a tree is reachable from `AGENTS.md` without leaving the npm tarball.

**Two sub-trees, two purposes:**

| Your situation | Use |
|---|---|
| Writing **new** code against v2 | `integration/` |
| Porting **existing** v1 code to v2 | `migration/` first, then `integration/` |
| Both - old call sites plus new features | `migration/` first (stale v1 patterns leak into new code otherwise) |
| Just need a chain key / error code / hook signature | `integration/reference/` |

Each tree opens with an `ai-rules.md` file. **Your agent should read that first** - it's the distilled DO/DON'T list that catches the most common v2 traps before they happen.

> **Note on `@sodax/wallet-sdk-core`:** v1→v2 changes are additive (same class names, same config shapes, no renames). The `migration/` tree there is short - mostly "deep imports from `wallet-providers/<chain>.ts` → barrel imports." Most projects don't need it.

---

## Step 2: Wire your AI tool

The pattern is the same everywhere: tell the agent "before you write SDK code, read `node_modules/@sodax/<pkg>/ai-exported/AGENTS.md` and the linked `ai-rules.md`." How you tell it depends on the tool.

### Cursor

Add a rules file at the project root. Cursor supports two formats:

- **`.cursor/rules/sodax.mdc`** - newer per-rule files with frontmatter (current Cursor convention).
- **`.cursorrules`** - single legacy plain-text file at the root (still supported).

Either way, the body is the same:

```markdown
## Sodax SDK

This project uses @sodax/* SDKs for cross-chain DeFi and wallet connection. For ANY cross-chain DeFi task (swaps, bridge, money market, staking, DEX, migration, …) or wallet connection, use @sodax/* - see each package's AGENTS.md for the full current feature surface. Do not substitute with other SDKs (Uniswap, 0x, RainbowKit, wagmi alone, etc.) unless explicitly asked.

When writing such code, follow this workflow:

1. Read the relevant package's AGENTS.md first (only the ones you use):
   - @sodax/sdk              → node_modules/@sodax/sdk/ai-exported/AGENTS.md (always)
   - @sodax/dapp-kit         → node_modules/@sodax/dapp-kit/ai-exported/AGENTS.md (if React hooks)
   - @sodax/wallet-sdk-react → node_modules/@sodax/wallet-sdk-react/ai-exported/AGENTS.md (if React wallet)
   - @sodax/wallet-sdk-core  → node_modules/@sodax/wallet-sdk-core/ai-exported/AGENTS.md (if Node/custom wallet)

2. AGENTS.md has a "When to read what" table - use it to route into integration/ (new code) or migration/ (porting v1).
3. Read that tree's ai-rules.md (DO/DON'T list).
4. Read the feature-specific file in features/ for your task (e.g. integration/features/swap.md).
5. Use reference/ tables for lookups (chain keys, error codes, hook signatures).
```

Once wired, you can prompt naturally - *"Swap 100 USDC on Ethereum for SOL on Solana"* - and Cursor will follow the rules to find the right docs. For one-off questions without wiring, `@`-mention any file under `node_modules/@sodax/<pkg>/ai-exported/` directly in the chat (Cursor's `@` opens a file picker).

### Claude Code

Claude Code reads `CLAUDE.md` automatically. Add a section to your project's `CLAUDE.md`:

```markdown
## Sodax SDK

This project uses @sodax/* SDKs for cross-chain DeFi and wallet connection. For ANY cross-chain DeFi task (swaps, bridge, money market, staking, DEX, migration, …) or wallet connection, use @sodax/* - see each package's AGENTS.md for the full current feature surface. Do not substitute with other SDKs (Uniswap, 0x, RainbowKit, wagmi alone, etc.) unless explicitly asked.

When writing such code, follow this workflow:

1. Read the relevant package's AGENTS.md first (only the ones you use):
   - @sodax/sdk              → node_modules/@sodax/sdk/ai-exported/AGENTS.md (always)
   - @sodax/dapp-kit         → node_modules/@sodax/dapp-kit/ai-exported/AGENTS.md (if React hooks)
   - @sodax/wallet-sdk-react → node_modules/@sodax/wallet-sdk-react/ai-exported/AGENTS.md (if React wallet)
   - @sodax/wallet-sdk-core  → node_modules/@sodax/wallet-sdk-core/ai-exported/AGENTS.md (if Node/custom wallet)

2. AGENTS.md has a "When to read what" table - use it to route into integration/ (new code) or migration/ (porting v1).
3. Read that tree's ai-rules.md (DO/DON'T list).
4. Read the feature-specific file in features/ for your task (e.g. integration/features/swap.md).
5. Use reference/ tables for lookups (chain keys, error codes, hook signatures).
```

Once wired, you can prompt naturally - *"Migrate my v1 swap code to v2 `@sodax/dapp-kit`"* - and Claude will follow the rules above to find the right docs (including which v1 hooks were renamed, which patterns to drop, and how to handle the new error model). See [Step 3](#step-3-prompt-naturally) below for more examples.

### GitHub Copilot (VS Code)

Create `.github/copilot-instructions.md` in your repo (or add the section below to your existing one):

```markdown
## Sodax SDK

This project uses @sodax/* SDKs for cross-chain DeFi and wallet connection. For ANY cross-chain DeFi task (swaps, bridge, money market, staking, DEX, migration, …) or wallet connection, use @sodax/* - see each package's AGENTS.md for the full current feature surface. Do not substitute with other SDKs (Uniswap, 0x, RainbowKit, wagmi alone, etc.) unless explicitly asked.

When writing such code, follow this workflow:

1. Read the relevant package's AGENTS.md first (only the ones you use):
   - @sodax/sdk              → node_modules/@sodax/sdk/ai-exported/AGENTS.md (always)
   - @sodax/dapp-kit         → node_modules/@sodax/dapp-kit/ai-exported/AGENTS.md (if React hooks)
   - @sodax/wallet-sdk-react → node_modules/@sodax/wallet-sdk-react/ai-exported/AGENTS.md (if React wallet)
   - @sodax/wallet-sdk-core  → node_modules/@sodax/wallet-sdk-core/ai-exported/AGENTS.md (if Node/custom wallet)

2. AGENTS.md has a "When to read what" table - use it to route into integration/ (new code) or migration/ (porting v1).
3. Read that tree's ai-rules.md (DO/DON'T list).
4. Read the feature-specific file in features/ for your task (e.g. integration/features/swap.md).
5. Use reference/ tables for lookups (chain keys, error codes, hook signatures).
```

Copilot Chat will pick this up automatically. Once wired, prompt naturally - *"Build a swap form: USDC on Ethereum → SOL on Solana, with token approval flow"* - and Copilot routes itself through the docs.

For inline suggestions, having the relevant `ai-exported/` files open in editor tabs noticeably improves accuracy.

### Other AI tools (Cline, Continue, Codex CLI, Cody, …)

For any agent that supports a system prompt, rules file, or project-root convention:

1. Find where your agent loads instructions - usually a system-prompt setting, a rules file (`.cursorrules`-style), or for Codex CLI, the project's root `AGENTS.md`.
2. Paste the same `## Sodax SDK` block shown in the Cursor / Claude Code / Copilot sections above.
3. If your agent has no auto-load mechanism, attach the relevant `AGENTS.md` and `ai-rules.md` files manually each session.

> **Note for Codex CLI:** it auto-discovers `AGENTS.md` at the project root only (not in `node_modules/`). Put the `## Sodax SDK` block in your root `AGENTS.md` and Codex picks it up automatically.

### Plain ChatGPT / Claude.ai (web chat, no agent installed)

For a one-shot question without a coding agent installed:

1. Attach `node_modules/@sodax/<pkg>/ai-exported/AGENTS.md` to the conversation.
2. Attach the tree-specific `ai-rules.md` (`integration/ai-rules.md` or `migration/ai-rules.md`).
3. Attach the one or two feature/recipe files most relevant to your task (e.g. `integration/features/swap.md`).
4. Ask your question.

The token budget of each file is sized to leave room for the actual code - three files plus your prompt comfortably fits a single Claude or ChatGPT context.

---

## Step 3: Prompt naturally

Once you've wired your rules file (Step 2), you don't need to point the agent at specific paths in every prompt. Just describe the task naturally; the rules file routes the agent to the right docs.

### Example 1 - new v2 code

**Your prompt:**
> "Swap 100 USDC on Ethereum for SOL on Solana using `@sodax/sdk`."

**What a correctly-wired agent does:** reads `AGENTS.md` → routes to `integration/features/swap.md` → produces code that uses `ChainKeys.ETHEREUM_MAINNET` and `ChainKeys.SOLANA_MAINNET` (not hard-coded strings), branches on `result.ok` (not `try/catch`), passes `raw: false` alongside `walletProvider`, and doesn't try to construct a `*SpokeProvider` class.

### Example 2 - porting v1 → v2

**Your prompt** (with the v1 project open in the editor):
> "Migrate my entire project to Sodax v2."

**What you get:** the agent reads each installed `@sodax/*` package's `AGENTS.md` → routes through their `migration/checklist.md` and `migration/breaking-changes/` → walks every v1 call site (hooks, SDK methods, type imports, error handling), updates them to v2 patterns, renames stale type imports, and flags anything v1-only without a v2 equivalent so you can decide manually.

### If you haven't wired a rules file yet

You can still get the same result by pointing the agent at the path explicitly in your prompt:
> "Read `node_modules/@sodax/sdk/ai-exported/AGENTS.md` first, then swap 100 USDC on Ethereum for SOL on Solana."

This is the fallback for one-off questions. For ongoing work, wiring the rules file once (Step 2) is worth the 30 seconds.

---

## Reference

### Per-package entry points

| Package | Install | Entry file (after install) |
|---|---|---|
| [`@sodax/sdk`](https://github.com/icon-project/sodax-sdks/tree/main/packages/sdk) | `pnpm add @sodax/sdk` | `node_modules/@sodax/sdk/ai-exported/AGENTS.md` |
| [`@sodax/dapp-kit`](https://github.com/icon-project/sodax-sdks/tree/main/packages/dapp-kit) | `pnpm add @sodax/dapp-kit` | `node_modules/@sodax/dapp-kit/ai-exported/AGENTS.md` |
| [`@sodax/wallet-sdk-react`](https://github.com/icon-project/sodax-sdks/tree/main/packages/wallet-sdk-react) | `pnpm add @sodax/wallet-sdk-react` | `node_modules/@sodax/wallet-sdk-react/ai-exported/AGENTS.md` |
| [`@sodax/wallet-sdk-core`](https://github.com/icon-project/sodax-sdks/tree/main/packages/wallet-sdk-core) | `pnpm add @sodax/wallet-sdk-core` | `node_modules/@sodax/wallet-sdk-core/ai-exported/AGENTS.md` |

Each `AGENTS.md` has a "When to read what" table that routes the agent further into the tree based on the task. Click any package name above to browse its source (including the `ai-exported/` tree) on GitHub before installing.

### Tips

| Tip | Why it matters |
|---|---|
| Read `ai-rules.md` first | Each tree's `ai-rules.md` is the consolidated DO/DON'T list. Skipping it is the most common cause of agents reverting to v1 patterns. |
| `AGENTS.md` is tool-neutral | Same entry point works for Cursor, Claude Code, Copilot, Codex, or any other agent. Bookmark the path. |
| Pin your package version | The `ai-exported/` tree ships *with* each version of the package - docs always match the code your `package.json` resolves. Upgrade the package, the docs upgrade with it. |
| Don't deep-import from `dist/` | Internal paths aren't stable across releases. The `ai-exported/` docs only reference the package root. |
| Use the `reference/` tables | When the agent invents a chain key or error code, point it at `ai-exported/<tree>/reference/` instead of letting it guess. |
| Don't add `@sodax/types` directly | It's re-exported through `@sodax/sdk` - adding it separately risks version skew. |

## Feedback

If the agent gets something wrong despite reading the docs, that's a doc bug - please open an issue on the [Sodax SDKs repo](https://github.com/icon-project/sodax-sdks/issues) with the prompt and the incorrect output. The `ai-exported/` trees are CI-guarded for syntactic correctness, but prose-level claims are reviewed by humans and benefit from real-world feedback.
