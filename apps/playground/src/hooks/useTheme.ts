import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

/** Kept in sync with the pre-paint script in index.html, which owns the first resolution. */
export const THEME_STORAGE_KEY = 'sodax-playground-theme';

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/**
 * Light/dark toggle. The initial value is whatever the pre-paint script resolved (stored choice,
 * else the OS preference), so this hook never has to guess and never causes a flash.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme(previous => {
      const next = previous === 'dark' ? 'light' : 'dark';
      // An embed can run with storage blocked; the toggle must still work for the session.
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {}
      return next;
    });
  }, []);

  return { theme, toggle };
}
