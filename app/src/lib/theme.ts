import { useEffect, useState } from 'react';

export const THEME_STORAGE_KEY = 'osubb-theme';

export type Theme = 'light' | 'dark';

/**
 * Reads current theme from DOM attribute, localStorage, or system preference.
 * Defaults to 'light' if undetermined or storage is inaccessible.
 */
export function getTheme(): Theme {
  try {
    if (typeof document !== 'undefined') {
      const attr = document.documentElement.getAttribute('data-theme');
      if (attr === 'dark') return 'dark';
    }
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ) {
      return 'dark';
    }
  } catch {
    // Private mode, storage disabled — fallback to light
  }
  return 'light';
}

/**
 * Applies theme to DOM documentElement attribute and persists to localStorage.
 */
export function applyTheme(theme: Theme): void {
  try {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage write failed
  }
}

/**
 * Toggles the theme to its opposite, applies to DOM and returns new theme.
 */
export function toggleTheme(): Theme {
  const current = getTheme();
  const next: Theme = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}

/**
 * React hook providing current theme and controls to switch it.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getTheme);

  useEffect(() => {
    // Listen for system preference changes when not explicitly overridden
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;

    const handler = (e: MediaQueryListEvent) => {
      try {
        const saved = localStorage.getItem(THEME_STORAGE_KEY);
        if (!saved) {
          const next: Theme = e.matches ? 'dark' : 'light';
          applyTheme(next);
          setThemeState(next);
        }
      } catch {
        // storage disabled
      }
    };

    media.addEventListener?.('change', handler);
    return () => media.removeEventListener?.('change', handler);
  }, []);

  const toggle = () => {
    const next = toggleTheme();
    setThemeState(next);
  };

  const setTheme = (next: Theme) => {
    applyTheme(next);
    setThemeState(next);
  };

  return {
    theme,
    toggleTheme: toggle,
    setTheme,
  };
}
