/**
 * Canonical error type for the SODAX SDK.
 *
 * Used as the universal error shape across the SDK so callers get a deterministic, narrow-union
 * error type per method and so structured loggers (Sentry, Pino, Datadog) can serialize the
 * error consistently via {@link SodaxError.toJSON}.
 *
 * @see {@link isSodaxError} for a bundle-safe type guard.
 */

export type SodaxErrorContext = Record<string, unknown>;

export type SodaxErrorJSON<C extends string = string> = {
  name: string;
  code: C;
  message: string;
  stack?: string;
  context?: SodaxErrorContext;
  cause?: unknown;
};

const MAX_CAUSE_DEPTH = 3;
const MAX_SANITIZE_DEPTH = 5;

export class SodaxError<C extends string = string> extends Error {
  readonly code: C;
  override readonly cause?: unknown;
  readonly context?: SodaxErrorContext;

  constructor(code: C, message: string, options?: { cause?: unknown; context?: SodaxErrorContext }) {
    super(message);
    this.name = 'SodaxError';
    this.code = code;
    this.cause = options?.cause;
    this.context = options?.context;
    if (typeof (Error as { captureStackTrace?: unknown }).captureStackTrace === 'function') {
      (Error as { captureStackTrace: (target: object, ctor: unknown) => void }).captureStackTrace(this, SodaxError);
    }
  }

  /**
   * Canonical logger-integration surface. Any logger (Sentry/Pino/Datadog) should serialize
   * via this method. `JSON.stringify(err)` invokes it automatically per ECMAScript spec.
   *
   * Hardened against:
   * - `bigint` anywhere in `context` (recursively coerced to string)
   * - circular / deeply-nested cause chains (walked up to MAX_CAUSE_DEPTH = 3 levels)
   * - non-plain objects in context (Date/Map/Set/Error/class instances are stringified)
   * - context cycles (depth-bounded with MAX_SANITIZE_DEPTH = 5)
   */
  toJSON(): SodaxErrorJSON<C> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      stack: this.stack,
      context: this.context ? sanitizeContext(this.context, 0) : undefined,
      cause: serializeCause(this.cause, 0),
    };
  }
}

/**
 * Type guard for {@link SodaxError}. Prefer this over bare `instanceof SodaxError` checks
 * in consumer code: it stays correct even when duplicate copies of `@sodax/sdk` exist in
 * a bundle (a real-world hazard with monorepos and dual ESM/CJS packages) where
 * `instanceof` can return `false` for a value originating from a sibling copy of the class.
 */
export function isSodaxError(e: unknown): e is SodaxError {
  if (e instanceof SodaxError) return true;
  return (
    e instanceof Error &&
    typeof (e as { code?: unknown }).code === 'string' &&
    (e as { name?: unknown }).name === 'SodaxError'
  );
}

function serializeCause(cause: unknown, depth: number): unknown {
  if (cause === undefined || cause === null) return undefined;
  if (depth >= MAX_CAUSE_DEPTH) return '[max cause depth reached]';
  if (cause instanceof SodaxError) {
    return {
      name: cause.name,
      code: cause.code,
      message: cause.message,
      stack: cause.stack,
      context: cause.context ? sanitizeContext(cause.context, 0) : undefined,
      cause: serializeCause(cause.cause, depth + 1),
    };
  }
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
      stack: cause.stack,
      cause: 'cause' in cause ? serializeCause((cause as { cause?: unknown }).cause, depth + 1) : undefined,
    };
  }
  return safeString(cause);
}

function sanitizeContext(value: SodaxErrorContext, depth: number): SodaxErrorContext {
  const out: SodaxErrorContext = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = sanitizeValue(v, depth + 1);
  }
  return out;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth >= MAX_SANITIZE_DEPTH) return '[max depth reached]';
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'bigint') return (value as bigint).toString();
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (t === 'function' || t === 'symbol') return safeString(value);
  if (Array.isArray(value)) return value.map(v => sanitizeValue(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map) {
    return Array.from(value.entries()).map(([k, v]) => [sanitizeValue(k, depth + 1), sanitizeValue(v, depth + 1)]);
  }
  if (value instanceof Set) {
    return Array.from(value.values()).map(v => sanitizeValue(v, depth + 1));
  }
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (t === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      return sanitizeContext(value as SodaxErrorContext, depth);
    }
    return safeString(value);
  }
  return safeString(value);
}

function safeString(v: unknown): string {
  try {
    return String(v);
  } catch {
    return '[unserializable]';
  }
}
