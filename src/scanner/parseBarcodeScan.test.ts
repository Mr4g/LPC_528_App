import { describe, expect, it } from 'vitest';
import { parseBarcodeScan } from './parseBarcodeScan';

describe('parseBarcodeScan', () => {
  it('removes CR/LF and trims barcode', () => {
    expect(parseBarcodeScan('\r\n 7472475 \n')?.barcode).toBe('7472475');
  });

  it('ignores empty strings', () => {
    expect(parseBarcodeScan(' \r\n ')).toBeNull();
  });

  it('ignores scanner startup messages', () => {
    expect(parseBarcodeScan('Listening on: COM3')).toBeNull();
  });
});
