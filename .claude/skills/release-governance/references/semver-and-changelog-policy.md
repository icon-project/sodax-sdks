# SemVer & changelog policy

Policy and worked examples for the `release-governance` skill. The published `@sodax/*` packages are
a **fixed** group in `.changeset/config.json` — treat that file as the source of truth for which
packages are in the group, not any count written here.

## Fixed-group semantics

- A bump on any group member bumps **all** members to the **same** version. This mirrors the umbrella
  `@sdks@x.y.z` release model.
- The release's version is the **max** bump across all accumulated changesets (one `major` makes the
  whole release a major). You pick the bump *type* in the changeset; you never pick a per-package
  number — `pnpm version:packages` derives it.
- `@sodax/sdk` re-exports the entire `@sodax/types` surface (last line of `packages/sdk/src/index.ts`),
  so a change to the `@sodax/types` public surface **is** a change to the `@sodax/sdk` surface — grade
  it accordingly.
- Attribute a changeset to the package(s) that **actually changed**. The fixed group carries the
  others along at the same version; do not write changelog entries for packages that only rode along.

## SemVer policy (what each bump means for a consumer)

| Bump | Use when | Examples |
| --- | --- | --- |
| `patch` | No public-surface change; consumer needs no action. | Bug fix in existing behavior, internal refactor, perf, dependency-range rewrite, types-only fix that doesn't change signatures. |
| `minor` | Additive and backward-compatible. Old code keeps compiling and behaving. | New exported function/type/const, a new **optional** parameter or object field, a new supported token/chain/feature exposed through existing APIs. |
| `major` | A consumer may have to change code or expectations. | Removed/renamed export, changed function signature (new **required** param, reordered args), narrowed input or broken output type, changed return or `Result`/`SodaxError` shape, changed default behavior, removed/renamed chain key or token symbol. |

When unsure between two, pick the higher bump and say why in the review. A silent breaking change that
ships as `minor` is the worst outcome.

## Breaking-change signals (AI reads the diff; gates back it up)

No tool snapshots the public type surface (`.d.ts` are generated and gitignored; barrels are
`export *`). So read the diff for these signals, then confirm against the deterministic gates.

| Signal in the diff | Grade | Deterministic backstop |
| --- | --- | --- |
| Exported symbol removed or renamed from any `src/**/index.ts` barrel (or from `@sodax/types`, which `@sodax/sdk` re-exports) | major | `pnpm check:ai` (`check:ai-imports` fails if a **documented** symbol vanished); `apps/node-cjs` smoke fails if one of its imported symbols vanished |
| New **required** parameter, or a parameter/field made required | major | `pnpm checkTs` (in-repo callers break); consumers are not in-repo, so reason about them manually |
| Return type or `Result<T>` / `SodaxError` discriminant shape changed | major | `pnpm checkTs`; read the affected feature-service tests |
| Export-map / dual ESM+CJS resolution broke for a subpath | major (unusable install) | `pnpm check-exports` (attw) |
| New export added, existing ones unchanged | minor | `pnpm check:knip` (flags it if it ends up unused/unwired) |
| Only tests, docs, comments, or build config changed | patch or no changeset | — |

The gap the AI must cover by reading: **additions and signature-level narrowing that still typecheck
in-repo** — attw, knip, and checkTs will not flag a change that only hurts external consumers.

## Changelog voice & format

Write for a consumer reading `CHANGELOG.md`, not for a git log.

- **Imperative, present tense**, lead with the verb: "Add", "Fix", "Remove", "Rename".
- Say **what changed and why it matters to the caller**, not the internal mechanism.
- Name the public symbol(s) affected in backticks. One change per changeset where practical.
- No issue/PR numbers, no author handles, no "as discussed" — `@changesets/changelog-github` appends
  PR/author links automatically at version time.

**Migration note (required for every `major`)** — a `Migration` block with before → after (note the
four-backtick outer fence so the inner code block survives):

````md
---
"@sodax/sdk": major
---

Rename `Sodax.getQuote()` to `Sodax.quote()` for naming consistency across services.

**Migration:**

```ts
// before
const q = await sodax.getQuote(params);
// after
const q = await sodax.quote(params);
```
````

## Worked examples (input → changeset)

### Good vs bad (a bug fix)

- Diff: `SwapService` corrects slippage rounding so quotes stop rejecting at the boundary.
- ❌ Bad: `"@sodax/sdk": patch` — "fix swap stuff" — vague, no consumer signal.
- ✅ Good:
  ```md
  ---
  "@sodax/sdk": patch
  ---

  Fix `SwapService` slippage rounding that could reject quotes at the exact slippage boundary.
  ```

### Minor (additive)

- Diff: a new optional `deadline` field on an existing swap params type, plus a new exported helper.
  ```md
  ---
  "@sodax/sdk": minor
  ---

  Add an optional `deadline` to swap params and export `isDeadlineExpired(...)`. Existing callers are unaffected.
  ```

### Major (removal + migration)

- Diff: an exported error class is renamed.

````md
---
"@sodax/sdk": major
---

Rename `SwapError` to `SwapFailedError` to align with the `*FailedError` convention.

**Migration:**

```ts
// before
catch (e) { if (e instanceof SwapError) … }
// after
catch (e) { if (e instanceof SwapFailedError) … }
```
````

### No changeset (nothing ships to consumers)

- Diff: only `packages/sdk/README.md` and a test file changed → **no changeset**. If the PR still trips
  `changeset-check.yml` because a file under a published package changed, apply the `no-changeset`
  label rather than authoring a hollow entry. Config/CI/app-only changes never need one.
