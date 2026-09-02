import {
  classifySponsorError,
  useActivateStellarAccount,
  useSodaxContext,
  type IStellarWalletProvider,
  type SodaxError,
} from '@sodax/dapp-kit';
import { useState } from 'react';
import Button from '../../components/Button';
import Card from '../../components/Card';
import { useLab } from '../LabContext';
import { toSerializable } from '../log';
import {
  FIXTURE_XDR,
  LAB_SCENARIOS,
  TRANSPORT_BASE_URL,
  TRANSPORT_SCENARIO,
  isWireExpectation,
  type LabScenario,
  type OrchestrationExpectation,
} from '../scenarios';
import {
  initialRuns,
  isRunnable,
  verifyOrchestration,
  verifyWire,
  type LabCapabilities,
  type ScenarioRun,
  type SignaturePrompt,
} from '../runner';
import { resetMock } from '../useMockHealth';

const STATE_STYLES: Record<ScenarioRun['state'], string> = {
  idle: 'border-border text-muted-foreground',
  running: 'border-primary text-primary',
  pass: 'border-success-border bg-success-surface text-success',
  fail: 'border-destructive/40 bg-destructive/5 text-destructive',
  skipped: 'border-border bg-muted text-muted-foreground',
};

const STATE_LABEL: Record<ScenarioRun['state'], string> = {
  idle: '—',
  running: '…',
  pass: 'PASS',
  fail: 'FAIL',
  skipped: 'SKIP',
};

