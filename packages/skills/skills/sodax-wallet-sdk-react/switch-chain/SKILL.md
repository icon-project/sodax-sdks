---
name: sodax-wallet-sdk-react-switch-chain
description: 'Granular skill for the @sodax/wallet-sdk-react v2 EVM chain-switching surface only — useEvmSwitchChain, which compares the connected EVM network to a target xChainId and exposes wrong-network state + a switch handler (also covers the Injective + MetaMask auto-switch to Ethereum). Use when a React dapp needs to detect a wallet on the wrong EVM network and prompt a switch before a signed action — e.g. "useEvmSwitchChain", "wrong network banner", "switch EVM chain before swap", "isWrongChain". Covers BOTH integration (write new v2 code) and migration (port v1 — note there is no top-level useEthereumChainId in v2). Picks via Step 1. Links into the parent sodax-wallet-sdk-react knowledge tree. EVM-only — non-EVM chains have no switch concept here.'
---

# Switch chain (`wallet-sdk-react` granular skill)

Granular skill for `useEvmSwitchChain` — EVM wrong-network detection + switching. EVM-only. Source-of-truth reference lives in the parent broad skill's knowledge tree; this file is the focused workflow only.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?** New → § Integration. Port v1 → § Migration.
2. **Target chain is EVM?** This hook only covers EVM networks (and the Injective + MetaMask Ethereum-mainnet auto-switch). Non-EVM chains have no switch concept.
3. **Gate a signed action?** Typical flow: `const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId })`; block the action and show a switch CTA while `isWrongChain`.

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../integration/knowledge/recipes/setup.md`](../integration/knowledge/recipes/setup.md) — prerequisite: provider mounted with the `EVM` slot.
3. [`../integration/knowledge/recipes/switch-chain.md`](../integration/knowledge/recipes/switch-chain.md) — the full wrong-network → switch pattern.
4. Lookups → [`../integration/knowledge/reference/hooks.md`](../integration/knowledge/reference/hooks.md) (EVM-specific section).

### Switch-chain-specific anti-patterns

- **Reaching for a top-level `useEthereumChainId`.** It doesn't exist in v2 — read the raw EVM chain id via wagmi's `useAccount().chainId`; the wrong-network UX is folded into `useEvmSwitchChain`.
- **Expecting it to switch non-EVM chains.** EVM-only. It also handles the Injective + MetaMask case (auto-switch to Ethereum mainnet).
- **Ignoring the no-op return when `EVM` is absent.** With no `EVM` slot in `walletConfig` it returns `{ isWrongChain: false, handleSwitchChain: () => {} }` — safe to call, but it won't do anything.
- **Calling `handleSwitchChain` unconditionally.** Gate it on `isWrongChain`.

## Migration workflow (port v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../migration-v1-to-v2/knowledge/breaking-changes.md`](../migration-v1-to-v2/knowledge/breaking-changes.md) — single-object hook params; the removed top-level `useEthereumChainId`.
3. Symbol lookups → [`../migration-v1-to-v2/knowledge/reference/hooks.md`](../migration-v1-to-v2/knowledge/reference/hooks.md).

## Verification

1. `pnpm tsc --noEmit` exits clean.
2. `handleSwitchChain` is only invoked when `isWrongChain` is true.
3. No reference to a top-level `useEthereumChainId` (migration only).

## Related skills (same family)

- [`../bridge-to-sdk/SKILL.md`](../bridge-to-sdk/SKILL.md) — switch the chain, then pass the provider into the SDK call.
- [`../connect/SKILL.md`](../connect/SKILL.md) — connect the EVM wallet first.

For multi-feature work, load the broad [`sodax-wallet-sdk-react` skill](../SKILL.md).
