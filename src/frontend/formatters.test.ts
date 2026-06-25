import { describe, expect, it } from 'vitest';
import { formatResultLabel, getConnectionLabel } from './formatters';

describe('frontend formatters', () => {
  it('formats LPC results for operators', () => {
    expect(formatResultLabel('ACCEPT')).toBe('OK');
    expect(formatResultLabel('REJECT')).toBe('NOK');
    expect(formatResultLabel('ERROR')).toBe('ERROR');
    expect(formatResultLabel('UNKNOWN')).toBe('UNKNOWN');
  });

  it('formats LPC connection status labels', () => {
    expect(getConnectionLabel('connected', true)).toBe('Połączony');
    expect(getConnectionLabel('error', false)).toBe('Błąd połączenia');
  });
});
