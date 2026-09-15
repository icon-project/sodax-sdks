import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { LAB_ENABLED } from '../lib/labEnabled';
import {
  DEFAULT_LAB_TIMEOUT_MS,
  defaultLabConfig,
  loadLabConfig,
  readEnvApiKey,
  resolveAppTargets,
  resolveLabTargets,
  saveLabConfig,
  type LabConfig,
  type ResolvedLabTargets,
} from './labConfig';
import { createLabLogStore, type LabLogEntry, type LabLogStore } from './log';

type LabContextValue = {
  config: LabConfig;
  /** The SDK's effective targets, switched here to keep consumers consistent. */
  resolved: ResolvedLabTargets;
  apiKey: string;
  timeoutMs: number;
  setConfig: (next: LabConfig) => void;
  log: LabLogStore;
};

const LabContext = createContext<LabContextValue | undefined>(undefined);

export function LabProvider({
  children,
  defaultHorizonRpcUrl,
  defaultSorobanRpcUrl,
}: {
  children: (value: LabContextValue) => ReactNode;
  defaultHorizonRpcUrl: string;
  defaultSorobanRpcUrl: string;
}) {
  const [config, setConfigState] = useState<LabConfig>(loadLabConfig);
  const [log] = useState<LabLogStore>(createLabLogStore);

  const value = useMemo<LabContextValue>(() => {
    const origin = typeof window === 'undefined' ? 'http://localhost:3003' : window.location.origin;
    return {
      config,
      // Production builds without the lab must never inherit its dev-proxy target.
      resolved: LAB_ENABLED
        ? resolveLabTargets(config, origin, defaultHorizonRpcUrl, defaultSorobanRpcUrl)
        : resolveAppTargets(defaultHorizonRpcUrl, defaultSorobanRpcUrl),
      apiKey: LAB_ENABLED ? config.apiKey : readEnvApiKey(),
      timeoutMs: LAB_ENABLED ? config.timeoutMs : DEFAULT_LAB_TIMEOUT_MS,
      setConfig: next => {
        saveLabConfig(next);
        setConfigState(next);
      },
      log,
    };
  }, [config, defaultHorizonRpcUrl, defaultSorobanRpcUrl, log]);

  return <LabContext.Provider value={value}>{children(value)}</LabContext.Provider>;
}

export function useLab(): LabContextValue {
  const value = useContext(LabContext);
  if (!value) throw new Error('useLab must be used inside <LabProvider>');
  return value;
}

export function useLabLog(): readonly LabLogEntry[] {
  const { log } = useLab();
  return useSyncExternalStore(log.subscribe, log.getSnapshot, log.getSnapshot);
}

export { defaultLabConfig };
