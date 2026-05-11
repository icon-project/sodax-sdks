# Migration recipes — `@sodax/dapp-kit` v1 → v2

Codemods, adapters, and incremental migration patterns. Use these when full conversion in one pass isn't realistic or when you want to mechanize the boring parts.

## Codemod 1: chain-id constants → ChainKeys

```bash
# From your consumer's repo root:
find src -type f \( -name '*.ts' -o -name '*.tsx' \) | xargs sed -i '' -E 's/\b([A-Z_]+)_MAINNET_CHAIN_ID\b/ChainKeys.\1_MAINNET/g'
```

Then add `import { ChainKeys } from '@sodax/sdk'` (or `'@sodax/dapp-kit'` — both work) where needed. tsc will flag missing imports.

For more sophisticated automation across many files, use ts-morph:

```ts
// @ai-snippets-skip
// codemod-chain-ids.ts — run with `tsx codemod-chain-ids.ts`
import { Project, SyntaxKind } from 'ts-morph';

const project = new Project({ tsConfigFilePath: './tsconfig.json' });

for (const file of project.getSourceFiles('src/**/*.{ts,tsx}')) {
  let needsImport = false;

  file.forEachDescendant((node) => {
    if (node.getKind() === SyntaxKind.Identifier) {
      const text = node.getText();
      const m = text.match(/^([A-Z_]+)_MAINNET_CHAIN_ID$/);
      if (m) {
        node.replaceWithText(`ChainKeys.${m[1]}_MAINNET`);
        needsImport = true;
      }
    }
  });

  if (needsImport && !file.getImportDeclaration('@sodax/sdk')?.getNamedImports().some(n => n.getName() === 'ChainKeys')) {
    file.addImportDeclaration({ moduleSpecifier: '@sodax/sdk', namedImports: ['ChainKeys'] });
  }
}

await project.save();
```

## Codemod 2: useSpokeProvider deletion

`useSpokeProvider` is gone in v2. Delete the import + usage; replace with `useWalletProvider` from `@sodax/wallet-sdk-react`.

```bash
# 1. Find all usages first.
grep -rE '\buseSpokeProvider\b' src/

# 2. Manual delete + rewrite each (no safe sed for this — context varies).
```

Per call site, the rewrite:

```diff
- import { useSpokeProvider } from '@sodax/dapp-kit';
- const spokeProvider = useSpokeProvider({ chainId: BSC_MAINNET_CHAIN_ID });
+ import { useWalletProvider } from '@sodax/wallet-sdk-react';
+ import { ChainKeys } from '@sodax/sdk';
+ const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });
```

Then update consumers of `spokeProvider` to use `walletProvider` instead — usually inside `mutate(vars)` payloads, sometimes inside query hook params.

## Codemod 3: invalidate*Queries utilities deletion

Most v1 consumers had `lib/invalidate*Queries.ts` files. Hook-owned invalidations make these obsolete:

```bash
# Find them.
grep -rE '(invalidateMmQueries|invalidateSwapQueries|invalidateBridgeQueries|invalidate\w+Queries)' src/

# For each call site, delete the call. The mutation hook handles invalidation.
```

If you have a custom invalidation that dapp-kit's hooks don't know about (e.g. your own analytics view), move it into `mutationOptions.onSuccess`:

```diff
  const { mutateAsync: supply } = useSupply({
+   mutationOptions: {
+     onSuccess: async (data, vars) => {
+       await queryClient.invalidateQueries({ queryKey: ['my-app', 'analytics'] });
+     },
+   },
  });
- await supply({ params, spokeProvider });
- invalidateMmQueries(queryClient, ...);   // delete
- await queryClient.invalidateQueries({ queryKey: ['my-app', 'analytics'] });   // delete
+ await supply({ params, walletProvider });
```

## Adapter: Result<T>-shape adapter for legacy error consumers

If your consumer code has a helper that branches on a v1 error shape (e.g. `error.code` from old per-feature classes), the minimal change is to map v2 onto v1 at the boundary:

```ts
// adapters/v1ErrorShape.ts
import { isSodaxError } from '@sodax/dapp-kit';

// V1 shape: { code, message, data?: { error } }
export function adaptToV1ErrorShape(error: unknown): { code?: string; message?: string; data?: { error?: unknown } } | null {
  if (!error) return null;
  if (isSodaxError(error)) {
    return {
      code: error.code,
      message: error.message,
      data: { error: error.cause },
    };
  }
  if (error instanceof Error) return { code: 'UNKNOWN', message: error.message };
  if (typeof error === 'object') return error as { code?: string; message?: string };
  return null;
}
```

Then your existing v1-shape error handlers keep working:

```ts
// @ai-snippets-skip
const { mutateAsync: swap } = useSwap();
try {
  await swap({ params, walletProvider });
} catch (e) {
  const adapted = adaptToV1ErrorShape(e);
  if (adapted?.code === 'INTENT_CREATION_FAILED' /* etc. */) { /* ... */ }
}
```

Plan to delete the adapter once you've converted error-handling code site-by-site.

## Incremental migration: feature-by-feature

If the codebase is too large for a single-pass migration, you can convert one feature at a time. The pattern:

1. **Pick a low-traffic feature first** (e.g. recovery, partner). It limits blast radius if something breaks.
2. **Convert that feature's call sites and approve hooks**.
3. **Run the app, smoke-test the feature**.
4. **Move on to the next feature**.

The catch: SDK-level changes are global (e.g. chain-key terminology). You can't do `xChainId` on `XToken` for swap and `chainKey` for staking — both run on the same SDK. Plan to do all SDK-level migrations in one pass first (Phase 1 + 2 of [`checklist.md`](checklist.md)), then per-feature hook-call-site work in any order (Phase 3+).

## Incremental migration: keeping v1 wrappers temporarily

If you have many call sites that share a custom wrapper hook (e.g. one your codebase named `useLegacySwap` calling v1 dapp-kit underneath), you can rewrite the wrapper's body to call v2 internally while keeping the wrapper's name and surface intact. Call sites stay unchanged.

```tsx
// Custom wrapper that your codebase already has (with a project-specific name).
// Rewrite its body to call v2 dapp-kit internally; preserve the surface so
// existing call sites don't change yet.

import { useSwap } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import type { CreateIntentParams } from '@sodax/sdk';

// Function name starts with `use` because it calls React hooks (`useWalletProvider`,
// `useSwap`). Inside a component, call it like any other hook.
export function useLegacySwapAdapter(spokeProvider: unknown, params: CreateIntentParams) {
  const walletProvider = useWalletProvider(/* derive chainKey from spokeProvider */);
  const m = useSwap();
  return {
    swap: async () => {
      if (!walletProvider) throw new Error('wallet not connected');
      // Adapt v2 throw-on-fail back to v1 success-with-Result shape:
      try {
        const value = await m.mutateAsync({ params, walletProvider });
        return { ok: true, value };
      } catch (e) {
        return { ok: false, error: e };
      }
    },
    isLoading: m.isPending,
    error: m.error,
  };
}
```

Then convert call sites at your own pace. Delete the wrapper once you're done.

## Cross-references

- [`README.md`](README.md) — overview + glossary.
- [`checklist.md`](checklist.md) — top-down migration checklist.
- [`ai-rules.md`](ai-rules.md) — DO / DO NOT for the agent doing the migration.
- [`breaking-changes/`](breaking-changes/) — cross-cutting deltas in detail.
- [`features/`](features/) — per-feature porting playbooks.
