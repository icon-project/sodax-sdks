import { tokenLogo } from '@sodax/dapp-kit';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { type PlaygroundChainKey, type TokenChoice, chainLogo, chainName } from '../lib/chains';
import { type AssetGroup, filterGroups } from '../lib/pickerOptions';
import { Glyph } from './AssetLogo';

/** A tile's corner mark: how many chains carry the asset, or — when only one does — which chain. */
type Mark = { kind: 'count'; value: number } | { kind: 'chain'; chain: PlaygroundChainKey };

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
        {mark?.kind === 'count' && <span className="tile-mark">{mark.value}</span>}
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
  toolbar,
  children,
}: {
  open: boolean;
  onClose: () => void;
  placeholder: string;
  query: string;
  onQueryChange: (value: string) => void;
  searchDisabled?: boolean;
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
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
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

export type AssetPickerProps = {
  open: boolean;
  onClose: () => void;
  groups: readonly AssetGroup[];
  networks: readonly PlaygroundChainKey[];
  selected: { chain: PlaygroundChainKey; symbol: string } | undefined;
  onSelect: (choice: TokenChoice) => void;
};

/**
 * The exchange's asset picker: a grid of assets rather than a list of every token-chain pair. One
 * tile per symbol, marked with how many chains carry it; picking a multi-chain asset asks which.
 */
export function AssetPicker({ open, onClose, groups, networks, selected, onSelect }: AssetPickerProps) {
  const [query, setQuery] = useState('');
  const [network, setNetwork] = useState<PlaygroundChainKey | undefined>();
  const [isNetworkOpen, setNetworkOpen] = useState(false);
  const [expanded, setExpanded] = useState<AssetGroup | undefined>();

  // Every open starts from the full grid; state left over from the last pick reads as a bug.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setNetwork(undefined);
    setNetworkOpen(false);
    setExpanded(undefined);
  }, [open]);

  const visible = useMemo(() => filterGroups(groups, query, network), [groups, query, network]);

  const pick = (choice: TokenChoice) => {
    onSelect(choice);
    onClose();
  };

  // A group filtered to one chain has already answered the question the drill-in would ask.
  const openGroup = (group: AssetGroup) => {
    const only = group.choices.length === 1 ? group.choices[0] : undefined;
    if (only) pick(only);
    else setExpanded(group);
  };

  if (expanded) {
    return (
      <Shell
        open={open}
        onClose={onClose}
        placeholder={`${expanded.symbol} — pick a network`}
        query=""
        onQueryChange={() => {}}
        searchDisabled
        toolbar={
          <button type="button" className="picker-toolbar" onClick={() => setExpanded(undefined)}>
            Back
          </button>
        }
      >
        <div className="tile-grid">
          {expanded.choices.map(choice => (
            <Tile
              key={choice.chain}
              logo={chainLogo(choice.chain)}
              alt={chainName(choice.chain)}
              label={chainName(choice.chain)}
              active={selected?.chain === choice.chain && selected.symbol === expanded.symbol}
              onClick={() => pick(choice)}
            />
          ))}
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      open={open}
      onClose={onClose}
      placeholder={isNetworkOpen ? 'Select a network' : 'Search assets…'}
      query={query}
      onQueryChange={setQuery}
      searchDisabled={isNetworkOpen}
      toolbar={
        <button
          type="button"
          className="picker-toolbar"
          aria-expanded={isNetworkOpen}
          onClick={() => setNetworkOpen(open => !open)}
        >
          {network ? chainName(network) : 'All networks'}
          <span aria-hidden="true">{isNetworkOpen ? '▲' : '▼'}</span>
        </button>
      }
    >
      {isNetworkOpen ? (
        <div className="network-list">
          <button
            type="button"
            className={network ? 'network-row' : 'network-row network-row-active'}
            onClick={() => {
              setNetwork(undefined);
              setNetworkOpen(false);
            }}
          >
            <span className="network-all" aria-hidden="true" />
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
      ) : visible.length === 0 ? (
        <p className="muted small picker-empty">No asset matches that search.</p>
      ) : (
        <div className="tile-grid">
          {visible.map(group => {
            const [first] = group.choices;
            if (!first) return null;
            return (
              <Tile
                key={group.symbol}
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
            );
          })}
        </div>
      )}
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
