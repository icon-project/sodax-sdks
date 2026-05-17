# AI Rules — Fresh Integration

You are integrating `@sodax/wallet-sdk-core` into a user's project for the first time. Follow this protocol exactly.

---

## Workflow (do these in order)

### 1. Survey the project

Before changing anything, gather context:

```bash
# Runtime — Node script? React dApp? Edge runtime?
cat <user>/package.json | grep -E '"type|"main|"module'

# Node version — must be >= 18
cat <user>/.nvmrc 2>/dev/null
node --version

# Is the user already using @sodax/wallet-sdk-react?
cat <user>/package.json | grep '"@sodax/wallet-sdk-react'

# Are upstream chain SDKs already direct deps? (may indicate they don't yet know about library-exports)
cat <user>/package.json | grep -E '"viem"|"@solana/web3.js"|"@mysten/sui"|"@stellar/stellar-sdk"|"@stacks/transactions"|"@injectivelabs"|"near-api-js"|"bitcoinjs-lib"|"icon-sdk-js"'
```

**If Node < 20.12**, stop and tell the user — this package requires Node ≥ 20.12.

**If the user is already using `@sodax/wallet-sdk-react` in the same project**, ask whether they really need to construct providers directly. In a React app the answer is usually **no**: `useWalletProvider({ xChainId })` returns the typed provider for them. Direct construction is only correct for scripts, tests, or non-React clients.

### 2. Pick the right mode

For **each** chain the user wants to integrate, decide between:

| Mode | When to pick | Stop and ask if... |
|---|---|---|
| **Private-key** | A Node script, CI runner, indexer, or test that legitimately possesses a raw key. | The user pastes a real-looking key in a frontend file. Never embed a private key in a browser bundle. |
| **Browser-extension** | A dApp where a wallet extension (MetaMask, Phantom, Xverse, Hana, Freighter, Leather, …) provides the signing primitives. | The user has neither a key nor a wallet adapter on hand. They probably want `@sodax/wallet-sdk-react` instead. |

Ask the user which mode applies **before** writing code. Default to **private-key** for `apps/node`-style scripts and **browser-extension** for `apps/web`-style dApps.

### 3. Apply the matching recipe

- Private-key flow → [`recipes/setup-private-key.md`](./recipes/setup-private-key.md).
- Browser-extension flow → [`recipes/setup-browser-extension.md`](./recipes/setup-browser-extension.md).

Each recipe is self-contained — install snippet, config, first method call, verification.

### 4. Hand off to `@sodax/sdk` if needed

If the user wants to swap / bridge / stake / lend / migrate, they need to pass the provider to `@sodax/sdk` calls. Apply [`recipes/bridge-to-sdk.md`](./recipes/bridge-to-sdk.md). Do not invent your own bridging pattern.

### 5. Add advanced features as separate steps

Only after the basic flow works should you add:

- Default config slices ([`recipes/defaults-and-overrides.md`](./recipes/defaults-and-overrides.md))
- Importing upstream chain types via `library-exports` ([`recipes/library-exports.md`](./recipes/library-exports.md))
- Sign + broadcast flow for the chain ([`recipes/sign-and-broadcast.md`](./recipes/sign-and-broadcast.md))
- Mocking providers in tests ([`recipes/testing.md`](./recipes/testing.md))

Each is independent — apply only what the user asked for.

---

## DO

- **DO** use the discriminated union types in your `import` statement so TypeScript narrows the config correctly:
  ```ts
  import { EvmWalletProvider, type EvmWalletConfig } from '@sodax/wallet-sdk-core';
  ```
