import { readJson, writeJson } from '@/lib/storage';

// Persists the last picked swaps-api chain + token SYMBOL per leg so From/To restore on reload.
// Tokens come from the Swaps API token map (loaded async), so only the symbol is stored; SwapCard
// re-resolves the live SwapTokenV2 from the loaded map on that chain once it arrives.

const STORAGE_KEY = 'sodax-demo:swaps-api:last-selection';

export type StoredLeg = { chain: string; tokenSymbol: string };
export type StoredSwapsApiSelection = { src?: StoredLeg; dst?: StoredLeg };

export function loadSwapsApiSelection(): StoredSwapsApiSelection {
  return readJson<StoredSwapsApiSelection>(STORAGE_KEY) ?? {};
}

export function saveSwapsApiSelection(selection: StoredSwapsApiSelection): void {
  writeJson(STORAGE_KEY, selection);
}
