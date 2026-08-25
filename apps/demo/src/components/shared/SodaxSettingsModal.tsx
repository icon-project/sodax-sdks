import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { SolverEnv, useAppStore } from '@/zustand/useAppStore';
import { defaultUseBackendSubmitTx, productionSolverConfig, stagingSolverConfig } from '@/constants';
import { envSodaxApiKey, envSwapsApiBaseUrl, isEvmAddress, isHttpUrl, type SodaxSettings } from '@/lib/sodaxSettings';

// Placeholder hints only — mirrors of the `@sodax/types` packaged defaults, which are not
// re-exported through dapp-kit. Effective config never reads these (the SDK applies its own).
const PLACEHOLDER_GATEWAY_URL = 'https://api.sodax.com/v1';
const PLACEHOLDER_RELAYER_URL = 'https://xcall-relay.nw.iconblockchain.xyz';

type SubmitTxChoice = 'auto' | 'on' | 'off';

/** Modal draft: free-text mirrors of SodaxSettings ('' = unset) plus the env choice. */
type Draft = {
  env: SolverEnv;
  useBackendSubmitTx: SubmitTxChoice;
  solverApiEndpoint: string;
  intentsContract: string;
  protocolIntentsContract: string;
  apiBaseUrl: string;
  swapsApiBaseUrl: string;
  apiKey: string;
  relayerApiEndpoint: string;
};

function seedDraft(env: SolverEnv, s: SodaxSettings): Draft {
  return {
    env,
    useBackendSubmitTx: s.useBackendSubmitTx === null ? 'auto' : s.useBackendSubmitTx ? 'on' : 'off',
    solverApiEndpoint: s.solverApiEndpoint ?? '',
    intentsContract: s.intentsContract ?? '',
    protocolIntentsContract: s.protocolIntentsContract ?? '',
    apiBaseUrl: s.apiBaseUrl ?? '',
    swapsApiBaseUrl: s.swapsApiBaseUrl ?? '',
    apiKey: s.apiKey ?? '',
    relayerApiEndpoint: s.relayerApiEndpoint ?? '',
  };
}

const URL_FIELDS = ['solverApiEndpoint', 'apiBaseUrl', 'swapsApiBaseUrl', 'relayerApiEndpoint'] as const;
const ADDRESS_FIELDS = ['intentsContract', 'protocolIntentsContract'] as const;

type FieldErrors = Partial<Record<(typeof URL_FIELDS)[number] | (typeof ADDRESS_FIELDS)[number], string>>;

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

/** '' → null (unset); validated values keep their narrowed types via the guards. */
function draftToSettings(draft: Draft): SodaxSettings {
  const url = (value: string) => {
    const trimmed = value.trim();
    return isHttpUrl(trimmed) ? trimmed : null;
  };
  const address = (value: string) => {
    const trimmed = value.trim();
    return isEvmAddress(trimmed) ? trimmed : null;
  };
  const apiKey = draft.apiKey.trim();
  return {
    useBackendSubmitTx: draft.useBackendSubmitTx === 'auto' ? null : draft.useBackendSubmitTx === 'on',
    solverApiEndpoint: url(draft.solverApiEndpoint),
    intentsContract: address(draft.intentsContract),
    protocolIntentsContract: address(draft.protocolIntentsContract),
    apiBaseUrl: url(draft.apiBaseUrl),
    swapsApiBaseUrl: url(draft.swapsApiBaseUrl),
    apiKey: apiKey.length > 0 ? apiKey : null,
    relayerApiEndpoint: url(draft.relayerApiEndpoint),
  };
}

