import { useSodaxContext } from '@sodax/dapp-kit';
import { useState } from 'react';
import Button from '../../components/Button';
import Card, { Row } from '../../components/Card';
import {
  MIN_LAB_TIMEOUT_MS,
  TARGET_LABELS,
  clampTimeoutMs,
  type LabConfig,
  type LabTarget,
  type ResolvedLabTargets,
} from '../labConfig';

const TARGETS: readonly LabTarget[] = ['mock', 'localBackend', 'realMainnet', 'custom'];

const MAINNET_CONFIRM = 'MAINNET';

export default function TargetBar({
  config,
  resolved,
  setConfig,
}: {
  config: LabConfig;
  resolved: ResolvedLabTargets;
  setConfig: (next: LabConfig) => void;
}) {
  const { sodax } = useSodaxContext();
  const [pendingMainnet, setPendingMainnet] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const selectTarget = (target: LabTarget) => {
    if (target === 'realMainnet') {
      setPendingMainnet(true);
      setConfirmText('');
      return;
    }
    setPendingMainnet(false);
    setConfig({ ...config, target, mockHorizon: target === 'mock' ? config.mockHorizon : false });
  };

  const confirmMainnet = () => {
    if (confirmText !== MAINNET_CONFIRM) return;
    setPendingMainnet(false);
    setConfig({ ...config, target: 'realMainnet', mockHorizon: false });
  };

  return (
    <Card title="Target">
      <div className="flex flex-wrap gap-1.5">
        {TARGETS.map(target => (
          <Button
            key={target}
            size="sm"
            variant={config.target === target ? (target === 'realMainnet' ? 'warning' : 'primary') : 'ghost'}
            onClick={() => selectTarget(target)}
          >
            {TARGET_LABELS[target]}
          </Button>
        ))}
      </div>

      {pendingMainnet && (
        <div className="mt-3 space-y-2 rounded-md border border-warning-border bg-warning-surface px-3 py-2.5">
          <p className="text-xs">
            <strong>Real mainnet.</strong> A successful activation spends real XLM and needs a funded sponsor. Type{' '}
            <code>{MAINNET_CONFIRM}</code> to confirm.
          </p>
          <div className="flex gap-2">
            <input
              value={confirmText}
              onChange={event => setConfirmText(event.target.value)}
              className="flex-1 rounded-md border border-input bg-background px-2 py-1 font-mono text-xs"
              placeholder={MAINNET_CONFIRM}
            />
            <Button size="sm" variant="warning" onClick={confirmMainnet} disabled={confirmText !== MAINNET_CONFIRM}>
              Confirm
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPendingMainnet(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {config.target === 'custom' && (
        <label className="mt-3 block space-y-1">
          <span className="text-xs text-muted-foreground">Base URL</span>
          <input
            value={config.customBaseUrl}
            onChange={event => setConfig({ ...config, customBaseUrl: event.target.value })}
            placeholder="http://localhost:3011"
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs"
          />
          {resolved.isUnresolved && (
            <span className="block text-[0.6875rem] text-destructive">
              Not a usable <code>http(s)://</code> url — the SDK is falling back to its packaged endpoint.
            </span>
          )}
        </label>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Api key</span>
          <div className="flex gap-1.5">
            <input
              type="password"
              value={config.apiKey}
              onChange={event => setConfig({ ...config, apiKey: event.target.value })}
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs"
            />
            <Button size="sm" variant="ghost" onClick={() => setConfig({ ...config, apiKey: '' })}>
              Clear
            </Button>
          </div>
          <span className="block text-[0.6875rem] text-muted-foreground">
            Empty sends no header — that is the genuine 401 path.
          </span>
        </label>

        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Timeout (ms)</span>
          <input
            type="number"
            min={MIN_LAB_TIMEOUT_MS}
            value={config.timeoutMs}
            // Prevent a cleared field from turning every scenario into a false timeout.
            onChange={event => setConfig({ ...config, timeoutMs: clampTimeoutMs(Number(event.target.value)) })}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs"
          />
          <span className="block text-[0.6875rem] text-muted-foreground">
            Drop to ~{MIN_LAB_TIMEOUT_MS * 2} to make the <code>hang</code> scenario fast (min {MIN_LAB_TIMEOUT_MS}).
          </span>
        </label>
      </div>

      <label className="mt-3 flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={config.mockHorizon}
          disabled={!resolved.isMock}
          onChange={event => setConfig({ ...config, mockHorizon: event.target.checked })}
        />
        <span className={resolved.isMock ? '' : 'text-muted-foreground'}>
          Mock Horizon — required for the orchestration tier, since the real network 404s the mock sponsor
        </span>
      </label>

      <h3 className="mt-4 mb-1.5 text-xs font-medium text-muted-foreground">Effective config</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {/* Read from the SDK so target mismatches are visible. */}
        <Row label="Sponsoring baseURL" value={sodax.api.sponsoring.getBaseURL()} />
        <Row label="SDK Horizon" value={sodax.spoke.stellar.server.serverURL.toString()} />
        <Row
          label="SDK Soroban"
          hint={resolved.blocksSpokeWrites ? 'real network — trustline writes are blocked' : undefined}
          value={resolved.sorobanRpcUrl}
        />
        <Row label="Sends x-api-key" value={config.apiKey ? 'yes' : 'no'} />
        <Row label="Timeout" value={`${config.timeoutMs}ms`} />
      </dl>
    </Card>
  );
}
