# AI Rules — Migration

You are upgrading a user's app from **v1** of `@sodax/wallet-sdk-core` (the legacy `sodax-frontend` codebase) to **v2** (current). The package name did not change. The default expectation is **v1 code drops in unchanged** — there are no mandatory edits at the wallet-sdk-core surface. Follow this protocol exactly.

---

## Workflow (do these in order)

### 1. Survey

Before changing anything, survey the user's project:

```bash
# 1a. Find every wallet-sdk-core import site
grep -rn "from '@sodax/wallet-sdk-core'" <user-src>

# 1b. Find every provider construction site
grep -rnE "new [A-Z][a-zA-Z0-9]*WalletProvider\(" <user-src>

# 1c. Deep imports from src/... — were never supported, now broken
grep -rn "@sodax/wallet-sdk-core/" <user-src> | grep -v "from '@sodax/wallet-sdk-core'"

# 1d. Direct upstream-SDK type imports that library-exports could replace (optional cleanup)
grep -rn "from 'viem'" <user-src> | grep -E "WalletClient|PublicClient|TransactionReceipt|SendTransactionParameters|WaitForTransactionReceiptParameters"
grep -rn "from '@stellar/stellar-sdk'" <user-src> | grep "Networks"
grep -rn "from '@stacks/transactions'" <user-src> | grep -E "PostConditionMode|ClarityValue|PostConditionModeName"
grep -rn "from '@mysten/wallet-standard'" <user-src>
grep -rn "from '@solana/web3.js'" <user-src> | grep -E "Commitment|ConnectionConfig|SendOptions"

# 1e. Hand-rolled wrappers around providers (potential candidates for `defaults` adoption)
grep -rnE "function\s+(make|build|with)[A-Z][a-zA-Z0-9]*Provider" <user-src>
```

Build a list of every file under each category. Show this list to the user before proceeding.

### 2. Bump the package version

Update `@sodax/wallet-sdk-core` to the v2 target in the user's `package.json`. Run install.

### 3. Type-check the project

```bash
pnpm checkTs
```

**Expected outcome: zero errors mentioning `@sodax/wallet-sdk-core` symbols.** v1 code is backwards-compatible with v2.

If errors **do** appear, narrow them:

```bash
pnpm exec tsc --noEmit 2>&1 | grep -iE "from '@sodax/wallet-sdk-core'|@sodax/wallet-sdk-core/"
```

For each error:

- **Deep import from `src/...`?** → Replace with barrel import (`from '@sodax/wallet-sdk-core'`). The v2 source layout uses `wallet-providers/<chain>/` folders; old flat paths no longer resolve.
- **Symbol not found on barrel?** → Look up in [`../integration/reference/public-api.md`](../integration/reference/public-api.md). If genuinely missing, **stop and ask the user** — this is a docs gap or a regression.
- **Anything else?** → Stop and ask. Do not guess.

### 4. Optional cleanup (only if user requests)

After v3 confirms a green typecheck, the upgrade is **done**. Everything below is optional:

- **Adopt `defaults`** — apply [`recipes/adopt-defaults.md`](./recipes/adopt-defaults.md) only if the user has hand-rolled `make*Provider` / `with*Defaults` wrappers that inject options on every call.
- **Adopt `library-exports`** — apply [`recipes/adopt-library-exports.md`](./recipes/adopt-library-exports.md) only if the user imports types from upstream chain SDKs and wants to drop those direct deps.

Each is independent. Apply only what the user asked for.

### 5. Verify with the checklist

Loop through every item in [`checklist.md`](./checklist.md). Most items are `grep` commands. Do not skip items. Report results back to the user.

---

## DO

- **DO** read [`breaking-changes/README.md`](./breaking-changes/README.md) once to internalise that v1→v2 is **additive-only**. There is no rename / removal / required-field addition.
- **DO** start with `pnpm checkTs`. If it passes with zero wallet-sdk-core errors, the upgrade is done.
- **DO** preserve user comments, formatting, and unrelated code.
- **DO** treat optional cleanups as **opt-in**, never automatic.
- **DO** prefer the official `recipes/` over inventing your own structural rewrite.

---

## DO NOT

- **DO NOT** invent breaking changes. If you find yourself rewriting a `*WalletConfig` shape, stop — v1 and v2 shapes are identical. The change is somewhere else (likely `@sodax/sdk` or `@sodax/types`).
- **DO NOT** rewrite all upstream-SDK imports unprompted. `library-exports` adoption is an optimisation, not a requirement.
- **DO NOT** rename `PrivateKey<Chain>WalletConfig` → anything else. v1 already used the same names.
- **DO NOT** rewrite Injective constructions from `{ privateKey }` to `{ secret: { privateKey } }`. v1 already used the `{ secret: { privateKey | mnemonics } }` shape.
- **DO NOT** "improve" surrounding code (refactor, restyle, add error handling, change variable names).
- **DO NOT** add `defaults` to existing constructions unless the user explicitly asked for it.

---

## Stop conditions (defer to user)

| Signal | Why stop |
|---|---|
| Any deep import from `@sodax/wallet-sdk-core/src/...` | Never supported. Replace with barrel import; if the symbol is not on the barrel, it is intentionally internal — ask the user what they were doing. |
| `pnpm checkTs` reports a `@sodax/wallet-sdk-core` symbol that does not exist | Confirm against [`../integration/reference/public-api.md`](../integration/reference/public-api.md). If missing, this is a regression — file an issue. Do not guess a replacement. |
| User extends `BaseWalletProvider` directly in their code | This class is new in v2 and not intended for consumer subclassing. Confirm scope — maintainer path only. |
| User imports `shallowMerge` or anything from `@sodax/wallet-sdk-core/utils/...` | Internal in both v1 and v2 (utils didn't even exist in v1). Replace with the `defaults` config or pass merged options at the call site. |
| `as unknown as` casts around provider construction | Likely a workaround for a previous-RC bug. Investigate — usually safe to remove now. |

When stopping, **quote the file/line** of the offending code and present the user with concrete options.

---

## Verification protocol (after every change)

```bash
# 1. Type check
pnpm checkTs

# 2. No deep imports from src/
grep -rn "@sodax/wallet-sdk-core/" <user-src> | grep -v "from '@sodax/wallet-sdk-core'"
# expect empty

# 3. No imports of internal utilities
grep -rn "shallowMerge" <user-src>
# expect empty
```

If all three pass and the [`checklist.md`](./checklist.md) is complete, the migration is done.

---

## Done criteria

The migration is complete when:

- [ ] `pnpm checkTs` exits clean.
- [ ] No deep imports from `@sodax/wallet-sdk-core/src/...`.
- [ ] No imports of internal utilities (`shallowMerge`).
- [ ] All items in [`checklist.md`](./checklist.md) are checked.
- [ ] The user has confirmed at least one signing flow still works in their dev / test environment.

Do not declare the migration done before all five are true.