function SettingsField({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
      {error ? (
        <span className="text-xs text-red-500">{error}</span>
      ) : hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h4 className="text-sm font-semibold text-cherry-dark">{children}</h4>;
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

  const envSolver = draft.env === SolverEnv.Staging ? stagingSolverConfig : productionSolverConfig;
  const autoSubmitTx = defaultUseBackendSubmitTx(draft.env);
  const submitTxOnStaging = draft.env === SolverEnv.Staging && draft.useBackendSubmitTx === 'on';

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(prev => ({ ...prev, [key]: value }));

  const handleSave = () => {
    if (hasErrors) return;
    applySodaxSettings(draft.env, draftToSettings(draft));
    onOpenChange(false);
  };

  const handleReset = () => {
    setDraft(prev => ({
      ...seedDraft(prev.env, {
        useBackendSubmitTx: null,
        solverApiEndpoint: null,
        intentsContract: null,
        protocolIntentsContract: null,
        apiBaseUrl: null,
        swapsApiBaseUrl: null,
        apiKey: null,
        relayerApiEndpoint: null,
      }),
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sodax Settings</DialogTitle>
          <DialogDescription>
            Overrides for the SDK config used by this demo. Empty fields use the shown defaults.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <SectionTitle>Solver</SectionTitle>

          <SettingsField label="Environment" hint="Also switchable via the tabs on the swap pages.">
            <Tabs value={draft.env} onValueChange={value => set('env', value as SolverEnv)}>
              <TabsList>
                <TabsTrigger value={SolverEnv.Staging}>Staging</TabsTrigger>
                <TabsTrigger value={SolverEnv.Production}>Production</TabsTrigger>
              </TabsList>
            </Tabs>
          </SettingsField>

          <SettingsField
            label="Solver API endpoint"
            hint="Quotes, /execute and /status go here. Overrides the environment's endpoint."
            error={errors.solverApiEndpoint}
          >
            <Input
              value={draft.solverApiEndpoint}
              onChange={e => set('solverApiEndpoint', e.target.value)}
              placeholder={envSolver.solverApiEndpoint}
              className="h-9 text-sm font-mono"
            />
          </SettingsField>

          <SettingsField label="Intents contract" error={errors.intentsContract}>
            <Input
              value={draft.intentsContract}
              onChange={e => set('intentsContract', e.target.value)}
              placeholder={envSolver.intentsContract}
              className="h-9 text-sm font-mono"
            />
          </SettingsField>

          <SettingsField label="Protocol intents contract" error={errors.protocolIntentsContract}>
            <Input
              value={draft.protocolIntentsContract}
              onChange={e => set('protocolIntentsContract', e.target.value)}
              placeholder={envSolver.protocolIntentsContract}
              className="h-9 text-sm font-mono"
            />
          </SettingsField>

          <Separator />
          <SectionTitle>Swaps</SectionTitle>

          <SettingsField
            label="Backend submit-tx"
            hint={
              submitTxOnStaging ? (
                <span className="text-amber-600">
                  Backend submit posts to the production swaps API — the staging solver never sees the intent and its
                  /status stays NOT_FOUND.
                </span>
              ) : (
                'On: the swaps API relays and post-executes server-side. Off: client-side relay, /execute to the solver above.'
              )
            }
          >
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
          </SettingsField>

          <Separator />
          <SectionTitle>API</SectionTitle>

          <SettingsField
            label="Gateway base URL"
            hint="Gateway root incl. version prefix, no service segment. Moves data/bridge/swaps APIs — not sponsoring."
            error={errors.apiBaseUrl}
          >
            <Input
              value={draft.apiBaseUrl}
              onChange={e => set('apiBaseUrl', e.target.value)}
              placeholder={PLACEHOLDER_GATEWAY_URL}
              className="h-9 text-sm font-mono"
            />
          </SettingsField>

          <SettingsField
            label="Swaps API base URL"
            hint="Retarget swaps alone (canary or a local swaps-api). Includes any version prefix."
            error={errors.swapsApiBaseUrl}
          >
            <Input
              value={draft.swapsApiBaseUrl}
              onChange={e => set('swapsApiBaseUrl', e.target.value)}
              placeholder={envSwapsApiBaseUrl ?? (draft.apiBaseUrl.trim() || PLACEHOLDER_GATEWAY_URL)}
              className="h-9 text-sm font-mono"
            />
          </SettingsField>

          <SettingsField
            label="API key"
            hint={
              envSodaxApiKey
                ? 'x-api-key on every backend call. Empty falls back to VITE_SODAX_API_KEY.'
                : 'x-api-key on every backend call. Keys typed here live in this browser only.'
            }
          >
            <Input
              value={draft.apiKey}
              onChange={e => set('apiKey', e.target.value)}
              placeholder={envSodaxApiKey ? '(from VITE_SODAX_API_KEY)' : 'sdx_…'}
              className="h-9 text-sm font-mono"
            />
          </SettingsField>

          <SettingsField
            label="Relayer API endpoint"
            hint="Used by the client-side relay path (backend submit-tx off)."
            error={errors.relayerApiEndpoint}
          >
            <Input
              value={draft.relayerApiEndpoint}
              onChange={e => set('relayerApiEndpoint', e.target.value)}
              placeholder={PLACEHOLDER_RELAYER_URL}
              className="h-9 text-sm font-mono"
            />
          </SettingsField>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" size="sm" onClick={handleReset}>
            Reset to defaults
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="cherry" size="sm" onClick={handleSave} disabled={hasErrors}>
              Save
            </Button>
          </div>
        </DialogFooter>
        <p className="text-xs text-muted-foreground text-right">
          Saving re-creates the SDK instance and clears cached queries.
        </p>
      </DialogContent>
    </Dialog>
  );
}
