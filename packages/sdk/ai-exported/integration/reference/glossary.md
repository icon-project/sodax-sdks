# Glossary

| Term | Definition |
|---|---|
| **Hub** | Sonic. The single chain through which every cross-chain operation routes. Hosts the asset manager, wallet abstraction, and vault contracts. |
| **Spoke** | Any of the 19 non-hub chains. Cross-chain operations enter and exit the system through spokes. |
| **Spoke service** | An internal SDK service (e.g. `EvmSpokeService`) that owns the chain-family-specific logic. Owned by `SpokeService` (singular, the router). Consumers never construct one. |
| **Chain key** | A string identifier for a chain (e.g. `'ethereum'`, `'0xa4b1.arbitrum'`). Type: `ChainKey` (full set) or `SpokeChainKey` (spoke chains only). Listed under `ChainKeys.*`. |
| **Chain family** | The class of chain (`'EVM'`, `'BITCOIN'`, `'SOLANA'`, …). Resolved via `getChainType(chainKey)`. |
| **Wallet provider** | A chain-specific signer/broadcaster (`IEvmWalletProvider`, etc.). Constructed by the consumer; passed into SDK calls. |
| **Intent** | A user-signed declaration of intended cross-chain action. The unit of solver-mediated swap. |
| **Solver** | An off-chain market maker that fulfills swap intents. The `SwapService` coordinates with the solver via `SolverApiService`. |
| **Relay** | The off-chain layer that propagates spoke→hub transactions. Public surface: `relayTxAndWaitPacket` and `submitTransaction` top-level functions (re-exported from `@sodax/sdk`). |
| **Relay chain id** | A bigint identifier used internally by the relay layer. **Different** from `ChainKey`. Convert via `sodax.config.getSpokeChainKeyFromIntentRelayChainId(BigInt(...))`. |
| **Vault** | Hub-side ERC4626 contract that holds wrapped/unified spoke tokens. Each `XToken` carries its `vault` address directly. |
| **Hub asset** | Hub-side token address representing a spoke asset on the hub chain. Each `XToken` carries its `hubAsset` address directly. |
| **Hub wallet abstraction** | A user-specific contract on the hub that holds funds during cross-chain ops. Resolved via `EvmHubProvider.getUserHubWalletAddress(...)`. |
| **`Result<T>`** | The `{ ok: true; value: T } \| { ok: false; error: E }` discriminated union returned by every async public method. |
| **`SodaxError<C>`** | The canonical error class. Discriminated by `(feature, code)`. |
| **Code (`SodaxErrorCode`)** | One of 13 reason-only error codes. See § 3. |
| **Feature (`SodaxFeature`)** | One of 8 producing features (`'swap'`, `'moneyMarket'`, …). |
| **Phase (`SodaxPhase`)** | The orchestration step at which an error occurred. See § 3. |
| **Action (`error.context.action`)** | The user-facing operation that triggered the error (`'supply'`, `'stake'`, `'migrateBaln'`, …). |
| **`raw: true / false`** | The discriminator on `WalletProviderSlot<K, Raw>`. `true` = build unsigned tx; `false` = sign and broadcast. |

---


## Cross-references

- [`README.md`](README.md) — reference index.
- [`../architecture.md`](../architecture.md) — concepts behind these tables.
