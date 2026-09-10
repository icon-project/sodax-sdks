import { useCallback, useEffect, useState } from 'react';

export type MockHealth =
  | { state: 'probing' }
  | { state: 'up'; scenarios: { config: readonly string[]; accounts: readonly string[] }; apiKeyRequired: boolean }
  | { state: 'down'; reason: string };

/** Gate runs because Vite converts an unreachable mock into a misleading HTTP 500. */
export function useMockHealth(baseUrl: string, enabled: boolean): { health: MockHealth; refresh: () => void } {
  const [health, setHealth] = useState<MockHealth>({ state: 'probing' });

  const probe = useCallback(async (): Promise<void> => {
    if (!enabled) {
      setHealth({ state: 'down', reason: 'The lab is not pointed at the mock server.' });
      return;
    }

    setHealth({ state: 'probing' });
    try {
      const response = await fetch(`${baseUrl}/__control/health`);
      if (!response.ok) throw new Error(`health probe returned ${response.status}`);
      const body = (await response.json()) as {
        up: boolean;
        apiKeyRequired: boolean;
        scenarios: { config: string[]; accounts: string[] };
      };
      setHealth({ state: 'up', scenarios: body.scenarios, apiKeyRequired: body.apiKeyRequired });
    } catch (error: unknown) {
      setHealth({ state: 'down', reason: error instanceof Error ? error.message : String(error) });
    }
  }, [baseUrl, enabled]);

  useEffect(() => {
    void probe();
  }, [probe]);

  return { health, refresh: () => void probe() };
}

export async function resetMock(baseUrl: string): Promise<void> {
  await fetch(`${baseUrl}/__control/reset`, { method: 'POST' });
}

export async function setMockHorizon(
  baseUrl: string,
  state: { activeAccounts?: readonly string[]; profile?: string; mode?: 'ok' | 'down' },
): Promise<void> {
  await fetch(`${baseUrl}/__control/horizon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
}
