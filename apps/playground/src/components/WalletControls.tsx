import type { Execution } from '../hooks/useExecution';
import { Modal } from './Modal';

function familyName(type: string): string {
  return type === 'EVM' ? type : type.charAt(0) + type.slice(1).toLowerCase();
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletControls({ execution }: { execution: Execution }) {
  const e = execution;
  const connected = e.connectType === e.sourceType ? e.source : e.destination;
  return (
    <>
      <div className="wallet-row">
        <button
          type="button"
          className="btn"
          onClick={() => e.openConnect(e.sourceType)}
          disabled={!e.signable || !!e.phase}
        >
          {e.source?.address ? shortAddress(e.source.address) : 'Connect wallet'}
        </button>
        {e.sourceType !== e.destinationType && e.signable && (
          <button type="button" className="btn" onClick={() => e.openConnect(e.destinationType)} disabled={!!e.phase}>
            {e.destination?.address
              ? `Receive: ${shortAddress(e.destination.address)}`
              : `Connect ${familyName(e.destinationType)} to receive`}
          </button>
        )}
      </div>
      <Modal
        title={`Connect ${familyName(e.connectType ?? '')} wallet`}
        open={e.connectType !== undefined}
        onClose={e.closeConnect}
      >
        {connected?.address ? (
          <div className="modal-body">
            <p className="address-text">{connected.address}</p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (e.connectType) e.disconnect({ xChainType: e.connectType });
                e.closeConnect();
              }}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="wallet-list">
            <p className="muted small">Choose a wallet. Connecting does not move funds.</p>
            {e.connectors.length === 0 && (
              <p>
                No compatible wallet detected. Open this widget in your wallet’s browser or install a compatible wallet.
              </p>
            )}
            {e.connectors.map(connector => (
              <button
                type="button"
                className="btn wallet-option"
                key={connector.id}
                disabled={e.connection.status === 'connecting'}
                onClick={() => e.connection.connect(connector)}
              >
                {connector.icon && <img src={connector.icon} alt="" width="28" height="28" />}
                {connector.name}
                {e.connection.activeConnector?.id === connector.id &&
                  e.connection.status === 'connecting' &&
                  ' — waiting for wallet…'}
              </button>
            ))}
            {e.connection.status === 'error' && (
              <p className="alert" role="alert">
                {e.connection.error?.message}
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
