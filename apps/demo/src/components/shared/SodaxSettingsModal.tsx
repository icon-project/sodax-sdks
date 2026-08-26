import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { DEFAULT_API_BASE_URL, DEFAULT_RELAYER_API_ENDPOINT } from '@sodax/dapp-kit';
import { SolverEnv, useAppStore } from '@/zustand/useAppStore';
import { defaultUseBackendSubmitTx, productionSolverConfig, stagingSolverConfig } from '@/constants';
import { envSodaxApiKey, envSwapsApiBaseUrl, isEvmAddress, isHttpUrl, type SodaxSettings } from '@/lib/sodaxSettings';
import { Check, Copy, RotateCcw } from 'lucide-react';

type SubmitTxChoice = 'auto' | 'on' | 'off';

const URL_FIELDS = ['solverApiEndpoint', 'apiBaseUrl', 'swapsApiBaseUrl', 'relayerApiEndpoint'] as const;
const ADDRESS_FIELDS = ['intentsContract', 'protocolIntentsContract'] as const;
const TEXT_FIELDS = [...URL_FIELDS, ...ADDRESS_FIELDS, 'apiKey'] as const;

type TextField = (typeof TEXT_FIELDS)[number];

/** Modal draft: the text fields hold the EFFECTIVE value (default prefilled, copyable). */
type Draft = { env: SolverEnv; useBackendSubmitTx: SubmitTxChoice } & Record<TextField, string>;

/** The effective default text per field — what an unset override resolves to. `gatewayUrl` is
 *  the effective gateway, which unset swaps inherit (`resolveSwapsApiConfig` layering). */
function defaultsFor(env: SolverEnv, gatewayUrl: string = DEFAULT_API_BASE_URL): Record<TextField, string> {
  const solver = env === SolverEnv.Staging ? stagingSolverConfig : productionSolverConfig;
  return {
    solverApiEndpoint: solver.solverApiEndpoint,
    intentsContract: solver.intentsContract,
    protocolIntentsContract: solver.protocolIntentsContract,
    apiBaseUrl: DEFAULT_API_BASE_URL,
    swapsApiBaseUrl: envSwapsApiBaseUrl ?? gatewayUrl,
    apiKey: envSodaxApiKey ?? '',
    relayerApiEndpoint: DEFAULT_RELAYER_API_ENDPOINT,
  };
}

/** The gateway a draft (or stored override) actually resolves to. */
function effectiveGateway(apiBaseUrl: string | null): string {
  const trimmed = apiBaseUrl?.trim() ?? '';
  return isHttpUrl(trimmed) ? trimmed : DEFAULT_API_BASE_URL;
}

function seedDraft(env: SolverEnv, s: SodaxSettings): Draft {
  const defaults = defaultsFor(env, effectiveGateway(s.apiBaseUrl));
  return {
    env,
    useBackendSubmitTx: s.useBackendSubmitTx === null ? 'auto' : s.useBackendSubmitTx ? 'on' : 'off',
    solverApiEndpoint: s.solverApiEndpoint ?? defaults.solverApiEndpoint,
    intentsContract: s.intentsContract ?? defaults.intentsContract,
    protocolIntentsContract: s.protocolIntentsContract ?? defaults.protocolIntentsContract,
    apiBaseUrl: s.apiBaseUrl ?? defaults.apiBaseUrl,
    swapsApiBaseUrl: s.swapsApiBaseUrl ?? defaults.swapsApiBaseUrl,
    apiKey: s.apiKey ?? defaults.apiKey,
    relayerApiEndpoint: s.relayerApiEndpoint ?? defaults.relayerApiEndpoint,
  };
}

type FieldErrors = Partial<Record<TextField, string>>;

function validateDraft(draft: Draft): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of URL_FIELDS) {
    const value = draft[field].trim();
    if (value && !isHttpUrl(value)) {
      errors[field] = 'Must be an http(s) URL';
    }
  }
  for (const field of ADDRESS_FIELDS) {
    const value = draft[field].trim();
    if (value && !isEvmAddress(value)) {
      errors[field] = 'Must be a 0x-prefixed 20-byte address';
    }
  }
  return errors;
}