export default function ScenarioRunner({
  capabilities,
  address,
  walletProvider,
  mockScenarios,
  canRun,
  blockedReason,
}: {
  capabilities: LabCapabilities;
  address: string | undefined;
  walletProvider: IStellarWalletProvider | undefined;
  mockScenarios: readonly string[];
  canRun: boolean;
  blockedReason?: string;
}) {
  const { sodax } = useSodaxContext();
  const { resolved, log } = useLab();
  const activate = useActivateStellarAccount();
  const [runs, setRuns] = useState<readonly ScenarioRun[]>(() => initialRuns(LAB_SCENARIOS));
  const [busy, setBusy] = useState(false);

  const update = (name: string, patch: Partial<ScenarioRun>) => {
    setRuns(current => current.map(run => (run.scenario.name === name ? { ...run, ...patch } : run)));
  };

  const runOne = async (scenario: LabScenario): Promise<void> => {
    const { runnable, missing } = isRunnable(scenario, capabilities);
    if (!runnable) {
      update(scenario.name, { state: 'skipped', note: missing.join('; ') });
      return;
    }

    update(scenario.name, { state: 'running', verdict: undefined, note: undefined });
    const startedAt = performance.now();

    try {
      if (resolved.isMock) await resetMock(resolved.effectiveSponsoringBaseUrl);

      const verdict =
        scenario.tier === 'wire'
          ? await runWire(scenario)
          : await runOrchestration(scenario, scenario.expect as OrchestrationExpectation);

      update(scenario.name, {
        state: verdict.pass ? 'pass' : 'fail',
        verdict,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      update(scenario.name, {
        state: 'fail',
        note: error instanceof Error ? error.message : String(error),
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    }
  };

  const runWire = async (scenario: LabScenario) => {
    if (!isWireExpectation(scenario)) throw new Error('not a wire scenario');

    const headers = { 'x-mock-scenario': scenario.name };
    // Bypass Vite, which converts an unreachable upstream into HTTP 500.
    const requestConfig =
      scenario.name === TRANSPORT_SCENARIO ? { baseURL: TRANSPORT_BASE_URL as `http://${string}` } : { headers };

    const result =
      scenario.endpoint === 'config'
        ? await sodax.api.sponsoring.getStellarSponsorConfig(requestConfig)
        : await sodax.api.sponsoring.createStellarSponsoredAccount({ data: FIXTURE_XDR }, requestConfig);

    if (result.ok) {
      log.append({ kind: 'result', label: `${scenario.name} unexpectedly succeeded`, scenario: scenario.name });
      return { pass: false, diffs: ['outcome: expected a failure, got a successful response'] };
    }

    const classification = classifySponsorError(result.error as SodaxError<'EXTERNAL_API_ERROR'>);
    log.append({
      kind: 'classification',
      label: `${scenario.name} → ${classification.action}`,
      scenario: scenario.name,
      detail: toSerializable(classification),
    });

    return verifyWire(classification, scenario.expect);
  };

  const runOrchestration = async (scenario: LabScenario, expected: OrchestrationExpectation) => {
    if (!address || !walletProvider) throw new Error('no signer');

    const prompts: SignaturePrompt[] = [];
    const result = await activate.mutateAsyncSafe({
      address,
      walletProvider,
      requestConfig: { headers: { 'x-mock-scenario': scenario.name } },
      // The mock reset cannot clear the SDK's per-base-URL config cache.
      forceConfigRefresh: true,
      onSignatureRequired: info => {
        prompts.push(info);
        log.append({
          kind: 'signaturePrompt',
          label: `signature ${info.attempt} (${info.reason})`,
          scenario: scenario.name,
        });
      },
    });

    log.append({
      kind: 'result',
      label: `${scenario.name} → ${result.ok ? result.value.status : 'failed'}`,
      scenario: scenario.name,
      detail: toSerializable(result.ok ? result.value : result.error),
    });

    return verifyOrchestration(result, prompts, expected);
  };

  /** Serial execution avoids in-flight config dedup and scripted-counter races. */
  const runAll = async () => {
    setBusy(true);
    for (const { scenario } of runs) {
      await runOne(scenario);
    }
    setBusy(false);
  };

  const drift = LAB_SCENARIOS.filter(
    scenario => scenario.name !== TRANSPORT_SCENARIO && !mockScenarios.includes(scenario.name),
  ).map(scenario => scenario.name);

  const summary = summarise(runs);

  return (
    <Card
      title="Scenario runner"
      aside={
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{summary}</span>
          {/* Never run all against the real service: successful scenarios spend XLM. */}
          <Button size="sm" onClick={runAll} disabled={busy || !canRun || !resolved.isMock}>
            {busy ? 'Running…' : 'Run all'}
          </Button>
        </div>
      }
    >
      {!canRun && blockedReason && (
        <p className="mb-3 rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-xs">
          {blockedReason}
        </p>
      )}

      {drift.length > 0 && (
        <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <strong>Catalog drift.</strong> The mock does not serve: {drift.join(', ')}. The two lists must agree, or a
          scenario silently tests nothing.
        </p>
      )}

      <ul className="divide-y divide-border">
        {runs.map(run => (
          <ScenarioRow
            key={run.scenario.name}
            run={run}
            onRun={() => runOne(run.scenario)}
            disabled={busy || !canRun}
          />
        ))}
      </ul>
    </Card>
  );
}

function ScenarioRow({ run, onRun, disabled }: { run: ScenarioRun; onRun: () => void; disabled: boolean }) {
  const { scenario, state, verdict, note, elapsedMs } = run;
  const failing = state === 'fail';

  return (
    <li className={`py-2 ${state === 'skipped' ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-3">
        <span
          className={`w-12 shrink-0 rounded border px-1 py-0.5 text-center text-[0.625rem] font-medium ${STATE_STYLES[state]}`}
        >
          {STATE_LABEL[state]}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-mono text-xs">
            {scenario.name}
            <span className="rounded bg-muted px-1 text-[0.625rem] font-sans text-muted-foreground">
              {scenario.tier}
            </span>
            {elapsedMs !== undefined && (
              <span className="text-[0.625rem] font-sans text-muted-foreground">{elapsedMs}ms</span>
            )}
          </p>
          <p className="text-[0.6875rem] leading-snug text-muted-foreground">{scenario.why}</p>
          {note && <p className="text-[0.6875rem] text-warning">{note}</p>}
          {failing &&
            verdict?.diffs.map(entry => (
              <p key={entry} className="font-mono text-[0.6875rem] text-destructive">
                {entry}
              </p>
            ))}
        </div>
        <Button size="sm" variant="ghost" onClick={onRun} disabled={disabled}>
          Run
        </Button>
      </div>
    </li>
  );
}

function summarise(runs: readonly ScenarioRun[]): string {
  const pass = runs.filter(run => run.state === 'pass').length;
  const fail = runs.filter(run => run.state === 'fail').length;
  const skipped = runs.filter(run => run.state === 'skipped').length;
  if (pass + fail + skipped === 0) return `${runs.length} scenarios`;
  return `${pass} pass · ${fail} fail · ${skipped} skipped`;
}
