# @sodax/skills

AI-agent skills and knowledge for building on the **SODAX** cross-chain DeFi platform. Drop this into your repo and your AI coding agent writes v2-correct `@sodax/*` SDK code on the first try.

**Full setup** (skills CLI, npm, monorepo/local install, wiring agents to `AGENTS.md`): [docs/ai-integration-guide.md](https://github.com/icon-project/sodax-sdks/blob/main/docs/ai-integration-guide.md).

## Install

Using the [`skills` CLI](https://github.com/vercel-labs/skills) from Vercel Labs — the open agent-skills ecosystem CLI (supports Claude Code, Cursor, Codex, GitHub Copilot, and 50+ other agents):

```bash
# From the root of your consumer repo
npx skills@latest add icon-project/sodax-sdks/packages/skills
```

Four mode-gated skills land in your repo (under `.claude/skills/` or wherever the CLI installs them) — one per SODAX SDK package, each with two knowledge subtrees (`integration/` for new v2 code, `migration-v1-to-v2/` for v1→v2 porting) — plus a router `AGENTS.md`. Re-running the command picks up the latest content.

> **npm fallback** (web chats or when you prefer a devDependency): `pnpm add -D @sodax/skills`, then point your agent at `node_modules/@sodax/skills/AGENTS.md`. See the [integration guide](https://github.com/icon-project/sodax-sdks/blob/main/docs/ai-integration-guide.md#wire-your-agent).

## What you get

| Bundle | Contains |
|---|---|
| **4 mode-gated skills** under `skills/sodax-<pkg>/SKILL.md` | One skill per SODAX SDK package. `<pkg>` ∈ `sdk`, `wallet-sdk-core`, `wallet-sdk-react`, `dapp-kit`. Each SKILL.md gates by mode (integration vs migration) at the top of the body. |
| **Knowledge** under `skills/sodax-<pkg>/{integration,migration-v1-to-v2}/knowledge/` | Long-form supporting docs — features, recipes, reference tables, breaking-change writeups, code examples. Each skill ships both mode subtrees so `npx skills add` copies the full reference together. |
| **`AGENTS.md`** at the package root | Tool-neutral router: maps the consumer's stated task to the right skill + mode. |

Skills are short and action-oriented (workflow + anti-patterns + links). Knowledge is the lookup material. Don't read knowledge files top-to-bottom — the skill tells the agent which file is relevant for the current task.

## Which skill applies?

After install, your agent picks based on what you're building. Quick guide:

| You're building | Load these skills (mode) |
|---|---|
| Backend / Node app (no React) using `@sodax/sdk` | `sodax-sdk` (integration) + `sodax-wallet-sdk-core` (integration; if signing) |
| React dapp using `@sodax/dapp-kit` | `sodax-dapp-kit` (integration) + `sodax-wallet-sdk-react` (integration; always) + `sodax-sdk` (integration; for any unwrapped operations) |
| React app calling the SDK directly (no `dapp-kit`) | `sodax-sdk` (integration) + `sodax-wallet-sdk-react` (integration) |
| **Porting v1 code** | Same skills, switched to migration mode (each SKILL.md mode-gates by consumer signal). |

`AGENTS.md` says the same thing in router form — your agent reads it first and picks.

## Why this exists

LLM training data drifts: snippets from chat often use stale method names, reshaped types, or outdated error codes. Public docs help humans, not agents — an agent only reads what's in its context window. This package ships the right material in agent-native form so the agent reads it before generating code. The content is version-locked to the SDK — upgrade `@sodax/skills`, the docs upgrade with it.

## Feedback

If your agent generates wrong code despite reading the docs, that's a doc bug — please open an issue on the [Sodax SDKs repo](https://github.com/icon-project/sodax-sdks/issues) with the prompt and the incorrect output. The per-skill `knowledge/` subtrees are structurally CI-guarded (frontmatter, link resolution); prose claims benefit from real-world feedback.