/** Empty, or equal to the effective default → null (unset, keeps following defaults); else an override. */
function draftToSettings(draft: Draft): SodaxSettings {
  const defaults = defaultsFor(draft.env, effectiveGateway(draft.apiBaseUrl));
  const norm = (field: TextField): string | null => {
    const value = draft[field].trim();
    return value && value !== defaults[field] ? value : null;
  };
  const url = (field: (typeof URL_FIELDS)[number]) => {
    const value = norm(field);
    return value !== null && isHttpUrl(value) ? value : null;
  };
  const address = (field: (typeof ADDRESS_FIELDS)[number]) => {
    const value = norm(field);
    return value !== null && isEvmAddress(value) ? value : null;
  };
  return {
    useBackendSubmitTx: draft.useBackendSubmitTx === 'auto' ? null : draft.useBackendSubmitTx === 'on',
    solverApiEndpoint: url('solverApiEndpoint'),
    intentsContract: address('intentsContract'),
    protocolIntentsContract: address('protocolIntentsContract'),
    apiBaseUrl: url('apiBaseUrl'),
    swapsApiBaseUrl: url('swapsApiBaseUrl'),
    apiKey: norm('apiKey'),
    relayerApiEndpoint: url('relayerApiEndpoint'),
  };
}

/** Auto keys on the EFFECTIVE solver endpoint — a custom/staging endpoint means the production
 *  backend can't reach that solver, whatever the env tab says. */
function effectiveSolverEndpoint(draft: Draft): string {
  return draft.solverApiEndpoint.trim() || defaultsFor(draft.env).solverApiEndpoint;
}

/** Effective-config snapshot for pasting into a bug report; the API key is masked. */
function draftToDebugJson(draft: Draft): string {
  return JSON.stringify(
    {
      environment: draft.env,
      submitTxMode: draft.useBackendSubmitTx,
      useBackendSubmitTx:
        draft.useBackendSubmitTx === 'auto'
          ? defaultUseBackendSubmitTx(effectiveSolverEndpoint(draft))
          : draft.useBackendSubmitTx === 'on',
      solverApiEndpoint: draft.solverApiEndpoint.trim(),
      intentsContract: draft.intentsContract.trim(),
      protocolIntentsContract: draft.protocolIntentsContract.trim(),
      apiBaseUrl: draft.apiBaseUrl.trim(),
      swapsApiBaseUrl: draft.swapsApiBaseUrl.trim(),
      apiKey: draft.apiKey.trim() ? '(set)' : '(unset)',
      relayerApiEndpoint: draft.relayerApiEndpoint.trim(),
    },
    null,
    2,
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable (permissions/insecure context) — nothing to do
    }
  };
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="h-9 w-9 shrink-0"
      onClick={copy}
      disabled={!text}
      title={label}
    >
      {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
    </Button>
  );
}

/** Label · input · copy — with an amber ring and a ↺ reset button while overriding the default. */
function TextRow({
  label,
  value,
  defaultValue,
  error,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  defaultValue: string;
  error?: string;
  hint?: ReactNode;
  onChange: (value: string) => void;
}) {
  const modified = value.trim() !== defaultValue;
  return (
    <div className="grid sm:grid-cols-[10rem_1fr] items-center gap-x-3 gap-y-1">
      <Label className="text-sm font-medium">
        {label}
        {modified && <span className="ml-1.5 align-middle inline-block w-1.5 h-1.5 bg-amber-400 rounded-full" />}
      </Label>
      <div className="flex items-center gap-1.5 min-w-0">
        <Input
          value={value}
          onChange={e => onChange(e.target.value)}
          className={`h-9 text-sm font-mono flex-1 min-w-0 ${modified ? 'border-amber-400' : ''}`}
        />
        {modified && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => onChange(defaultValue)}
            title={`Reset to default${defaultValue ? `: ${defaultValue}` : ''}`}
          >
            <RotateCcw className="w-4 h-4" />
          </Button>
        )}
        <CopyButton text={value.trim()} label={`Copy ${label}`} />
      </div>
      {(error || hint) && (
        <div className={`sm:col-start-2 text-xs ${error ? 'text-red-500' : 'text-muted-foreground'}`}>
          {error ?? hint}
        </div>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b pb-1.5 mt-1">
      {children}
    </h4>
  );
}

