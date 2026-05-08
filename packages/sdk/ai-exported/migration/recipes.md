# Migration recipes — v1 → v2

Practical patterns for porting consumer code without rewriting everything in one pass. Three recipes:

1. [Codemod patterns](#1-codemod-patterns) — regex find/replace + a small `ts-morph` script for the renames that grep can't safely handle.
2. [Error-shape adapter](#2-error-shape-adapter) — adapt v2 `SodaxError` onto v1 `{ code, data }` branches so existing error-formatting helpers keep working.
3. [Result adapter](#3-result-adapter) — wrap v2 `Result<T>` in a v1-style throw shim for incremental conversion of call sites.

These are migration-only — once the port is complete, delete them. They're not patterns for new code.

---

## 1. Codemod patterns

### What's safe to grep-replace

| Change | Find | Replace | Notes |
|---|---|---|---|
| Chain-id constants | `(\w+)_MAINNET_CHAIN_ID` | `ChainKeys.$1_MAINNET` | Mechanical. After: fix `import` statements. |
| `xChainId` field on `XToken` | `\.xChainId\b` | `.chainKey` | Token field rename. Audit first — some non-token types may use `xChainId` differently. |
| `Token` type rename | `\bimport(.*)\bToken\b(.*)\bfrom 'sodax/types'` | `import$1XToken$2from '@sodax/sdk'` | Best done with `ts-morph` to avoid touching unrelated `Token` identifiers. |
| `SpokeChainId` → `SpokeChainKey` | `\b(SpokeChainId\|ChainId)\b` (in type positions) | `SpokeChainKey` | Audit — `ChainId` is also used by 3rd-party libs (viem, etc.). Limit to `@sodax/types` imports. |
| `AddressType` → `BtcAddressType` | `\bAddressType\b` (in `@sodax/types` import positions) | `BtcAddressType` | |

### What's not safe to grep-replace

- `srcChain` → `srcChainKey` on **request** types only. Read shapes (`Intent.srcChain`, `IntentResponse.srcChain`) keep `srcChain` as the relay chain id. Use a `ts-morph` script keyed by parameter type.
- `spokeProvider` → `walletProvider`. The replacement isn't 1-to-1 (`spokeProvider` was a class instance; `walletProvider` is a separate field). You're better off doing this manually per call site.
- `instanceof EvmSpokeProvider` → chain-key check. Chain-specific replacement varies (some need `chainKey === ChainKeys.X`, some `getChainType(chainKey) === 'EVM'`).

### `ts-morph` script for chain-id imports

When you have many files, a one-shot script for the chain-id rename. Run from the root of your consumer repo with `tsx codemod-chain-ids.ts`:

```ts
// codemod-chain-ids.ts
import { Project, SyntaxKind } from 'ts-morph';

const project = new Project({ tsConfigFilePath: 'tsconfig.json' });
const sodaxImports = ['@sodax/types', '@sodax/sdk'];
const renamed = new Set<string>();

for (const file of project.getSourceFiles('src/**/*.{ts,tsx}')) {
  let edited = false;

  for (const decl of file.getImportDeclarations()) {
    if (!sodaxImports.includes(decl.getModuleSpecifierValue())) continue;

    const named = decl.getNamedImports();
    const toRemove: typeof named = [];
    let needsChainKeysImport = false;

    for (const imp of named) {
      const name = imp.getName();
      const m = name.match(/^(.+)_MAINNET_CHAIN_ID$/);
      if (!m) continue;
      const newName = `ChainKeys.${m[1]}_MAINNET`;
      // Replace usages inside the file
      file.forEachDescendant(node => {
        if (node.isKind(SyntaxKind.Identifier) && node.getText() === name) {
          node.replaceWithText(newName);
          edited = true;
          renamed.add(name);
        }
      });
      toRemove.push(imp);
      needsChainKeysImport = true;
    }

    for (const imp of toRemove) imp.remove();
    if (needsChainKeysImport) {
      const existing = decl.getNamedImports().find(i => i.getName() === 'ChainKeys');
      if (!existing) decl.addNamedImport('ChainKeys');
    }
    if (decl.getNamedImports().length === 0 && !decl.getNamespaceImport() && !decl.getDefaultImport()) {
      decl.remove();
      edited = true;
    }
  }

  if (edited) await file.save();
}

console.log('Renamed constants:', [...renamed].join(', '));
```

Exit codes and post-run checks:

- **Run `tsc --noEmit` after** — confirm imports resolve. The script doesn't touch `ChainKey` type imports (which you may also need to add manually in some files).
- **Re-run with `--dry-run`** semantics by commenting out `file.save()` to preview the diff.

### Pitfall

The `ts-morph` script above edits in-place. Commit your tree before running.

---

## 2. Error-shape adapter

If your consumer code has `getMmErrorText`, `getSwapErrorText`, or similar helpers that branch on a v1 error object's `.code` and `.data.error`, the minimal-change migration is to wrap incoming v2 `SodaxError` instances at the entry point of each helper:

```ts
// shared/error-shape-adapter.ts
import { isSodaxError } from '@sodax/sdk';

export type V1ErrorShape = {
  code?: string;
  message?: string;
  data?: { error?: unknown };
};

/**
 * Adapt v2 SodaxError onto the v1 `{ code, message, data: { error } }` shape so
 * existing v1-style error helpers keep working without rewriting every branch.
 *
 * Migration only — replace with `(error.feature, error.code)` branching once the
 * helper is rewritten.
 */
export function adaptToV1ErrorShape(error: unknown): V1ErrorShape | null {
  if (error == null) return null;

  // v2 SodaxError → v1-shaped object with code on top level.
  if (isSodaxError(error)) {
    return {
      code: error.code,
      message: error.message,
      data: { error: error.cause },
    };
  }

  // Plain Error (no code) — fall back to message.
  if (error instanceof Error) {
    return { code: error.message, message: error.message };
  }

  // Already v1 shape — pass through.
  if (typeof error === 'object') {
    return error as V1ErrorShape;
  }

  return null;
}
```

### Usage

```ts
// Before:
function getMmErrorText(error: unknown): string {
  if (error instanceof MoneyMarketError) {
    if (error.code === 'CREATE_SUPPLY_INTENT_FAILED') return 'Could not build supply';
    if (error.code === 'SUPPLY_FAILED') return 'Supply failed';
  }
  return 'Unknown error';
}

// After (adapter at the top, branches keep working):
function getMmErrorText(error: unknown): string {
  const sdkError = adaptToV1ErrorShape(error);
  if (sdkError?.code === 'INTENT_CREATION_FAILED') return 'Could not build supply';   // v2 code
  if (sdkError?.code === 'EXECUTION_FAILED') return 'Supply failed';                   // v2 code
  return 'Unknown error';
}
```

### Final-form (recommended)

After the adapter is in place, gradually rewrite each helper to use `(feature, code)` directly. The adapter is a stepping stone, not the destination:

```ts
import { isSodaxError } from '@sodax/sdk';

function getMmErrorText(error: unknown): string {
  if (!isSodaxError(error) || error.feature !== 'moneyMarket') return 'Unknown error';
  switch (error.code) {
    case 'INTENT_CREATION_FAILED':
      return error.context?.action === 'supply' ? 'Could not build supply' : 'Could not build operation';
    case 'EXECUTION_FAILED':
      return `${error.context?.action ?? 'operation'} failed`;
    case 'RELAY_TIMEOUT':
      return 'Cross-chain relay timed out';
    case 'TX_VERIFICATION_FAILED':
      return 'Transaction could not be verified on the source chain';
    default:
      return 'Unexpected error';
  }
}
```

See [`breaking-changes/result-and-errors.md`](breaking-changes/result-and-errors.md) § 4 for the full v1 → v2 code crosswalk and § 7 for the discrimination patterns this snippet uses.

---

## 3. Result adapter

If converting every call site to branch on `result.ok` in one pass isn't realistic, use a `throwIfError` shim during migration. Then convert call sites at your own pace.

```ts
// shared/result-adapter.ts
import { isSodaxError } from '@sodax/sdk';
import type { Result } from '@sodax/sdk';

/**
 * Throw on { ok: false }. v1-shape callers can `await throwIfError(result)` and
 * keep their existing try/catch blocks during migration.
 *
 * The thrown value is the original error from the Result — typically a SodaxError.
 * Existing instanceof / .code branches will still work via adaptToV1ErrorShape.
 *
 * Migration only — once the call site is converted to branch on result.ok directly,
 * remove the throwIfError wrap.
 */
export function throwIfError<T>(result: Result<T, unknown>): T {
  if (!result.ok) {
    if (isSodaxError(result.error)) throw result.error;
    if (result.error instanceof Error) throw result.error;
    throw new Error(`unwrap failed: ${String(result.error)}`);
  }
  return result.value;
}

/**
 * Same as throwIfError, but coerces non-Error errors to a thrown Error
 * (useful when downstream code only catches Error).
 */
export function throwAsError<T>(result: Result<T, unknown>, fallbackMessage = 'operation failed'): T {
  if (!result.ok) {
    const e = result.error;
    if (e instanceof Error) throw e;
    throw new Error(typeof e === 'string' ? e : fallbackMessage);
  }
  return result.value;
}
```

### Usage during migration

```ts
// Before (v1):
try {
  const txHash = await sodax.moneyMarket.supply({ params, spokeProvider });
  /* … */
} catch (e) {
  if (e instanceof MoneyMarketError && e.code === 'SUPPLY_FAILED') /* … */
}

// During migration (with shim):
try {
  const { srcChainTxHash } = await throwIfError(
    await sodax.moneyMarket.supply({ params, raw: false, walletProvider }),
  );
  /* … */
} catch (e) {
  // existing v1-shape branches keep working via adaptToV1ErrorShape;
  // SodaxError instances satisfy the same checks once you migrate them
  if (e instanceof Error && /* … */) /* … */
}
```

### Final-form (recommended)

Once the call site is converted, drop `throwIfError`:

```ts
const result = await sodax.moneyMarket.supply({ params, raw: false, walletProvider });
if (!result.ok) {
  setError(getMmErrorText(result.error));
  return;
}
const { srcChainTxHash } = result.value;
```

### Pitfall — the v1-style `try { await sodax.<method>(...) } catch` does not work

A common mistake during migration: keeping the `try/catch` block but updating the inner call to v2 shape, expecting it to still throw. **It won't.** v2 `Result<T>` resolves on failure — the `catch` only fires for synchronous wrapper exceptions (e.g. missing `walletProvider`). Either:

- Wrap the call in `throwIfError` (this recipe), so failures throw.
- Branch on `result.ok` (preferred end state).

Don't leave the `try/catch` in place expecting it to catch SDK-level failures — it can't.

---

## Cross-references

- The breaking changes that motivate these recipes: [`breaking-changes/type-system.md`](breaking-changes/type-system.md), [`breaking-changes/architecture.md`](breaking-changes/architecture.md), [`breaking-changes/result-and-errors.md`](breaking-changes/result-and-errors.md).
- Per-feature playbooks (which assume these recipes are in your toolkit): [`features/`](features/).
- v2 design context (the patterns you're migrating *to*): [`../integration/recipes.md`](../integration/recipes.md).
