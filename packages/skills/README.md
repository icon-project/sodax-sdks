# @sodax/skills

AI-agent skills and knowledge for building on the **SODAX** cross-chain DeFi platform. Drop this into your repo and your AI coding agent (Claude Code today; other agents read the markdown directly) writes v2-correct `@sodax/*` SDK code on the first try.

## Install

Using the [Claude Skills CLI](https://github.com/mattpocock/skills) (the same CLI as [mattpocock/skills](https://github.com/mattpocock/skills)):

```bash
# From the root of your consumer repo
npx skills@latest add icon-project/sodax-sdks/packages/skills
```

Eight skills land in your repo (under `.claude/skills/` or wherever the CLI installs them), one knowledge tree per SODAX SDK package, and a router `AGENTS.md`. Re-running the command picks up the latest content.

> **No subpath support?** As a fallback, install via npm and read directly:
> ```bash
> pnpm add -D @sodax/skills
> # Then in CLAUDE.md / .cursor/rules / AGENTS.md, point your agent at
> # node_modules/@sodax/skills/AGENTS.md
> ```

## What you get

| Bundle | Contains |
|---|---|
| **8 skills** under `skills/sodax-<pkg>-<mode>/SKILL.md` | One skill per (package, mode). `<pkg>` ∈ `sdk`, `wallet-sdk-core`, `wallet-sdk-react`, `dapp-kit`. `<mode>` ∈ `migration` (port v1 → v2), `integration` (write new v2 code). |
| **Knowledge** under `knowledge/<pkg>/<mode>/` | Long-form supporting docs — features, recipes, reference tables, breaking-change writeups, code examples. Skills link into these. |
| **`AGENTS.md`** at the package root | Tool-neutral router: maps the consumer's stated task to the right set of skills. |

Skills are short and action-oriented (workflow + anti-patterns + links). Knowledge is the lookup material. Don't read knowledge files top-to-bottom — the skill tells the agent which file is relevant for the current task.

## Which skill applies?

After install, your agent picks based on what you're building. Quick guide:

| You're building | Load these skills |
|---|---|
| Backend / Node app (no React) using `@sodax/sdk` | `sodax-sdk-integration` (always) + `sodax-wallet-sdk-core-integration` (if signing) |
| React dapp using `@sodax/dapp-kit` | `sodax-dapp-kit-integration` + `sodax-wallet-sdk-react-integration` (always) + `sodax-sdk-integration` (for any unwrapped operations) |
| React app calling the SDK directly (no `dapp-kit`) | `sodax-sdk-integration` + `sodax-wallet-sdk-react-integration` |
| **Porting v1 code** | Add the corresponding `*-migration` skill alongside each `*-integration` you'd use. |

`AGENTS.md` says the same thing in router form — your agent reads it first and picks.

## Why this exists

LLM training data drifts: snippets from chat often use stale method names, reshaped types, or outdated error codes. Public docs help humans, not agents — an agent only reads what's in its context window. This package ships the right material in agent-native form so the agent reads it before generating code. The content is version-locked to the SDK — upgrade `@sodax/skills`, the docs upgrade with it.

## Feedback

If your agent generates wrong code despite reading the docs, that's a doc bug — please open an issue on the [Sodax SDKs repo](https://github.com/icon-project/sodax-sdks/issues) with the prompt and the incorrect output. The `knowledge/` tree is structurally CI-guarded (frontmatter, link resolution); prose claims benefit from real-world feedback.
