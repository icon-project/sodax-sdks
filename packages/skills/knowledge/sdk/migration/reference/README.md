# Migration reference — `@sodax/sdk` v1 → v2

Tables. Each file is a focused lookup; the prose explanations live in `../breaking-changes/` and `../features/`.

| File | Contents |
|---|---|
| [`deleted-exports.md`](deleted-exports.md) | Comprehensive table of every removed v1 export with its v2 replacement: spoke-provider classes & guards, static lookup tables, type aliases, constants, error types, per-feature param-shape changes. |
| [`sodax-config.md`](sodax-config.md) | `SodaxConfig` constructor reshape: `swaps` vs `solver` field split, `rpcConfig` keying change, `hubProviderConfig` → `hubConfig` rename, `configService` injection point gone. |
| [`error-code-crosswalk.md`](error-code-crosswalk.md) | Per-feature v1 module-error code → v2 `(feature, code, context)` tuple. Money market, swap, staking, bridge, migration, DEX, relay, partner, recovery. |
| [`return-shapes.md`](return-shapes.md) | Per-method return-shape diffs. `CreateIntentResult` tuple→object, every cross-chain mutation now returns `TxHashPair`, `getBridgeableAmount` returns `BridgeLimit`, `getStakeRatio` returns a tuple, etc. |

## Cross-references

- [`../README.md`](../README.md) — migration overview.
- [`../checklist.md`](../checklist.md) — top-level migration checklist.
- [`../ai-rules.md`](../ai-rules.md) — DO / DO NOT / workflow.
- [`../breaking-changes/`](../breaking-changes/) — the prose that explains what these tables tabulate.
- v2 design context: [`../../integration/architecture.md`](../../integration/architecture.md) and [`../../integration/reference/`](../../integration/reference/).
