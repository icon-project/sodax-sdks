# Migration checklist

Run through every item before declaring the migration done. Each item is machine-checkable.

---

## Mandatory

- [ ] **No deep imports from `@sodax/wallet-sdk-core/src/…`**
  ```bash
  grep -rn "@sodax/wallet-sdk-core/" <user-src> | grep -v "from '@sodax/wallet-sdk-core'"
  # expect empty
  ```
  v1's flat layout (`wallet-providers/EvmWalletProvider.ts`) no longer resolves under v2's folder-per-chain layout. Only the barrel root is public.

- [ ] **No imports of internal utilities**
  ```bash
  grep -rn "shallowMerge" <user-src>
  # expect empty
  ```
  `shallowMerge` is internal in v2 (and didn't exist in v1). Use `defaults` config + per-call options.

- [ ] **`pnpm checkTs` exits clean** with no `@sodax/wallet-sdk-core` symbol errors.

---

## Recommended (optional cleanup)

- [ ] **Drop direct upstream-SDK type imports covered by `library-exports`**
  ```bash
  grep -rn "from 'viem'" <user-src> | grep -E "WalletClient|PublicClient|TransactionReceipt|SendTransactionParameters|WaitForTransactionReceiptParameters|HttpTransportConfig|PublicClientConfig|WalletClientConfig"
  grep -rn "from '@stellar/stellar-sdk'" <user-src> | grep "Networks"
  grep -rn "from '@stacks/transactions'" <user-src> | grep -E "PostConditionMode|ClarityValue|PostConditionModeName"
  grep -rn "from '@mysten/wallet-standard'" <user-src>
  grep -rn "from '@solana/web3.js'" <user-src> | grep -E "Commitment|ConnectionConfig|SendOptions"
  grep -rn "from '@injectivelabs/networks'" <user-src> | grep "Network"
  grep -rn "from '@injectivelabs/ts-types'" <user-src> | grep -E "ChainId|EvmChainId"
  grep -rn "from '@injectivelabs/wallet-core'" <user-src> | grep "MsgBroadcaster"
  grep -rn "from '@hot-labs/near-connect'" <user-src> | grep "NearConnector"
  grep -rn "from '@stacks/network'" <user-src> | grep "StacksNetwork"
  grep -rn "from '@stacks/connect'" <user-src> | grep "StacksProvider"
  # if any matches, decide whether to re-import via @sodax/wallet-sdk-core
  ```

- [ ] **Direct upstream-SDK deps removed from `package.json`** (only if 100% replaced by library-exports)
  ```bash
  cat <user>/package.json | jq -r '.dependencies | keys[]' | grep -E '^(viem|@stellar/stellar-sdk|@stacks/transactions|@mysten/sui|@mysten/wallet-standard|@solana/web3.js|@injectivelabs/networks|@injectivelabs/ts-types|@injectivelabs/wallet-core|@hot-labs/near-connect|@stacks/network|@stacks/connect)$'
  # confirm each remaining entry is genuinely needed for a runtime symbol library-exports doesn't cover
  ```

- [ ] **`defaults` adopted in places where wrappers were hand-rolled**
  Look for ad-hoc wrappers (`makeProvider`, `buildProvider`, `withDefaults`) that injected default gas / commitment / timeout values, and replace them with provider-level `defaults` config.

---

## Verification of behavior

- [ ] **Get-address smoke test** passes for every provider the user constructs.
- [ ] **One signing flow** runs end-to-end against a testnet (or recorded mock).
- [ ] **CI passes** (`pnpm lint && pnpm checkTs && pnpm test`).

When all mandatory + behavior items above are checked, the migration is done. Optional items are bonus.
