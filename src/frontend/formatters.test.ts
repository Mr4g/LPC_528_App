import { describe, expect, it } from 'vitest';
import { formatMeasurement, formatResultLabel, getConnectionLabel, getResultDisplayLabel } from './formatters';

describe('frontend formatters', () => {
  it('formats LPC results for operators', () => {
    expect(formatResultLabel('ACCEPT')).toBe('OK');
    expect(formatResultLabel('REJECT')).toBe('NOK');
    expect(formatResultLabel('ERROR')).toBe('ERROR');
    expect(formatResultLabel('UNKNOWN')).toBe('UNKNOWN');
    expect(getResultDisplayLabel('ACCEPT')).toBe('OK');
  });

  it('formats measurements with units', () => {
    expect(formatMeasurement(10.7876, 'pa/s')).toBe('10,788 Pa/s');
    expect(formatMeasurement(0.012, 'bar')).toBe('0,012 bar');
    expect(formatMeasurement(12, 'mbar')).toBe('12 mbar');
    expect(formatMeasurement(12, null)).toBe('12');
  });

  it('formats LPC connection status labels', () => {
    expect(getConnectionLabel('connected', true)).toBe('Połączony');
    expect(getConnectionLabel('error', false)).toBe('Błąd połączenia');
  });
});
