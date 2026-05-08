# AI Rules — v1 → v2 Migration

You are migrating a user's app from v1 to v2 of `@sodax/wallet-sdk-react`. The package name did not change — detect v1 by import surface (`useXWagmiStore`, positional hook args, `rpcConfig`/`options`/`initialState` props on `SodaxWalletProvider`, concrete chain class imports from the barrel). Follow this protocol exactly.

---

## Workflow (do these in order)

### 1. Survey

Before changing anything, survey the user's project:

```bash
# v1 store usage
grep -rn "useXWagmiStore" <user-src>

# v1 provider props (rpcConfig / options / initialState)
grep -rn "SodaxWalletProvider" <user-src> -A 5 | grep -E "rpcConfig|initialState|options="

# v1 positional hook args (e.g. useXAccount('EVM'))
grep -rnE "useXAccount\(['\"]" <user-src>
grep -rnE "useXConnectors\(['\"]" <user-src>
grep -rnE "useXConnection\(['\"]" <user-src>
grep -rnE "useXService\(['\"]" <user-src>
grep -rnE "useWalletProvider\(['\"]" <user-src>

# v1 concrete chain class imports from the barrel
grep -rnE "from '@sodax/wallet-sdk-react'" <user-src> | grep -E "XService|XConnector"
```

Build a list of every file that uses a v1 pattern. Show this list to the user before proceeding.

### 2. Bump the package version

Update `@sodax/wallet-sdk-react` to the latest v2 release in the user's `package.json`. Run install. **Do not edit any source files yet** — keep TypeScript broken so you can use compiler errors as a worklist.

### 3. Migrate the provider first

