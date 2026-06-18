---
name: sodax-wallet-sdk-react-walletconnect
description: 'Granular skill for the @sodax/wallet-sdk-react v2 WalletConnect / enterprise-custody setup only — the walletConnect field on the EVM slot of SodaxWalletConfig, which adds non-injected wallets (Fireblocks, Ledger, mobile-only) beyond the default EIP-6963 browser-extension discovery. Use when a React dapp needs enterprise custody or mobile wallets on EVM — e.g. "add WalletConnect", "Fireblocks wallet support", "Ledger via WalletConnect", "mobile wallet connect", "projectId for WalletConnect". Covers BOTH integration (write new v2 config) and migration (port v1 WalletConnect setup). Picks via Step 1. Links into the parent sodax-wallet-sdk-react knowledge tree. WalletConnect is EVM-slot-only; for the connect UI itself use the connect / wallet-modal skills.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# WalletConnect (`wallet-sdk-react` granular skill)

Granular skill for the `walletConnect` enterprise-custody setup on the `EVM` slot of `SodaxWalletConfig`. Source-of-truth reference lives in the parent broad skill's knowledge tree; this file is the focused workflow only.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?** New → § Integration. Port v1 → § Migration.
2. **Which wallets?** Default EVM discovery is **EIP-6963 (browser extensions only)**. WalletConnect is needed for Fireblocks / Ledger / mobile-only wallets.
3. **Have a WalletConnect `projectId`?** It's required — from WalletConnect Cloud.

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../integration/knowledge/recipes/setup.md`](../integration/knowledge/recipes/setup.md) — prerequisite: provider mounted with the `EVM` slot.
3. [`../integration/knowledge/recipes/walletconnect-setup.md`](../integration/knowledge/recipes/walletconnect-setup.md) — add `walletConnect: { projectId: '…' }` to the EVM slot.
4. Lookups → [`../integration/knowledge/reference/wallet-brands.md`](../integration/knowledge/reference/wallet-brands.md), [`hooks.md`](../integration/knowledge/reference/hooks.md).

### WalletConnect-specific anti-patterns

- **Expecting Fireblocks / Ledger / mobile to appear without WalletConnect.** Default EIP-6963 discovery surfaces browser extensions only — those need the `walletConnect` field.
- **Putting `walletConnect` on a non-EVM slot.** It's an **EVM-slot-only** field (`WalletConnectParameters`: `projectId`, `qrModalOptions`, …).
- **Omitting `projectId`.** Required — WalletConnect won't initialize without it.
- **Forgetting SSR timing.** On Next.js, the EVM slot's `ssr` flag governs wagmi hydration — see the migration `ssr-setup` recipe if you hit hydration mismatches.

## Migration workflow (port v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../migration-v1-to-v2/knowledge/breaking-changes.md`](../migration-v1-to-v2/knowledge/breaking-changes.md) — reshaped `SodaxWalletProvider` props (`config` object; chain-type slots are top-level).
3. [`../migration-v1-to-v2/knowledge/recipes/walletconnect-migration.md`](../migration-v1-to-v2/knowledge/recipes/walletconnect-migration.md) — move WalletConnect config onto the EVM slot. SSR setup → [`ssr-setup.md`](../migration-v1-to-v2/knowledge/recipes/ssr-setup.md).
4. Symbol lookups → [`../migration-v1-to-v2/knowledge/reference/config.md`](../migration-v1-to-v2/knowledge/reference/config.md).

## Verification

1. `pnpm tsc --noEmit` exits clean.
2. `walletConnect: { projectId }` sits on the `EVM` slot of `SodaxWalletConfig` (not elsewhere).
3. A non-injected wallet (mobile / Fireblocks / Ledger) appears in the connector list.

## Related skills (same family)

- [`../wallet-modal/SKILL.md`](../wallet-modal/SKILL.md) — surface the WalletConnect wallets in the multi-chain modal.
- [`../connect/SKILL.md`](../connect/SKILL.md) — the connect button / connector discovery hooks.

For multi-feature work, load the broad [`sodax-wallet-sdk-react` skill](../SKILL.md).
