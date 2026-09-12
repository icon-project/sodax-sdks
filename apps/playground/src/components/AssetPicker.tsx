import { type ChainKey, tokenLogo } from '@sodax/dapp-kit';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { type PlaygroundChainKey, type TokenChoice, chainLogo, chainName } from '../lib/chains';
import { type AssetGroup, filterGroups, previewNetworks } from '../lib/pickerOptions';
import { Glyph } from './AssetLogo';

/** A tile's corner mark: how many chains carry the asset, or — when only one does — which chain. */
type Mark = { kind: 'count'; value: number } | { kind: 'chain'; chain: ChainKey };

function SearchGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function GridGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" fill="currentColor" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1" fill="currentColor" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" fill="currentColor" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="currentColor" />
    </svg>
  );
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="picker-chevron">
      <path
        d={up ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AllNetworksMark<K extends ChainKey>({ networks }: { networks: readonly K[] }) {
  return (
    <span className="all-networks-mark" aria-hidden="true">
      {previewNetworks(networks).map(key => (
        <Glyph key={key} className="all-networks-cell" src={chainLogo(key)} alt="" initial={chainName(key)} />
      ))}
    </span>
  );
}

function Tile({
  logo,
  alt,
  label,
  mark,
  active,
  onClick,
}: {
  logo: string;
  alt: string;
  label: string;
  mark?: Mark;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`tile${active ? ' tile-active' : ''}`} onClick={onClick}>
      <span className="tile-disc">
        <Glyph key={logo} className="tile-img" src={logo} alt={alt} initial={label} />
        {mark?.kind === 'count' && (
          <span className="tile-mark tile-mark-count">
            <span>{mark.value}</span>
          </span>
        )}
        {mark?.kind === 'chain' && (
          <Glyph
            key={chainLogo(mark.chain)}
            className="tile-mark tile-mark-chain"
            src={chainLogo(mark.chain)}
            alt={chainName(mark.chain)}
            initial={chainName(mark.chain)}
          />
        )}
      </span>
      <span className="tile-label">{label}</span>
    </button>
  );
}

function Shell({
  open,
  onClose,
  placeholder,
  query,
  onQueryChange,
  searchDisabled,
  leading,
  toolbar,
  children,
}: {
  open: boolean;
  onClose: () => void;
  placeholder: string;
  query: string;
  onQueryChange: (value: string) => void;
  searchDisabled?: boolean;
  leading?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog className="picker" ref={ref} onClose={onClose} onClick={event => event.target === ref.current && onClose()}>
      {/* Clicks inside land on this element, so the backdrop test above closes only on the backdrop. */}
      <div className="picker-body">
        <button type="button" className="picker-close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <div className="picker-search">
          {leading ?? <SearchGlyph />}
          <input
            autoFocus
            type="text"
            aria-label={placeholder}
            placeholder={placeholder}
            value={query}
            readOnly={searchDisabled}
            onChange={event => onQueryChange(event.target.value)}
          />
          {toolbar}
        </div>

        {children}
      </div>
    </dialog>
  );
}

export type AssetPickerProps<K extends ChainKey> = {
  open: boolean;
  onClose: () => void;
  groups: readonly AssetGroup<K>[];
  networks: readonly K[];
  selected: { chain: K; symbol: string } | undefined;
  onSelect: (choice: TokenChoice<K>) => void;
};

/**
 * Port of the exchange's asset picker. Not an import of sodax-frontend — that app pulls in Next,
 * Tailwind, and wallet balances, none of which belong here.
 */