Always migrate `SodaxWalletProvider` (or v1's `XWagmiProviders`) before touching consumer files. The config shape is the biggest change — see [`reference/config.md`](./reference/config.md) and [`recipes/`](./recipes/) for the new pattern. Without a working provider, hooks will fail at runtime even if types pass.

### 4. Run typecheck, use errors as worklist

```bash
pnpm checkTs
```

For each error mentioning `@sodax/wallet-sdk-react` or a v1 hook name:

1. Look up the symbol in [`reference/imports.md`](./reference/imports.md), [`reference/hooks.md`](./reference/hooks.md), [`reference/config.md`](./reference/config.md), or [`reference/components.md`](./reference/components.md).
2. If found, apply the mechanical replacement.
3. If not found, **stop and ask the user**. Do not invent a migration.

### 5. Apply recipes for non-mechanical changes

Some patterns require structural rewrites, not just symbol swaps. Use the matching recipe file:

- Connect button → [`recipes/connect-button.md`](./recipes/connect-button.md)
- Multi-chain modal → [`recipes/multi-chain-modal.md`](./recipes/multi-chain-modal.md)
- Next.js SSR setup → [`recipes/ssr-setup.md`](./recipes/ssr-setup.md)
- WalletConnect → [`recipes/walletconnect-migration.md`](./recipes/walletconnect-migration.md)

### 6. Verify with the checklist

Loop through every item in [`checklist.md`](./checklist.md). Each item is machine-checkable (most are `grep` commands). Do not skip items. Report results back to the user.

---

## DO

- **DO** read `migration/breaking-changes.md` once at the start to understand the WHY behind changes. This helps you handle ambiguous user code.
- **DO** preserve user comments, formatting, and unrelated code. Only touch what the migration requires.
- **DO** update one file at a time, then re-run `pnpm checkTs` to confirm progress.
- **DO** prefer the official `recipes/` over inventing your own structural rewrite.
- **DO** treat `reference/*.md` as the only source of truth for symbol mappings. If a mapping is missing, it's a docs gap — flag it.
- **DO** explicitly check whether the user's project is Next.js (App Router or Pages) before touching providers — SSR config differs.

---

## DO NOT

- **DO NOT** delete v1 imports until the corresponding v2 imports are added and the file typechecks.
- **DO NOT** rename user files, even if v1 file names look outdated. Keep file paths stable so the user's git history stays clean.
- **DO NOT** modify tests until source migration is complete — wait for green typecheck first, then update tests as a separate pass.
- **DO NOT** "improve" surrounding code (refactor, restyle, add error handling, change variable names). Only apply migration changes.
- **DO NOT** assume v1 prop shapes from memory — always verify against [`reference/config.md`](./reference/config.md). v1 had several optional fields whose defaults differ from v2.
- **DO NOT** silently drop user features. If v1 used `XWagmiProviders` with `initialState` and v2 has no equivalent, **stop and ask** how to preserve that state initialization.
- **DO NOT** change the persisted localStorage key (`xwagmi-store`). User connections will be lost across the migration boundary if you do.

---

## Stop conditions (defer to user)

Stop and ask the user before continuing if you encounter any of the following. These cannot be migrated mechanically:

| Signal | Why stop |
|---|---|
| Custom `XConnector` subclass in user code | v1 and v2 have different abstract method signatures. User must port manually. |
| Custom `XService` subclass in user code | Same as above. |
| User reads from `useXWagmiStore` with a selector touching `setXConnection`, `unsetXConnection`, or any v2-internal field (`enabledChains`, `walletProviders`, `chainActions`, …) | These are not part of the v2 public API. Agent must replace direct store reads with public hooks (`useXServices`, `useXConnections`, etc. — see [`reference/imports.md`](./reference/imports.md) § "Store hook removed"). For mutations the user must adopt `useXConnect` / `useXDisconnect` — confirm before substituting. |
| User passes `rpcConfig`, `options`, or `initialState` to the v1 provider | These are removed in v2. Migration target is the new `config` object. Verify what behavior the user wants preserved. |
| Test files that mock `XService` or `XConnector` | Mock surface differs. Tests must be updated by hand with the user's intent in mind. |
| `apps/wallet-modal-example` is referenced | This is internal SODAX scaffolding, not for end users. |
| User explicitly says "don't change behavior X" | Some v2 changes are intentional behavior shifts (e.g. EVM = single connection across all networks). Confirm before forcing v1 behavior back. |

When stopping, **quote the file/line** of the offending code and present the user with concrete options.

---

## Verification protocol (after every change)

```bash
# 1. Type check
pnpm checkTs

# 2. Verify no v1 patterns remain
grep -rn "useXWagmiStore\|useXWalletStore" <user-src>         # expect empty (v2 barrel doesn't export the store hook under either name — all call sites must use public hooks)
grep -rnE "SodaxWalletProvider[^>]*\b(rpcConfig|initialState|options)\s*=" <user-src>  # expect empty
grep -rnE "useXAccount\(['\"]" <user-src>                     # expect empty
grep -rnE "useXConnectors\(['\"]" <user-src>                  # expect empty
grep -rnE "useXConnection\(['\"]" <user-src>                  # expect empty

# 3. Verify v2 provider is mounted with config prop
grep -rnE "SodaxWalletProvider[^>]*\bconfig\s*=" <user-src>   # expect at least one match in app entry

# 4. Verify QueryClientProvider wraps SodaxWalletProvider (v2 no longer mounts QueryClient internally)
# (manual — open the provider file, confirm <QueryClientProvider> wraps <SodaxWalletProvider>)
```

If all four pass and the [`checklist.md`](./checklist.md) is complete, the migration is done.

---

## Done criteria

The migration is complete when:

- [ ] `pnpm checkTs` exits clean.
- [ ] No `useXWagmiStore` or `useXWalletStore` imports remain (v2 does not export the store hook — every call site must use public hooks like `useXServices` / `useXConnections`).
- [ ] No positional hook args remain (`useXAccount('EVM')` etc).
- [ ] `SodaxWalletProvider` is mounted with a v2-shaped `config` prop, wrapped by `QueryClientProvider`.
- [ ] All items in [`checklist.md`](./checklist.md) are checked.
- [ ] The user has confirmed the connect/disconnect flow works in their dev environment.

Do not declare the migration done before all six are true.
