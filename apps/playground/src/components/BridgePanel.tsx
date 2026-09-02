import type { BridgeFlow } from '../hooks/useBridgeFlow';
import { type TokenChoice, bridgeableChains, chainName, tokenChoicesFor, txExplorerUrl } from '../lib/chains';
import { formatTokenAmount } from '../lib/format';
import { assetGroups } from '../lib/pickerOptions';
import { AssetPicker, NetworkPicker } from './AssetPicker';
import { AssetPanel, FlipButton } from './AssetPanel';

const BRIDGE_GROUPS = assetGroups(tokenChoicesFor('bridge'));

function shortenHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
}

function PrimaryAction({ flow }: { flow: BridgeFlow }) {
  const label = (text: string) => (
    <button type="button" className="btn btn-primary" disabled>
      {text}
    </button>
  );

  if (!flow.srcToken) return label('No tokens on this chain');
  if (flow.isLoadingRoute) return label('Finding the route…');
  if (!flow.hasRoute) return label(`${flow.srcToken.symbol} does not bridge to ${chainName(flow.dstChain)}`);
  if (!flow.isAmountValid) return label('Enter an amount');
  if (flow.exceedsLimit) return label('Amount is over the vault limit');

  if (!flow.canSign) return label('Quote-only deployment');
  if (!flow.isConnected) return label('Connect a wallet to bridge');

  if (flow.isWrongChain) {
    return (
      <button type="button" className="btn btn-primary" onClick={flow.handleSwitchChain}>
        Switch wallet to {chainName(flow.srcChain)}
      </button>
    );
  }

  if (flow.isCheckingAllowance) return label('Checking approval…');

  if (!flow.hasAllowance) {
    return (
      <button type="button" className="btn btn-primary" onClick={flow.approve} disabled={flow.isApproving}>
        {flow.isApproving ? 'Approving…' : `Approve ${flow.srcToken.symbol}`}
      </button>
    );
  }

  return (
    <button type="button" className="btn btn-primary" onClick={flow.executeBridge} disabled={flow.isBridging}>
      {flow.isBridging ? 'Bridging…' : `Bridge ${flow.srcToken.symbol} to ${chainName(flow.dstChain)}`}
    </button>
  );
}

export function BridgePanel({ flow }: { flow: BridgeFlow }) {
  const selectSend = (choice: TokenChoice) => {
    flow.setSrcChain(choice.chain);
    flow.setSrcToken(choice.token);
  };

  return (
    <section className="card swap-card">
      <AssetPanel
        symbol={flow.srcToken?.symbol}
        chain={flow.srcChain}
        emptyLabel="No tokens"
        pickerLabel="Asset to send"
        picker={state => (
          <AssetPicker
            {...state}
            groups={BRIDGE_GROUPS}
            networks={bridgeableChains}
            selected={flow.srcToken && { chain: flow.srcChain, symbol: flow.srcToken.symbol }}
            onSelect={selectSend}
          />
        )}
        amount={flow.amount}
        amountLabel="Amount to send"
        onAmountChange={flow.setAmount}
      />

      <FlipButton onClick={flow.flipDirection} />

      {/* The receive leg picks a network, not an asset: the shared hub vault decides what arrives. */}
      <AssetPanel
        symbol={flow.dstToken?.symbol}
        chain={flow.dstChain}
        emptyLabel={flow.isLoadingRoute ? 'Finding the route…' : 'No shared asset'}
        pickerLabel="Network to receive on"
        picker={state => (
          <NetworkPicker {...state} networks={bridgeableChains} selected={flow.dstChain} onSelect={flow.setDstChain} />
        )}
        amount={flow.receivedAmount}
        amountLabel="Amount to receive"
        note="1:1 — same asset, no quote"
      />

      {/* The capacity is only worth a reader's attention once they have exceeded it. */}
      {flow.exceedsLimit && (
        <p className="alert" role="alert">
          More than this route can move right now. The most it will take is {formatTokenAmount(flow.maxBridgeable)}{' '}
          {flow.srcToken?.symbol ?? ''}.
        </p>
      )}

      {flow.routeError && (
        <p className="alert" role="alert">
          {flow.routeError}
        </p>
      )}

      {flow.error && (
        <div className="alert" role="alert">
          {flow.error.message}
          {flow.error.detail && (
            <details>
              <summary>Underlying error</summary>
              <code>{flow.error.detail}</code>
            </details>
          )}
        </div>
      )}

      <PrimaryAction flow={flow} />

      {flow.delivery && (
        <div className="status-panel">
          <div className="row-between">
            <span className="muted">Deposit on {chainName(flow.delivery.srcChainKey)}</span>
            <a
              className="mono link"
              href={txExplorerUrl(flow.delivery.srcChainKey, flow.delivery.srcTxHash)}
              target="_blank"
              rel="noreferrer"
            >
              {shortenHash(flow.delivery.srcTxHash)} ↗
            </a>
          </div>
          <div className="row-between">
            <span className="muted">Settlement on {chainName(flow.hubChainKey)}</span>
            <a
              className="mono link"
              href={txExplorerUrl(flow.hubChainKey, flow.delivery.hubTxHash)}
              target="_blank"
              rel="noreferrer"
            >
              {shortenHash(flow.delivery.hubTxHash)} ↗
            </a>
          </div>
          <p className="muted small">
            The deposit locks the asset in the spoke vault; the hub tx is what releases it on the other side.
          </p>
        </div>
      )}
    </section>
  );
}
