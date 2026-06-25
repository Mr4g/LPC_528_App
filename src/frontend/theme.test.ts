import { describe, expect, it } from 'vitest';
import { persistTheme, readStoredTheme, THEME_STORAGE_KEY } from './theme';

describe('theme helpers', () => {
  it('defaults to light', () => {
    expect(readStoredTheme({ getItem: () => null })).toBe('light');
  });

  it('reads and persists dark theme', () => {
    const values = new Map<string, string>();
    persistTheme('dark', { setItem: (key, value) => values.set(key, value) });
    expect(values.get(THEME_STORAGE_KEY)).toBe('dark');
    expect(readStoredTheme({ getItem: (key) => values.get(key) ?? null })).toBe('dark');
  });
});
