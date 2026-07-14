import { describe, expect, it } from 'vitest';
import { LPC_PROGRAM_OPTIONS } from './programOptions';

describe('LPC_PROGRAM_OPTIONS', () => {
  it('lists all LPC programs from 1 through 32', () => {
    expect(LPC_PROGRAM_OPTIONS).toHaveLength(32);
    expect(LPC_PROGRAM_OPTIONS[0]).toBe(1);
    expect(LPC_PROGRAM_OPTIONS.at(-1)).toBe(32);
  });
});