export function SodaxSettingsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { solverEnvironment, sodaxSettings, applySodaxSettings } = useAppStore();
  const [draft, setDraft] = useState<Draft>(() => seedDraft(solverEnvironment, sodaxSettings));

  // Re-seed from the store every time the modal opens, so Cancel/ESC never leaks a stale draft.
  useEffect(() => {
    if (open) {
      setDraft(seedDraft(useAppStore.getState().solverEnvironment, useAppStore.getState().sodaxSettings));
    }
  }, [open]);

  const errors = useMemo(() => validateDraft(draft), [draft]);
  const hasErrors = Object.keys(errors).length > 0;

  const defaults = defaultsFor(draft.env, effectiveGateway(draft.apiBaseUrl));
  const autoSubmitTx = defaultUseBackendSubmitTx(effectiveSolverEndpoint(draft));
  const submitTxMismatch = draft.useBackendSubmitTx === 'on' && !autoSubmitTx;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(prev => ({ ...prev, [key]: value }));

  // Untouched fields (still showing the old env's default) follow the new env's default.
  const handleEnvChange = (env: SolverEnv) => {
    setDraft(prev => {
      const gateway = effectiveGateway(prev.apiBaseUrl);
      const prevDefaults = defaultsFor(prev.env, gateway);
      const nextDefaults = defaultsFor(env, gateway);
      const next = { ...prev, env };
      for (const field of TEXT_FIELDS) {
        if (prev[field].trim() === prevDefaults[field]) {
          next[field] = nextDefaults[field];
        }
      }
      return next;
    });
  };

  // A swaps URL still at its gateway-inherited default follows the new gateway instead of
  // becoming an explicit override pinned to the old one.
  const handleGatewayChange = (apiBaseUrl: string) => {
    setDraft(prev => {
      const next = { ...prev, apiBaseUrl };
      const prevDefault = defaultsFor(prev.env, effectiveGateway(prev.apiBaseUrl)).swapsApiBaseUrl;
      if (prev.swapsApiBaseUrl.trim() === prevDefault) {
        next.swapsApiBaseUrl = defaultsFor(prev.env, effectiveGateway(apiBaseUrl)).swapsApiBaseUrl;
      }
      return next;
    });
  };

  const handleSave = () => {
    if (hasErrors) return;
    applySodaxSettings(draft.env, draftToSettings(draft));
    onOpenChange(false);
  };

  const handleReset = () => {
    setDraft(prev => ({ ...prev, useBackendSubmitTx: 'auto', ...defaultsFor(prev.env) }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b">
          <DialogTitle>Sodax Settings</DialogTitle>
          <DialogDescription>
            The effective SDK config, ready to copy. Edit a value to override it — equal to its default (or cleared)
            keeps following the environment.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3">
          <div className="grid sm:grid-cols-[10rem_1fr] items-center gap-x-3 gap-y-1">
            <Label className="text-sm font-medium">Environment</Label>
            <Tabs value={draft.env} onValueChange={value => handleEnvChange(value as SolverEnv)}>
              <TabsList>
                <TabsTrigger value={SolverEnv.Staging}>Staging</TabsTrigger>
                <TabsTrigger value={SolverEnv.Production}>Production</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="grid sm:grid-cols-[10rem_1fr] items-center gap-x-3 gap-y-1">
            <Label className="text-sm font-medium">
              Backend submit-tx
              {draft.useBackendSubmitTx !== 'auto' && (
                <span className="ml-1.5 align-middle inline-block w-1.5 h-1.5 bg-amber-400 rounded-full" />
              )}
            </Label>
            <Select
              value={draft.useBackendSubmitTx}
              onValueChange={value => set('useBackendSubmitTx', value as SubmitTxChoice)}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (currently {autoSubmitTx ? 'on' : 'off'})</SelectItem>
                <SelectItem value="on">On — backend submit (2-step via swaps API)</SelectItem>
                <SelectItem value="off">Off — client-side relay to the solver</SelectItem>
              </SelectContent>
            </Select>
            <div className={`sm:col-start-2 text-xs ${submitTxMismatch ? 'text-amber-600' : 'text-muted-foreground'}`}>
              {submitTxMismatch
                ? 'Backend submit posts to the production swaps API — the selected solver never sees the intent and its /status stays NOT_FOUND.'
                : 'On: the swaps API relays and post-executes server-side. Off: client-side relay, /execute to the solver below.'}
            </div>
          </div>

          <SectionTitle>Solver</SectionTitle>

          <TextRow
            label="Solver API endpoint"
            value={draft.solverApiEndpoint}
            defaultValue={defaults.solverApiEndpoint}
            error={errors.solverApiEndpoint}
            hint="Quotes, /execute and /status go here."
            onChange={value => set('solverApiEndpoint', value)}
          />
          <TextRow
            label="Intents contract"
            value={draft.intentsContract}
            defaultValue={defaults.intentsContract}
            error={errors.intentsContract}
            onChange={value => set('intentsContract', value)}
          />
          <TextRow
            label="Protocol intents"
            value={draft.protocolIntentsContract}
            defaultValue={defaults.protocolIntentsContract}
            error={errors.protocolIntentsContract}
            onChange={value => set('protocolIntentsContract', value)}
          />

          <SectionTitle>API</SectionTitle>

          <TextRow
            label="Gateway base URL"
            value={draft.apiBaseUrl}
            defaultValue={defaults.apiBaseUrl}
            error={errors.apiBaseUrl}
            hint="Gateway root incl. version prefix. Moves data/bridge/swaps APIs — not sponsoring."
            onChange={handleGatewayChange}
          />
          <TextRow
            label="Swaps API base URL"
            value={draft.swapsApiBaseUrl}
            defaultValue={defaults.swapsApiBaseUrl}
            error={errors.swapsApiBaseUrl}
            hint="Retarget swaps alone. At its default it follows VITE_SWAPS_API_BASE_URL / the gateway."
            onChange={value => set('swapsApiBaseUrl', value)}
          />
          <TextRow
            label="API key"
            value={draft.apiKey}
            defaultValue={defaults.apiKey}
            hint={
              envSodaxApiKey
                ? 'x-api-key on every backend call. At its default it follows VITE_SODAX_API_KEY.'
                : 'x-api-key on every backend call. Keys typed here live in this browser only.'
            }
            onChange={value => set('apiKey', value)}
          />
          <TextRow
            label="Relayer endpoint"
            value={draft.relayerApiEndpoint}
            defaultValue={defaults.relayerApiEndpoint}
            error={errors.relayerApiEndpoint}
            hint="Used by the client-side relay path (backend submit-tx off)."
            onChange={value => set('relayerApiEndpoint', value)}
          />
        </div>

        <div className="px-6 py-4 border-t flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CopyButtonWithLabel text={draftToDebugJson(draft)} />
              <Button variant="outline" size="sm" onClick={handleReset}>
                Reset all
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="cherry" size="sm" onClick={handleSave} disabled={hasErrors}>
                Save
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground text-right">
            Saving re-creates the SDK instance and clears cached queries.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "Copy JSON" with the same copied feedback as the per-field button. */
function CopyButtonWithLabel({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable — nothing to do
    }
  };
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy} title="Copy the effective config as JSON">
      {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
      Copy JSON
    </Button>
  );
}
