import { ChainKeys, useStellarAccountStatus } from '@sodax/dapp-kit';
import { useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';
import { useEffect } from 'react';
import Button from '../components/Button';
import Card from '../components/Card';
import { useLab } from './LabContext';
import DiagnosticsPanel from './components/DiagnosticsPanel';
import EventLog from './components/EventLog';
import ScenarioRunner from './components/ScenarioRunner';
import TargetBar from './components/TargetBar';
import { DUPLICATE_NAMES, UNCOVERED_ACTIONS, UNCOVERED_CODES } from './scenarios';
import type { LabCapabilities } from './runner';
import { setMockHorizon, useMockHealth } from './useMockHealth';

export default function LabView() {
  const { config, resolved, setConfig, log } = useLab();
  const { address } = useXAccount({ xChainId: ChainKeys.STELLAR_MAINNET });
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.STELLAR_MAINNET });

  const { health, refresh } = useMockHealth(resolved.effectiveSponsoringBaseUrl, resolved.isMock);
  const status = useStellarAccountStatus({ params: { address } });

  const mockScenarios = health.state === 'up' ? [...health.scenarios.config, ...health.scenarios.accounts] : [];

  // Keep the caller absent so activation does not short-circuit before orchestration runs.
  useEffect(() => {
    if (!resolved.isMock || !config.mockHorizon || health.state !== 'up') return;
    void setMockHorizon(resolved.effectiveSponsoringBaseUrl, { activeAccounts: [], mode: 'ok' });
  }, [resolved.isMock, resolved.effectiveSponsoringBaseUrl, config.mockHorizon, health.state]);

  const capabilities: LabCapabilities = {
    signer: !!address && !!walletProvider,
    mockHorizon: resolved.isMock && config.mockHorizon,
    inactiveAddress: status.data ? !status.data.exists : resolved.isMock && config.mockHorizon,
  };

  const mockDown = resolved.isMock && health.state === 'down';
  const canRun = !mockDown;

  return (
    <div className="space-y-6">
      {resolved.isRealMainnet && (
        <div className="rounded-md border-2 border-warning-border bg-warning-surface px-4 py-3">
          <p className="text-sm font-medium text-warning">REAL MAINNET — a successful activation spends real XLM.</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Run-all is disabled here. Failure scenarios still cost nothing; a success does not.
          </p>
        </div>
      )}

      {mockDown && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3">
          <p className="text-sm font-medium text-destructive">Mock server not running.</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Vite’s proxy answers an unreachable upstream with its own HTTP 500, which classifies as{' '}
            <code>contactOperator</code> — so every scenario would report the same wrong thing. Start it with{' '}
            <code>pnpm mock-sponsoring</code>.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={refresh}>
              Probe again
            </Button>
            {health.state === 'down' && <span className="text-[0.6875rem] text-muted-foreground">{health.reason}</span>}
          </div>
        </div>
      )}

      <CoverageWarnings />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <ScenarioRunner
            capabilities={capabilities}
            address={address}
            walletProvider={walletProvider}
            mockScenarios={mockScenarios}
            canRun={canRun}
            blockedReason={mockDown ? 'Start the mock server to run scenarios.' : undefined}
          />
          <EventLog />
        </div>

        <div className="space-y-6">
          <TargetBar config={config} resolved={resolved} setConfig={setConfig} />
          <DiagnosticsPanel address={address} />
          {!capabilities.signer && (
            <Card title="Orchestration tier">
              <p className="text-xs text-muted-foreground">
                Connect a Stellar wallet holding an account that does not exist on-chain to unlock the orchestration
                scenarios. The wire tier needs no wallet and already covers every failure class.
              </p>
            </Card>
          )}
          <Card
            title="Log"
            aside={
              <Button variant="ghost" size="sm" onClick={() => log.append({ kind: 'note', label: 'marker' })}>
                Add marker
              </Button>
            }
          >
            <p className="text-xs text-muted-foreground">
              The log lives above the query client, so it survives a target switch — which replaces the cache.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function CoverageWarnings() {
  if (UNCOVERED_ACTIONS.length === 0 && UNCOVERED_CODES.length === 0 && DUPLICATE_NAMES.length === 0) return null;

  return (
    <div className="space-y-1 rounded-md border border-warning-border bg-warning-surface px-4 py-3 text-xs">
      <p className="font-medium text-warning">Scenario coverage gap</p>
      {UNCOVERED_ACTIONS.length > 0 && <p>No scenario asserts: {UNCOVERED_ACTIONS.join(', ')}</p>}
      {UNCOVERED_CODES.length > 0 && <p>No scenario expects the code: {UNCOVERED_CODES.join(', ')}</p>}
      {DUPLICATE_NAMES.length > 0 && <p>Duplicate scenario names: {DUPLICATE_NAMES.join(', ')}</p>}
    </div>
  );
}
