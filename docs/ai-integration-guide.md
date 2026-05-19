# Use Sodax SDKs with your AI coding agent

SODAX ships agent-native docs as `@sodax/skills`. Drop it into your project and your AI coding tool — Claude Code, Cursor, Codex, GitHub Copilot, and 50+ others via the `skills` CLI — writes v2-correct `@sodax/*` SDK code on the first try, instead of hallucinating v1 APIs or making up method signatures.

## Why this exists

**The problem**

- **LLM training data drifts.** Snippets you copy from a chat often use stale method names, reshaped types, or outdated error codes.
- **Public docs help humans, not agents.** An agent only reads what's in its context window — it doesn't fetch your docs site when generating code.

**Sodax's fix**

- **Docs ship as agent-native skills.** Eight `SKILL.md` files with YAML frontmatter cover migration (v1 → v2) and integration (new v2 code) for each `@sodax/*` package. The agent picks the right skills automatically based on what you're building.
- **Version-locked.** Re-run the install command to upgrade — the docs upgrade with it.
- **Written for AI consumption.** Short, table-heavy, with explicit DO / DON'T rules and copy-pasteable recipes. The supporting `knowledge/` tree under each skill carries the long-form reference material.

## What's inside

| Bundle | Contains |
|---|---|
| **8 skills** | `sodax-<pkg>-<mode>/SKILL.md` for `<pkg>` ∈ {`sdk`, `wallet-sdk-core`, `wallet-sdk-react`, `dapp-kit`} × `<mode>` ∈ {`migration`, `integration`}. |
| **Knowledge** | Long-form per-feature playbooks, recipes, reference tables, breaking-change writeups, and (for wallet-sdk-react) 4 working `.tsx` example apps. |
| **Router** | `AGENTS.md` maps the consumer's task (Node backend / React dapp / porting v1) to the right set of skills. |

> **What about `@sodax/types`?** No skill — the package has no consumer-facing surface. It's pure TypeScript types, re-exported through `@sodax/sdk`. Importing `@sodax/types` directly invites version skew. The SDK skill covers every type you need.

## Install

### `skills` CLI (recommended)

From the root of your consumer repo:

```bash
npx skills@latest add icon-project/sodax-sdks/packages/skills
```

The [`skills` CLI from Vercel Labs](https://github.com/vercel-labs/skills) is the open agent-skills ecosystem CLI. It supports Claude Code, Cursor, Codex, GitHub Copilot, Cline, Continue, Windsurf, Gemini CLI, OpenCode, Qwen Code, and 40+ other agents. The CLI detects your tool and installs the eight skills + supporting knowledge into the conventional directory for that agent (e.g. `.claude/skills/`, `.cursor/skills/`). Re-running the same command picks up the latest content.

Useful flags:

- `-a <agent>` — target a specific agent explicitly (e.g. `-a cursor`).
- `-g, --global` — install into your user-global agent directory (`~/.<agent>/skills/`) instead of the project.

Your agent reads the skill frontmatter and loads the right skill automatically based on your prompt.

### npm fallback (web chats / unsupported tools)

For ChatGPT, Claude.ai web chat, or any tool not covered by the `skills` CLI, install the bundle as a regular npm dev dependency:

```bash
pnpm add -D @sodax/skills
# or: npm install --save-dev @sodax/skills
```

Then attach `node_modules/@sodax/skills/AGENTS.md` plus the relevant `SKILL.md` (and 1–2 knowledge files if needed) directly to the conversation. The router + a single skill fits comfortably in a single Claude or ChatGPT context window.

## How an agent uses the skills

The flow is the same regardless of tool:

1. **AGENTS.md routes by intent.** "I'm building a React dapp" → load `sodax-wallet-sdk-react-integration` + `sodax-dapp-kit-integration`. "I'm porting a v1 Node script" → load `sodax-sdk-migration`. The full table is in `AGENTS.md` wherever the CLI installed it (e.g. `.claude/skills/sodax-skills/AGENTS.md`, `.cursor/skills/sodax-skills/AGENTS.md`), or `node_modules/@sodax/skills/AGENTS.md` if you used the npm path.
2. **Each skill follows a procedure.** Its `description:` frontmatter is the trigger; the body has **When to use**, **Workflow** (numbered steps linking into knowledge), **Top traps**, **Conventions**, **Verification**, **Related skills**. Don't skip the `ai-rules.md` step — that's the consolidated DO / DON'T list.
3. **Knowledge is reference-only.** The skill points the agent at the right file in `knowledge/<pkg>/<mode>/`. Don't read knowledge top-to-bottom — let the skill decide.

## Prompt naturally

Once installed, just describe the task — the agent picks the skills.

### Example 1 — new v2 code

> "Swap 100 USDC on Ethereum for SOL on Solana using `@sodax/sdk`."

A correctly-wired agent loads `sodax-sdk-integration`, reads `knowledge/sdk/integration/ai-rules.md` and `knowledge/sdk/integration/features/swap.md`, and produces code that uses `ChainKeys.ETHEREUM_MAINNET` (not hard-coded strings), branches on `result.ok` (not `try/catch`), passes `raw: false` alongside `walletProvider`, and doesn't try to construct a `*SpokeProvider` class.

### Example 2 — porting v1 → v2

> "Migrate my project to Sodax v2."

The agent reads `AGENTS.md`, detects v1 fingerprints (`*_MAINNET_CHAIN_ID`, `useSpokeProvider`, `xChainId`, `MoneyMarketError`, etc.) via grep, loads `sodax-sdk-migration` + `sodax-dapp-kit-migration` + `sodax-wallet-sdk-react-migration` as needed, walks each call site through their respective `breaking-changes/` writeups, applies the mechanical renames first, and converts `try/catch` to `Result.ok` branching last.

## Tips

| Tip | Why it matters |
|---|---|
| **Re-run the install on each `@sodax/*` upgrade** | The skills are version-locked to the SDK release; bumping one without the other invites drift. |
| **Read `ai-rules.md` first** | Each tree's `ai-rules.md` is the consolidated DO/DON'T list. Skipping it is the most common cause of agents reverting to v1 patterns. |
| **Use the `reference/` tables** | When the agent invents a chain key or error code, point it at `knowledge/<pkg>/<mode>/reference/` instead of letting it guess. |
| **Don't add `@sodax/types` directly** | It's re-exported through `@sodax/sdk` — adding it separately risks version skew. |
| **Don't deep-import from `dist/`** | Internal paths aren't stable across releases. The skills only reference public package roots. |

## Feedback

If the agent gets something wrong despite reading the skills, that's a doc bug — please open an issue on the [Sodax SDKs repo](https://github.com/icon-project/sodax-sdks/issues) with the prompt and the incorrect output. The skills package is CI-guarded for structural correctness (SKILL.md frontmatter, plugin.json, relative-link resolution), but prose-level claims benefit from real-world feedback.

To inspect or contribute to the skill files directly, browse the source at [`packages/skills` on GitHub](https://github.com/icon-project/sodax-sdks/tree/main/packages/skills).