export function AssetPicker<K extends ChainKey>({
  open,
  onClose,
  groups,
  networks,
  selected,
  onSelect,
}: AssetPickerProps<K>) {
  const [query, setQuery] = useState('');
  const [network, setNetwork] = useState<K | undefined>();
  const [isNetworkOpen, setNetworkOpen] = useState(false);
  const [expanded, setExpanded] = useState<AssetGroup<K> | undefined>();

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setNetwork(undefined);
    setNetworkOpen(false);
    setExpanded(undefined);
  }, [open]);

  const visible = useMemo(() => filterGroups(groups, query, network), [groups, query, network]);

  const pick = (choice: TokenChoice<K>) => {
    onSelect(choice);
    onClose();
  };

  const openGroup = (group: AssetGroup<K>) => {
    const only = group.choices.length === 1 ? group.choices[0] : undefined;
    if (only) {
      pick(only);
      return;
    }
    setNetworkOpen(false);
    setExpanded(current => (current?.symbol === group.symbol ? undefined : group));
  };

  const locked = isNetworkOpen || expanded !== undefined;

  const tiles = (
    <div className={`tile-grid${isNetworkOpen ? ' tile-grid-behind' : ''}${locked ? ' tile-grid-locked' : ''}`}>
      {visible.length === 0 ? (
        <p className="muted small picker-empty">No asset matches that search.</p>
      ) : (
        visible.map(group => {
          const [first] = group.choices;
          if (!first) return null;
          const isOpen = expanded?.symbol === group.symbol;
          return (
            <div
              key={group.symbol}
              className={`tile-cell${isOpen ? ' tile-cell-open' : ''}${expanded && !isOpen ? ' tile-cell-dim' : ''}`}
            >
              <Tile
                logo={tokenLogo(group.symbol)}
                alt={group.symbol}
                label={group.symbol}
                mark={
                  group.choices.length > 1
                    ? { kind: 'count', value: group.choices.length }
                    : { kind: 'chain', chain: first.chain }
                }
                active={selected?.symbol === group.symbol}
                onClick={() => openGroup(group)}
              />
              {isOpen && (
                <div className="chain-flyout" role="listbox" aria-label={`Networks for ${group.symbol}`}>
                  <p className="chain-flyout-caption">Choose a network</p>
                  <div className="chain-flyout-row">
                    {group.choices.map(choice => (
                      <button
                        key={choice.chain}
                        type="button"
                        className={`chain-flyout-icon${
                          selected?.chain === choice.chain && selected.symbol === group.symbol
                            ? ' chain-flyout-icon-active'
                            : ''
                        }`}
                        aria-label={chainName(choice.chain)}
                        onClick={() => pick(choice)}
                      >
                        <Glyph
                          key={chainLogo(choice.chain)}
                          className="chain-flyout-logo"
                          src={chainLogo(choice.chain)}
                          alt=""
                          initial={chainName(choice.chain)}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <Shell
      open={open}
      onClose={onClose}
      placeholder={isNetworkOpen ? 'Select a network' : 'Search assets…'}
      query={query}
      onQueryChange={setQuery}
      searchDisabled={isNetworkOpen}
      leading={isNetworkOpen ? <GridGlyph /> : <SearchGlyph />}
      toolbar={
        <button
          type="button"
          className="picker-toolbar"
          aria-expanded={isNetworkOpen}
          aria-label={network ? `Network: ${chainName(network)}` : 'All networks'}
          onClick={() => {
            setExpanded(undefined);
            setNetworkOpen(open => !open);
          }}
        >
          {network ? (
            <Glyph
              key={chainLogo(network)}
              className="picker-toolbar-chain"
              src={chainLogo(network)}
              alt=""
              initial={chainName(network)}
            />
          ) : (
            <AllNetworksMark networks={networks} />
          )}
          <Chevron up={isNetworkOpen} />
        </button>
      }
    >
      <div className={`picker-stage${isNetworkOpen ? ' picker-stage-sheet' : ''}`}>
        {tiles}
        {isNetworkOpen && (
          <div className="network-overlay" role="listbox" aria-label="Networks">
            <button
              type="button"
              className={network ? 'network-row' : 'network-row network-row-active'}
              onClick={() => {
                setNetwork(undefined);
                setNetworkOpen(false);
              }}
            >
              <AllNetworksMark networks={networks} />
              All
            </button>
            {networks.map(key => (
              <button
                key={key}
                type="button"
                className={key === network ? 'network-row network-row-active' : 'network-row'}
                onClick={() => {
                  setNetwork(key);
                  setNetworkOpen(false);
                }}
              >
                <Glyph
                  key={chainLogo(key)}
                  className="network-logo"
                  src={chainLogo(key)}
                  alt=""
                  initial={chainName(key)}
                />
                {chainName(key)}
              </button>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}

export type NetworkPickerProps = {
  open: boolean;
  onClose: () => void;
  networks: readonly PlaygroundChainKey[];
  selected: PlaygroundChainKey;
  onSelect: (chain: PlaygroundChainKey) => void;
};

/** The bridge's receive leg picks a network — the shared hub vault decides which asset arrives. */
export function NetworkPicker({ open, onClose, networks, selected, onSelect }: NetworkPickerProps) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? networks.filter(key => chainName(key).toLowerCase().includes(needle)) : networks;
  }, [networks, query]);

  return (
    <Shell open={open} onClose={onClose} placeholder="Search networks…" query={query} onQueryChange={setQuery}>
      {visible.length === 0 ? (
        <p className="muted small picker-empty">No network matches that search.</p>
      ) : (
        <div className="tile-grid">
          {visible.map(key => (
            <Tile
              key={key}
              logo={chainLogo(key)}
              alt={chainName(key)}
              label={chainName(key)}
              active={key === selected}
              onClick={() => {
                onSelect(key);
                onClose();
              }}
            />
          ))}
        </div>
      )}
    </Shell>
  );
}
