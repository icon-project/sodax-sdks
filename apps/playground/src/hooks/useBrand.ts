import { useCallback, useEffect, useMemo, useState } from 'react';
import { type Brand, NO_BRAND, type ThemeChoice, brandStyles, isBranded } from '../lib/brand';
import { initialUrl } from '../lib/initialUrl';

export type Theme = 'light' | 'dark';

/** Kept in sync with the pre-paint script in index.html, which owns the first resolution. */
export const THEME_STORAGE_KEY = 'sodax-playground-theme';

const STYLE_ID = 'sodax-brand';

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function storedTheme(): Theme | undefined {
  // An embed can run with site data blocked; resolution must still land on something.
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'dark' || stored === 'light' ? stored : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `?theme=light|dark` wins: in an embed the partner's page has already decided, and the visitor's
 * own stored preference is for our demo page, not for a widget inside someone else's product.
 * `auto` and an absent parameter fall through to that stored choice and then to the OS.
 */
export function resolveTheme(choice: ThemeChoice | undefined, systemDark: boolean): Theme {
  if (choice === 'light' || choice === 'dark') return choice;
  if (choice === 'auto') return systemDark ? 'dark' : 'light';
  return storedTheme() ?? (systemDark ? 'dark' : 'light');
}

/**
 * Writes the derived roles into one `<style>` in the head, last in the cascade so it outranks the
 * layer-2 defaults. Exported imperatively as well as through the hook because `index.tsx` applies
 * it before the first render — from an effect, a framed widget would paint our palette and then
 * the partner's.
 */
export function applyBrandStyles(css: string): void {
  const existing = document.getElementById(STYLE_ID);
  const element = existing ?? document.createElement('style');
  element.id = STYLE_ID;
  element.textContent = css;
  if (!existing) document.head.append(element);
}

export type BrandControls = ReturnType<typeof useBrand>;

/**
 * The theme and brand the widget is rendering under. One owner: this hook resolves the theme
 * attribute and the derived stylesheet, and the demo page's controls edit the same state, so a
 * visitor's tweak lands in the query string and the copied embed snippet carries it.
 */
export function useBrand() {
  const [brand, setBrand] = useState<Brand>(initialUrl.brand);
  const [systemDark, setSystemDark] = useState(prefersDark);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const theme = resolveTheme(brand.theme, systemDark);
  const { css, notes } = useMemo(() => brandStyles(brand), [brand]);

  useEffect(() => {
    applyBrandStyles(css);
  }, [css]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const update = useCallback(<K extends keyof Brand>(key: K, value: Brand[K]) => {
    // A pinned theme is also this page's own preference, so it survives a reload with no parameters.
    if (key === 'theme' && (value === 'light' || value === 'dark')) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, value);
      } catch {}
    }
    setBrand(previous => ({ ...previous, [key]: value }));
  }, []);

  const reset = useCallback(() => setBrand(NO_BRAND), []);

  return { brand, theme, notes, isBranded: isBranded(brand), update, reset };
}
