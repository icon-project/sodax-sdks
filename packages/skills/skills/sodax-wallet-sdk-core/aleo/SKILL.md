---
name: sodax-wallet-sdk-core-aleo
description: 'Granular skill for the @sodax/wallet-sdk-core v2 Aleo wallet provider only — `AleoWalletProvider` (backed by the lazy-loaded @provablehq/sdk + @provablehq/aleo-wallet-standard adapter). Use when a backend / Node script / CI / bot / non-React browser flow needs to instantiate an Aleo provider directly and execute Aleo programs + wait for receipts — e.g. "instantiate AleoWalletProvider", "private-key Aleo signing in Node", "execute an Aleo program function", "executeAndWait", "delegated proving". Covers BOTH integration (write new v2 code) and migration (port v1 — additive at this surface). Picks via Step 1. Links into the parent sodax-wallet-sdk-core knowledge tree. For React dapps use the sodax-wallet-sdk-react skill instead (get the typed provider via useWalletProvider).'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Aleo (`wallet-sdk-core` granular skill)

Granular skill for `AleoWalletProvider` — the low-level Aleo wallet for backend / Node / non-React flows. Source-of-truth reference lives in the parent broad skill's knowledge tree; this file is the focused workflow only.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?** New → § Integration. Port v1 → § Migration (additive here — same class + config-type names).
2. **Private-key or browser-extension config?** Aleo discriminates by an **explicit `type` field** with **camelCase** values: PK = `{ type: 'privateKey', rpcUrl, privateKey, network }` (Node / CI / bots); browser-extension = `{ type: 'browserExtension', rpcUrl, provableAdapter }` (`network` optional, defaults `'mainnet'`). Mutually exclusive — pick one.
3. **`mainnet` or `testnet`?** Required on PK configs; selects which network-specific WASM build of `@provablehq/sdk` lazy-loads. Optional on browser-extension (defaults `'mainnet'`).
4. **Need confirmation?** `execute` fires-and-returns `{ transactionId }`; `executeAndWait` runs `execute` then `waitForTransactionReceipt` (defaults `checkInterval: 2000`, `timeout: 45000`).
5. **Delegated proving?** Private-key only — add `delegate: { apiKey, consumerId, url? }` to offload proving to a remote service.

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../integration/knowledge/architecture.md`](../integration/knowledge/architecture.md) — `BaseWalletProvider`, dual-config discriminants, shallow `defaults` merge, library-exports.
3. [`../integration/knowledge/features/aleo.md`](../integration/knowledge/features/aleo.md) — full config union, `AleoWalletDefaults`, `DelegateProvingConfig`, methods (`execute` / `executeAndWait` / `waitForTransactionReceipt`), gotchas.
4. Setup recipe → [`../integration/knowledge/recipes/setup-private-key.md`](../integration/knowledge/recipes/setup-private-key.md) or [`../integration/knowledge/recipes/setup-browser-extension.md`](../integration/knowledge/recipes/setup-browser-extension.md); then [`../integration/knowledge/recipes/sign-and-broadcast.md`](../integration/knowledge/recipes/sign-and-broadcast.md), [`../integration/knowledge/recipes/defaults-and-overrides.md`](../integration/knowledge/recipes/defaults-and-overrides.md).
5. Lookups → [`../integration/knowledge/reference/provider-classes.md`](../integration/knowledge/reference/provider-classes.md), [`interfaces.md`](../integration/knowledge/reference/interfaces.md), [`chain-support.md`](../integration/knowledge/reference/chain-support.md).

### Aleo-specific anti-patterns

- **Mixing PK + browser-extension fields.** Discriminated union on `type` — don't `as` across variants; narrow with `isPrivateKeyConfig` / `isBrowserExtensionConfig`.
- **Using uppercase discriminant values.** Aleo uses `'privateKey'` / `'browserExtension'` (camelCase) — *not* Bitcoin/Stellar's `'PRIVATE_KEY'` / `'BROWSER_EXTENSION'`.
- **Eagerly importing `@provablehq/sdk`.** The provider lazy-loads the network-specific WASM build on first method call — it ships a ~43 MB top-level-`await` module that breaks SSR / OOMs Next.js builds if imported at module scope. Let the provider load it.
- **Forgetting `network` on a PK config.** Required — it selects the WASM build. Browser-extension defaults to `'mainnet'`.
- **Expecting `execute` to confirm.** It returns once broadcast — use `executeAndWait` or follow with `waitForTransactionReceipt` when you need finality.
- **Putting `delegate` on a browser-extension config.** Delegated proving is private-key only; the extension proves locally.

## Migration workflow (port v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — headline: **v1 code drops in unchanged at this surface**.
2. Only mechanical change: deep-import → barrel ([`../migration-v1-to-v2/knowledge/breaking-changes/folder-layout.md`](../migration-v1-to-v2/knowledge/breaking-changes/folder-layout.md)). Optionally adopt `defaults` ([`defaults-config.md`](../migration-v1-to-v2/knowledge/breaking-changes/defaults-config.md)) / re-imported library types ([`library-exports.md`](../migration-v1-to-v2/knowledge/breaking-changes/library-exports.md)).
3. Compile errors on `@sodax/sdk` / `@sodax/types` symbols → not this migration; load the `sodax-sdk` skill (migration mode).

## Verification

1. `pnpm tsc --noEmit` exits clean.
2. Config uses exactly one discriminant variant (`type: 'privateKey'` or `type: 'browserExtension'`).
3. No v1 deep imports from `@sodax/wallet-sdk-core/wallet-providers/` (migration only).

## Related skills (same family)

Sibling chain skills follow the same shape — evm, solana, sui, bitcoin, stellar, icon, injective, near, stacks. For multi-chain or undecided work, load the broad [`sodax-wallet-sdk-core` skill](../SKILL.md).

## Passing the provider into the SDK (different package family)

This skill *builds* the provider. For the concrete handoff, see [`../integration/knowledge/recipes/bridge-to-sdk.md`](../integration/knowledge/recipes/bridge-to-sdk.md). To execute SODAX operations, **also load the `sodax-sdk` skill (integration mode)** and pass it as `{ raw: false, walletProvider }`. React dapps get the provider via `useWalletProvider(...)` — **load the `sodax-wallet-sdk-react` skill** instead.
