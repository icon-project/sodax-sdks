import {
  ChainKeys,
  useSodaxContext,
  useStellarAccountStatus,
  useStellarTrustlineCheck,
  type ActivateStellarAccountResult,
} from '@sodax/dapp-kit';
import { useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';
import { useEffect, useState } from 'react';
import Card from '../components/Card';
import SponsorConfigPanel from '../components/SponsorConfigPanel';
import AccountFactsCard from '../components/journey/AccountFactsCard';
import ActivateStage from '../components/journey/ActivateStage';
import ActivationReceipt from '../components/journey/ActivationReceipt';
import FundStage from '../components/journey/FundStage';
import ReadyCard from '../components/journey/ReadyCard';
import StageProgress from '../components/journey/StageProgress';
import TrustlineStage from '../components/journey/TrustlineStage';
import { STAGE_TITLES, resolveJourney } from '../lib/journey';
import { parseStroops } from '../lib/format';
import { useLab } from '../lab/LabContext';
import { nativeTokenOption, stellarTokenOptions } from '../lib/stellarTokens';

const TOKEN_OPTIONS = stellarTokenOptions();
const NATIVE_OPTION = nativeTokenOption();

const DEFAULT_AMOUNT = '1';

/** Debounce because the amount is part of the Horizon query key. */
const AMOUNT_DEBOUNCE_MS = 400;

const POLL_INTERVAL_MS = 5_000;

export default function ShowcaseView() {
  const { address } = useXAccount({ xChainId: ChainKeys.STELLAR_MAINNET });
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.STELLAR_MAINNET });
  const { sodax } = useSodaxContext();
  const { resolved } = useLab();

  const [tokenAddress, setTokenAddress] = useState(TOKEN_OPTIONS[0]?.token.address ?? '');
  const [amountInput, setAmountInput] = useState(DEFAULT_AMOUNT);
  const [debouncedAmount, setDebouncedAmount] = useState(DEFAULT_AMOUNT);
  const [activation, setActivation] = useState<ActivateStellarAccountResult | undefined>(undefined);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedAmount(amountInput), AMOUNT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [amountInput]);

  const selected = TOKEN_OPTIONS.find(option => option.token.address === tokenAddress) ?? TOKEN_OPTIONS[0];
  const amountStroops = parseStroops(amountInput);
  const queryAmount = parseStroops(debouncedAmount);

  const requiresTrustline = !!selected && sodax.spoke.stellar.requiresTrustline(selected.token.address);

  const statusCheck = useStellarAccountStatus({
    params: { address },
    queryOptions: {
      // Poll only while funding is needed; otherwise Horizon polling would never stop.
      refetchInterval: query => {
        const status = query.state.data;
        if (!status) return false;
        return status.exists && !status.canAffordTrustline ? POLL_INTERVAL_MS : false;
      },
    },
  });

  const trustlineCheck = useStellarTrustlineCheck({
    params: {
      token: selected?.token.address,
      amount: queryAmount,
      chainId: ChainKeys.STELLAR_MAINNET,
      // Avoid caching a pre-activation 404; `hasSufficientTrustline` throws for absent accounts.
      walletAddress: statusCheck.data?.exists ? address : undefined,
    },
  });

  // Keep SDK gate ordering while exposing individual hooks and re-sign callbacks.
  const { gate, stages } = resolveJourney({ statusCheck, trustlineCheck, isNativeToken: !requiresTrustline });

  if (!address || !selected) {
    return (
      <Card>
        <p className="text-sm text-muted-foreground">Connect a Stellar wallet to begin.</p>
      </Card>
    );
  }

  const settled = !gate.blocksAction && (stages.trustline === 'done' || stages.trustline === 'skipped');
  const activeStage = stages.activate === 'done' ? (stages.fund === 'active' ? 'fund' : 'trustline') : 'activate';

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-6">
        <Card title="Activation journey">
          <StageProgress stages={stages} />
          <StageNotice
            statusError={statusCheck.error}
            trustlineError={trustlineCheck.error}
            blocked={gate.blocksAction}
          />
        </Card>

        {settled ? (
          <ReadyCard
            symbol={selected.token.symbol}
            isNative={!requiresTrustline}
            status={statusCheck.data}
            onReset={() => setTokenAddress(TOKEN_OPTIONS[0]?.token.address ?? '')}
          />
        ) : (
          <Card title={STAGE_TITLES[activeStage]}>
            {activeStage === 'activate' && (
              <ActivateStage
                address={address}
                walletProvider={walletProvider}
                status={stages.activate}
                onActivated={setActivation}
              />
            )}
            {activeStage === 'fund' && (
              <FundStage
                address={address}
                status={statusCheck}
                onSelectNative={() => NATIVE_OPTION && setTokenAddress(NATIVE_OPTION.token.address)}
              />
            )}
            {activeStage === 'trustline' && (
              <TrustlineStage
                option={selected}
                requiresTrustline={requiresTrustline}
                amountInput={amountInput}
                amountStroops={amountStroops}
                onAmountChange={setAmountInput}
                walletProvider={walletProvider}
                status={stages.trustline}
                blocksSpokeWrites={resolved.blocksSpokeWrites}
              />
            )}
          </Card>
        )}

        {activation && <ActivationReceipt result={activation} />}

        <Card title="Destination token">
          <select
            value={tokenAddress}
            onChange={event => setTokenAddress(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {TOKEN_OPTIONS.map(option => (
              <option key={option.token.address} value={option.token.address}>
                {option.token.symbol} — {option.token.name}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-muted-foreground">
            Sourced from <code>spokeChainConfig[stellar].supportedTokens</code>. Whether each needs a trustline comes
            from <code>requiresTrustline</code>, not the symbol.
          </p>
        </Card>
      </div>

      <div className="space-y-6">
        <AccountFactsCard address={address} statusCheck={statusCheck} />
        <SponsorConfigPanel />
        <GateMirror gate={gate} />
      </div>
    </div>
  );
}

function StageNotice({
  statusError,
  trustlineError,
  blocked,
}: {
  statusError: Error | null;
  trustlineError: Error | null;
  blocked: boolean;
}) {
  if (statusError) {
    return <p className="mt-3 text-xs text-destructive">Couldn’t read the account: {statusError.message}</p>;
  }
  if (trustlineError) {
    return <p className="mt-3 text-xs text-destructive">Couldn’t check the trustline: {trustlineError.message}</p>;
  }
  if (blocked) {
    return <p className="mt-3 text-xs text-muted-foreground">Resolving the next prerequisite…</p>;
  }
  return null;
}

function GateMirror({ gate }: { gate: ReturnType<typeof resolveJourney>['gate'] }) {
  const rows: readonly [string, boolean][] = [
    ['isStellar', gate.isStellar],
    ['needsActivation', gate.needsActivation],
    ['needsFunding', gate.needsFunding],
    ['needsTrustline', gate.needsTrustline],
    ['blocksAction', gate.blocksAction],
  ];

  return (
    <Card title="useStellarGate would report">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-mono text-muted-foreground">{label}</dt>
            <dd className={`text-right font-mono ${value ? 'text-primary' : 'text-muted-foreground'}`}>
              {String(value)}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
