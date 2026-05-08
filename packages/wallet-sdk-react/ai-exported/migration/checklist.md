# Migration Checklist (Machine-Checkable)

Run these checks after every code change and at the end of the migration. Each item has a concrete `grep` / typecheck command. Loop through until all are checked.

---

## Provider migration

- [ ] `SodaxWalletProvider` is mounted exactly once in app source.
  ```bash
  grep -rn "SodaxWalletProvider" <user-src> --include="*.tsx" --include="*.ts" | grep -v "import" | wc -l
  # expect 1 (the JSX usage)
  ```

- [ ] `SodaxWalletProvider` uses the v2 `config` prop (no `rpcConfig` / `options` / `initialState`).
  ```bash
  grep -rnE "SodaxWalletProvider[^/>]*\b(rpcConfig|initialState|options)\s*=" <user-src>
  # expect empty
  ```

- [ ] `QueryClientProvider` wraps `SodaxWalletProvider`.
  ```bash
  # Manual — open the provider file and confirm:
  # <QueryClientProvider client={queryClient}>
  #   <SodaxWalletProvider config={walletConfig}>
  ```

- [ ] If app is Next.js, `EVM.ssr: true` is set in `walletConfig`.
  ```bash
  grep -rnE "EVM:\s*\{[^}]*\bssr:\s*true" <user-src>
  # expect at least one match if Next.js
  ```

---

## Store migration

- [ ] No `useXWagmiStore` imports remain (the v2 barrel removed the store hook entirely — every call site must be replaced with a public hook).
  ```bash
  grep -rn "useXWagmiStore" <user-src>
  # expect empty
  ```

- [ ] No `useXWalletStore` imports were introduced (v2 does not export the store hook under either name).
  ```bash
  grep -rn "useXWalletStore" <user-src>
  # expect empty
  ```

- [ ] Every former store read uses a public hook (`useXService` / `useXServices` / `useXConnection` / `useXConnections` / `useEnabledChains` / `useWalletProvider`). See [`reference/imports.md`](./reference/imports.md) § "Store hook removed" for the field-to-hook map.

---

## Hook signature migration

- [ ] No positional hook calls remain.
  ```bash
  # All of these must be empty:
  grep -rnE "useXAccount\(['\"]" <user-src>
  grep -rnE "useXConnectors\(['\"]" <user-src>
  grep -rnE "useXConnection\(['\"]" <user-src>
  grep -rnE "useXService\(['\"]" <user-src>
  grep -rnE "useWalletProvider\(['\"]" <user-src>
  ```

- [ ] All call sites pass `{ xChainType }` or `{ xChainId }`, never both.
  ```bash
  grep -rnE "useXAccount\(\{[^}]*xChainType[^}]*xChainId" <user-src>
  grep -rnE "useXAccount\(\{[^}]*xChainId[^}]*xChainType" <user-src>
  # expect empty
  ```

- [ ] No `useXDisconnect` callback called with positional ChainType (v2 takes `{ xChainType }` object).
  ```bash
  # The hook itself is identical in v1/v2; the BREAKING change is on the returned callback.
  # Look for callbacks invoked with a bare string instead of an options object.
  grep -rnE "disconnect\((['\"](EVM|SOLANA|SUI|BITCOIN|STELLAR|ICON|INJECTIVE|NEAR|STACKS)['\"])\)" <user-src>
  # expect empty — replace with `disconnect({ xChainType: 'EVM' })`
  ```

- [ ] No `useEvmSwitchChain` destructuring of `switchChain` (v2 returns `{ isWrongChain, handleSwitchChain }`).
  ```bash
  grep -rnE "useEvmSwitchChain\(\)" <user-src>
  # expect empty — v2 requires `{ xChainId }`
  grep -rnE "const \{[^}]*\bswitchChain\b[^}]*\} = useEvmSwitchChain" <user-src>
  # expect empty — switchChain is no longer destructurable from this hook
  ```

---

## Sub-path imports

- [ ] No concrete chain classes are imported from the package barrel.
  ```bash
  grep -rnE "from '@sodax/wallet-sdk-react'" <user-src> | grep -E "EvmXService|SolanaXService|SuiXService|BitcoinXService|StellarXService|InjectiveXService|IconXService|NearXService|StacksXService|EvmXConnector|SolanaXConnector|SuiXConnector|UnisatXConnector|XverseXConnector|OKXXConnector|StellarWalletsKitXConnector|InjectiveXConnector|IconHanaXConnector|NearXConnector|StacksXConnector"
  # expect empty (or only `import type` lines, which are still allowed for some types)
  ```

- [ ] Concrete classes use sub-path imports (`@sodax/wallet-sdk-react/xchains/<chain>`).
  ```bash
  grep -rnE "from '@sodax/wallet-sdk-react/xchains/" <user-src>
  # if user code needs concrete classes, expect matches here
  ```

---

## Removed APIs

- [ ] No `useXBalances` calls remain that import from `@sodax/wallet-sdk-react` (moved to `@sodax/dapp-kit` with a new signature).
  ```bash
  grep -rn "from '@sodax/wallet-sdk-react'" <user-src> | grep useXBalances
  # expect empty — v2 imports from '@sodax/dapp-kit', wraps args as `{ params: { xService, xChainId, xTokens, address } }`
  ```

- [ ] No `useEthereumChainId` imports remain (internal in v2).
  ```bash
  grep -rn "useEthereumChainId" <user-src>
  # expect empty — replace with wagmi's `useAccount().chainId` or `useEvmSwitchChain({ xChainId })`
  ```

---

## Behavior verification

- [ ] `pnpm checkTs` exits clean (in the user's app root).
  ```bash
  pnpm checkTs
  # expect exit code 0
  ```

- [ ] Connect/disconnect flow works in dev environment (manual).
  ```
  # Manual:
  # 1. pnpm dev
  # 2. Click connect on each enabled chain
  # 3. Confirm address renders, localStorage has `xwagmi-store` key with the new connection
  # 4. Reload — confirm connection survives
  # 5. Click disconnect — confirm `xwagmi-store` clears that chain
  ```

- [ ] EVM treated as single connection (manual; only if app had per-EVM-chain UI in v1).
  ```
  # Manual:
  # 1. Connect to EVM with any wallet
  # 2. Confirm useChainGroups returns one EVM row, not per-network rows
  # 3. Confirm useEvmSwitchChain switches the active network without re-connecting
  ```

---

## Done criteria

The migration is complete when:

- [ ] All sections above are checked.
- [ ] User has confirmed the app's connect / disconnect / sign flows work end-to-end.
- [ ] Tests are updated (if any test mocks `XService` / `useXWagmiStore`) — flagged in stop conditions; defer to user.

If any item fails or is ambiguous, **stop and ask the user**. Do not declare complete until every box is ticked.
