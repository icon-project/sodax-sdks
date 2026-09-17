import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HOOKS_DIR = resolve(fileURLToPath(import.meta.url), '..');

/**
 * Executable retry-policy contract for the hook families served by the api-key-guarded
 * `sodax.api.*` gateway.
 *
 * A 401/403 from that gateway is terminal — only a corrected key resolves it — so replaying one
 * just multiplies doomed requests before the consumer sees the error. React Query's DEFAULT query
 * retry is 3, so a hook that simply omits `retry` inherits exactly that bug; this contract is why
 * every read hook must opt in explicitly to `retryUnlessAuthFailure`.
 *
 * `retry: false` is the one other accepted value, reserved for the non-idempotent submit-intent
 * relay handoff (`useSwapsApiSubmitIntent`, `useLeverageYieldApiSubmitIntent`) where a replay after
 * a lost response could double-submit. Mutations may also omit `retry` entirely — React Query does
 * not retry mutations by default, which is what the sign-and-broadcast `*ApproveAndBroadcast` hooks
 * want.
 *
 * Unlike the sibling `_mutationContract` / `_apiKeyWire` manifests, this one DISCOVERS its files
 * rather than listing them. That is deliberate: the drift this guards against is a new hook (or a
 * whole new API family) that nobody remembered to register.
 */
const FAMILIES = ['swapsApi', 'bridgeApi', 'leverageYieldApi'] as const;

/** Accepted `retry` values: the shared auth-aware policy, or an explicit opt-out. */
const ALLOWED_RETRY = /^\s*retry: (retryUnlessAuthFailure|false),$/m;

/** Any numeric retry — the literal `retry: 3` this contract exists to keep out, prose included. */
const NUMERIC_RETRY = /retry:\s*\d/;

/** Hook files are `useXxx.ts`; skips the barrel and non-hook helpers like `isTerminalSwapIntentStatus.ts`. */
const hookFilesIn = (family: string): string[] =>
  readdirSync(resolve(HOOKS_DIR, family))
    .filter(name => name.startsWith('use') && name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map(name => `${family}/${name}`);

const HOOKS = FAMILIES.flatMap(hookFilesIn).map(path => ({
  path,
  src: readFileSync(resolve(HOOKS_DIR, path), 'utf8'),
}));

describe('the scan itself', () => {
  // A broken filter would make every assertion below vacuously pass.
  it.each(FAMILIES)('finds hook files in %s', family => {
    expect(hookFilesIn(family).length).toBeGreaterThan(0);
  });
});

describe.each(HOOKS)('retry policy: $path', ({ src }) => {
  const setsRetry = /^\s*retry:/m.test(src);

  it('never hardcodes a numeric retry', () => {
    expect(src).not.toMatch(NUMERIC_RETRY);
  });

  if (/useQuery[(<]/.test(src)) {
    it('sets retry explicitly, because React Query would otherwise default to 3', () => {
      expect(src).toMatch(ALLOWED_RETRY);
    });
  } else if (setsRetry) {
    it('sets retry to the shared policy or an explicit opt-out', () => {
      expect(src).toMatch(ALLOWED_RETRY);
    });
  }

  if (setsRetry) {
    it('sets retry before the consumer options spread, so it stays overridable', () => {
      const retryIdx = src.search(/^\s*retry:/m);
      const spreadIdx = src.search(/\.\.\.(query|mutation)Options/);
      expect(spreadIdx).toBeGreaterThan(-1);
      expect(retryIdx).toBeLessThan(spreadIdx);
    });
  }
});
