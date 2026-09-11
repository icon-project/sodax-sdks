// Tiny JSON localStorage helpers — one place for the SSR guard + try/catch so the
// per-feature persistence modules stay thin.

export function readJson<T>(key: string): T | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = localStorage.getItem(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best-effort: ignore quota / serialization errors
  }
}
