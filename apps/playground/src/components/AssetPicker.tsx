import type { ChainKey } from '@sodax/dapp-kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import { chainName, type TokenChoice } from '../lib/chains';
import { type AssetGroup, searchChoices } from '../lib/pickerOptions';
import { canExecute } from '../lib/execution';
import { tokenId } from '../lib/widgetSettings';
import { AssetLogo } from './AssetLogo';

export type AssetPickerProps<K extends ChainKey = ChainKey> = {
  open: boolean;
  onClose: () => void;
  groups: readonly AssetGroup<K>[];
  networks: readonly K[];
  selected: { chain: K; symbol: string } | undefined;
  onSelect: (choice: TokenChoice<K>) => void;
};

export function AssetPicker<K extends ChainKey>({
  open,
  onClose,
  groups,
  networks,
  selected,
  onSelect,
}: AssetPickerProps<K>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [network, setNetwork] = useState<K>();
  useEffect(() => {
    if (open) {
      setQuery('');
      setNetwork(selected?.chain);
      if (!dialog.current?.open) dialog.current?.showModal();
      searchInput.current?.focus();
    } else dialog.current?.close();
  }, [open, selected?.chain]);
  const choices = useMemo(
    () =>
      searchChoices(
        groups.flatMap(group => group.choices),
        query,
        network,
      ),
    [groups, query, network],
  );
  return (
    <dialog
      ref={dialog}
      className="picker asset-picker-list"
      aria-label="Choose an asset"
      onClose={onClose}
      onClick={event => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="picker-body">
        <header className="row-between">
          <h3>Choose an asset</h3>
          <button type="button" className="btn picker-close" aria-label="Close asset picker" onClick={onClose}>
            ×
          </button>
        </header>
        <input
          ref={searchInput}
          className="input token-search"
          aria-label="Search assets"
          placeholder="Search name, symbol or address…"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        <select
          className="select"
          aria-label="Filter asset network"
          value={network ?? ''}
          onChange={event => setNetwork(networks.find(value => value === event.target.value))}
        >
          <option value="">All networks</option>
          {networks.map(chain => (
            <option value={chain} key={chain}>
              {chainName(chain)}
            </option>
          ))}
        </select>
        <div className="asset-results">
          {choices.map(choice => (
            <button
              key={tokenId(choice)}
              type="button"
              className="asset-result"
              aria-pressed={selected?.chain === choice.chain && selected.symbol === choice.token.symbol}
              onClick={() => {
                onSelect(choice);
                onClose();
              }}
            >
              <AssetLogo symbol={choice.token.symbol} chain={choice.chain} />
              <span className="asset-result-name">
                <strong>{choice.token.symbol}</strong>
                <span className="muted small">{choice.token.name}</span>
              </span>
              <span className="asset-result-network">
                {chainName(choice.chain)}
                {!canExecute(choice.chain) && <span className="muted small">Quote only</span>}
              </span>
            </button>
          ))}
          {!choices.length && (
            <p className="muted" role="status">
              No matching assets. Try another network or search.
            </p>
          )}
        </div>
      </div>
    </dialog>
  );
}