- **DO** use chain key constants from `@sodax/types` (`ChainKeys.SONIC_MAINNET`, `ChainKeys.BSC_MAINNET`, …) instead of magic numbers / strings.
- **DO** re-export upstream chain types via `library-exports` (`import type { WalletClient } from '@sodax/wallet-sdk-core'`) — keeps direct chain-SDK deps out of `package.json`.
- **DO** pass an `IXxxWalletProvider` (the **interface** from `@sodax/types`), not the concrete class, to SDK calls. Interfaces are how the SDK stays decoupled from this package.
- **DO** put RPC URLs, network selectors, default gas, etc. in the `defaults` config slice — one place, one source of truth.
- **DO** consult [`features/<chain>.md`](./features/) for the chain you are integrating before writing the constructor call. Each chain has slightly different field names.

---

## DO NOT

- **DO NOT** embed a private key in a frontend bundle. Browser-extension config exists for a reason.
- **DO NOT** import from `@sodax/wallet-sdk-core/src/...` deep paths. Only the package root is public.
- **DO NOT** deep-import the internal `shallowMerge` from `src/utils/merge.ts`. It is intentionally not exported.
- **DO NOT** extend `BaseWalletProvider` in user code unless you are adding a brand-new chain to this package. That is a maintainer-only path.
- **DO NOT** widen the discriminated union with a cast (e.g. `as EvmWalletConfig`). If TypeScript complains, your fields are wrong — fix the fields.
- **DO NOT** mutate `defaults` after construction. Providers freeze the `defaults` reference; later mutations are silently ignored.
- **DO NOT** mix discriminant styles for a chain. Bitcoin and Stellar **require** an uppercase `type: 'PRIVATE_KEY' | 'BROWSER_EXTENSION'`; every other chain uses **field presence**. See [`architecture.md`](./architecture.md) § "Discriminant variants".

---

## Stop conditions (defer to user)

| Signal | Why stop |
|---|---|
| User asks for a chain family not in [chain support](./reference/chain-support.md) | Adding a new chain is a maintainer task, not user-app integration. |
| User wants to extend `BaseWalletProvider` directly | Maintainer-only path. Confirm scope first. |
| User wants to deep-merge `defaults` with per-call options | Not supported — merge is **shallow** by design. See [`recipes/defaults-and-overrides.md`](./recipes/defaults-and-overrides.md). If the user really needs deep merge, they must combine before passing. |
| User wants to inject a custom `Transport` / `Connection` / `SuiClient` in private-key mode | Some chains expose this via `defaults`; others don't. Check the chain's [feature file](./features/) first. |
| User wants to use a wallet brand the chain SDK does not support | Out of scope — wallet brand support lives in the upstream chain SDK / kit. |
| User is in a React app and wants to construct providers in components | Almost always wrong. Direct user to `@sodax/wallet-sdk-react`'s `useWalletProvider` hook. |
| User asks "how do I sign with X without a key and without an extension" | They probably want a custom signer — this package does not currently model that. Flag as out of scope. |

When stopping, **quote the file/line** of the offending code and present the user with concrete options.

---

## Verification protocol (after every recipe)

```bash
# 1. Type check passes
pnpm checkTs

# 2. No deep imports
grep -rn "@sodax/wallet-sdk-core/" <user-src> | grep -v "from '@sodax/wallet-sdk-core'"
# expect empty — only barrel imports allowed

# 3. No direct upstream chain-SDK imports for types that library-exports provides
grep -rn "from 'viem'" <user-src> | grep -E "WalletClient|PublicClient|TransactionReceipt"
# if any match, suggest re-importing via @sodax/wallet-sdk-core

# 4. Sample call works
# (manual — run a one-shot sign + broadcast on testnet)
```

If steps 1–3 pass and the user confirms step 4, the recipe is done.

---

## Done criteria

The integration is complete when:

- [ ] `pnpm checkTs` exits clean.
- [ ] The user has at least one provider instance constructed via the correct discriminated union variant.
- [ ] Types are imported from `@sodax/wallet-sdk-core` (and `@sodax/types`) only — no deep paths.
- [ ] If using `@sodax/sdk`: the provider is passed via the `IXxxWalletProvider` interface, not the concrete class.
- [ ] A sign + broadcast (or get-address) call has succeeded against testnet or a local mock.

Do not declare integration done before all of the above are true.
