import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('scanner card UID guard', () => {
  const source = readFileSync(new URL('./scannerRouter.ts', import.meta.url), 'utf8');

  it('rejects card-shaped scans before barcode mapping or program start', () => {
    expect(source).toContain('CARD_UID_NOT_BARCODE');
    expect(source.indexOf('CARD_UID_NOT_BARCODE')).toBeLessThan(source.indexOf('programStarter.startProgram'));
    expect(source).toContain('options.config.CARD_UID_PATTERN');
  });
});
