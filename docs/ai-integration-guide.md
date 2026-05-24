# Use Sodax SDKs with your AI coding agent

SODAX ships agent-native documentation as [`@sodax/skills`](https://github.com/icon-project/sodax-sdks/tree/main/packages/skills) — eight skills plus a knowledge tree for the `@sodax/*` SDKs. The goal is v2-correct code on the first try instead of stale training-data APIs.

LLM training data drifts; public docs at [docs.sodax.com](https://docs.sodax.com) are for humans. Agents only use what you install or attach. For what’s in the bundle (skills, knowledge layout, routing table), see [packages/skills/README.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/README.md).

## Pick a setup

| You are… | Do this | Entry point |
|---|---|---|
| Using Claude Code, Cursor, Copilot, Codex, etc. with the [skills CLI](https://github.com/vercel-labs/skills) | `npx skills@latest add icon-project/sodax-sdks/packages/skills` | Where the CLI installs (e.g. `.cursor/skills/.../AGENTS.md`) — path varies by agent |
| Any project; npm from the registry | `pnpm add -D @sodax/skills` | `node_modules/@sodax/skills/AGENTS.md` |
| Unreleased docs; app lives **inside** the sodax-sdks pnpm workspace | `pnpm add -D @sodax/skills@workspace:*` | `node_modules/@sodax/skills/AGENTS.md` |
| Unreleased docs; sodax-sdks is a **sibling repo, submodule, or separate clone** | `pnpm add -D @sodax/skills@file:../sodax-sdks/packages/skills` (not `workspace:*`) | `node_modules/@sodax/skills/AGENTS.md` |
| Sodax-sdks clone on disk, no install | Point your agent rules at the checkout | `/path/to/sodax-sdks/packages/skills/AGENTS.md` |
| Web chat (ChatGPT, Claude.ai, etc.) | Attach files to the conversation | `AGENTS.md` + one relevant `skills/.../SKILL.md` |

**Canonical entry point:** [`AGENTS.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/AGENTS.md) — tool-neutral router (shipped on npm). [`CLAUDE.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/CLAUDE.md) in `packages/skills/` is optional and **git-only** (not in the npm package); use it when you maintain sodax-sdks or want maintainer layout context. You can also paste a one-line pointer into your own project `CLAUDE.md`.

## Install

### skills CLI (recommended for IDE agents)

From your consumer repo root:

```bash
npx skills@latest add icon-project/sodax-sdks/packages/skills
```

The CLI detects your tool and installs skills into the conventional directory (e.g. `.claude/skills/`, `.cursor/skills/`). **Upgrade (CLI only):** when you bump `@sodax/*` SDK packages, re-run the same `npx skills@latest add …` command — the CLI refreshes from GitHub; it does not follow a `@sodax/skills` entry in `package.json`.

Useful flags:

- `-a <agent>` — target a specific agent (e.g. `-a cursor`).
- `-g, --global` — install into your user-global agent directory instead of the project.

### npm from the registry

```bash
pnpm add -D @sodax/skills
# or: npm install --save-dev @sodax/skills
```

Published files: `skills/`, `knowledge/`, `AGENTS.md`, `.claude-plugin/`, `README.md` — not `CLAUDE.md`. Wire your agent to `node_modules/@sodax/skills/AGENTS.md` (see below). **Upgrade (npm / `file:` / `workspace:`):** `pnpm add -D @sodax/skills@<version>` to match your `@sodax/*` release (package is published on `@sodax/skills@*.*.*` git tags).

### Local / monorepo

`@workspace:*` only resolves when your app is a package **in the same pnpm workspace** as `packages/skills` (i.e. your `package.json` is listed in sodax-sdks’s `pnpm-workspace.yaml`). If sodax-sdks is a sibling directory, git submodule, or second clone, use `@file:…` instead — `workspace:*` will fail with “not found in workspace”.

```bash
# Your app is packages/my-dapp (or similar) inside the sodax-sdks repo
pnpm add -D @sodax/skills@workspace:*

# Your app is a separate repo; sodax-sdks checkout is next to it (adjust path)
pnpm add -D @sodax/skills@file:../sodax-sdks/packages/skills
```

Then use `node_modules/@sodax/skills/AGENTS.md` like the registry install.

### Path-only (no package install)

If you keep a sodax-sdks clone next to your app, reference `packages/skills/AGENTS.md` in rules or `@`-mentions. Prefer the skills CLI when your agent supports it so skills land in the native directory.

## Wire your agent

Paste this into project rules (adapt `<ENTRY_POINT>` to your install path):

```markdown
Before writing or changing Sodax (@sodax/*) code, read and follow:
`<ENTRY_POINT>/AGENTS.md`
Load only the skills it routes you to; follow each skill's workflow.
```

| Tool | How |
|---|---|
| **Claude Code** | Prefer the skills CLI; else add the block above to project `CLAUDE.md` with `node_modules/@sodax/skills/AGENTS.md` |
| **Cursor** | Prefer `npx skills@latest add ... -a cursor`; else `.cursor/rules` or project rules with the same pointer |
| **Codex / Copilot** | Rules file or repo `AGENTS.md` symlink/copy pointing at the installed bundle |
| **Web UIs** | Attach `AGENTS.md`; add one `SKILL.md` if the task is narrow (e.g. swap only) |

At runtime, your agent must read **`AGENTS.md` from your install path** (e.g. `node_modules/@sodax/skills/AGENTS.md`, or wherever the skills CLI installed it) — not the live `main` branch on GitHub. That file routes by intent; each skill links into `knowledge/` as needed. Don’t read knowledge top-to-bottom. **Web chat with no install:** attach `AGENTS.md` (and any needed `SKILL.md` files) from your checkout or a Git ref that matches your SDK version. **Browse only:** [router source on GitHub (`main`)](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/AGENTS.md).

## Prompt naturally

Once wired, describe the task in plain language.

> "Swap 100 USDC on Ethereum for SOL on Solana using `@sodax/sdk`."

For v1 → v2 ports, say something like “migrate my project to Sodax v2” — migration skills and `AGENTS.md` handle fingerprints and skill selection.

## Tips

- **Keep agent docs in sync when you upgrade `@sodax/*`** — docs should match the SDKs you ship. **skills CLI:** re-run `npx skills@latest add icon-project/sodax-sdks/packages/skills`. **npm / local package install:** bump `@sodax/skills` (e.g. `pnpm add -D @sodax/skills@1.2.3`). Using both CLI and npm is optional; if you use only the CLI, you do not need `@sodax/skills` in `package.json`.
- **Start from `AGENTS.md`**, not random files under `knowledge/`.
- **Don’t add `@sodax/types` as a separate dependency** — types are re-exported from `@sodax/sdk`.

## Further reading and feedback

- Bundle overview: [packages/skills/README.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/README.md)
- Router (agents): [packages/skills/AGENTS.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/AGENTS.md)

Wrong output despite the skills? That’s a doc bug — [open an issue](https://github.com/icon-project/sodax-sdks/issues) with the prompt and what the agent generated.
