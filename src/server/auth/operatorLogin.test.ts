import { describe, expect, it } from 'vitest';
import { normalizeOperatorLogin, validateOperatorLogin } from './operatorLogin';

describe('operator login validation', () => {
  it.each([
    ['ABC', true],
    ['AB', false],
    ['ABCDEF', false],
    ['A12', false],
    ['AB-', false],
    ['abc', true],
    ['ŁUK', false],
  ])('validates %s as %s', (login, expected) => {
    expect(validateOperatorLogin(login)).toBe(expected);
  });

  it('normalizes login to uppercase', () => {
    expect(normalizeOperatorLogin('abc')).toBe('ABC');
  });
});
