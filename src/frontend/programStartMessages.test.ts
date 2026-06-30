import { describe, expect, it } from 'vitest';
import { getProgramStartOperatorMessage } from './programStartMessages';

describe('getProgramStartOperatorMessage', () => {
  it('shows a clear mock mode warning', () => {
    expect(getProgramStartOperatorMessage({ attempted: true, success: true, mode: 'mock', message: 'mock' }, 'P01')).toContain('TRYB MOCK');
  });

  it('shows success for script mode', () => {
    expect(getProgramStartOperatorMessage({ attempted: true, success: true, mode: 'script', message: 'ok' }, 'P01')).toBe('Program P01 wysłany do LPC');
  });

  it('shows failure for script mode errors', () => {
    expect(getProgramStartOperatorMessage({ attempted: true, success: false, mode: 'script', message: 'fail' }, 'P01')).toBe('Błąd wysłania programu do LPC');
  });
});
