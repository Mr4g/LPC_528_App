export type ThemeMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'lpc528-theme';

export function readStoredTheme(storage: Pick<Storage, 'getItem'> | null = typeof window !== 'undefined' ? window.localStorage : null): ThemeMode {
  const stored = storage?.getItem(THEME_STORAGE_KEY);
  return stored === 'dark' ? 'dark' : 'light';
}

export function persistTheme(theme: ThemeMode, storage: Pick<Storage, 'setItem'> | null = typeof window !== 'undefined' ? window.localStorage : null): void {
  storage?.setItem(THEME_STORAGE_KEY, theme);
}
