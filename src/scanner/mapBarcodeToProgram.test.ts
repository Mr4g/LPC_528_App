import { describe, expect, it } from 'vitest';
import type { BarcodeScan } from '../shared/types';
import { mapBarcodeToProgram } from './mapBarcodeToProgram';

const map = {
  '5901234123457': 1,
  '7472475': 1,
  '7472476': 2,
  '7472477': 3,
};

function scan(barcode: string): BarcodeScan {
  return { type: 'barcode_scan', barcode, scannedAt: '2026-06-24T10:00:00.000Z', source: 'ui' };
}

describe('mapBarcodeToProgram', () => {
  it('uses exact match before contains match', () => {
    const result = mapBarcodeToProgram(scan('7472475'), map);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.currentTest.matchedKey).toBe('7472475');
      expect(result.currentTest.program).toBe(1);
      expect(result.programStartRequest.programText).toBe('P01');
    }
  });

  it('uses contains match when exact match is missing', () => {
    const result = mapBarcodeToProgram(scan('PREFIX-7472476-SUFFIX'), map);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.currentTest.matchedKey).toBe('7472476');
      expect(result.currentTest.program).toBe(2);
      expect(result.programStartRequest.programText).toBe('P02');
    }
  });

  it('returns NO_MAPPING when no key matches', () => {
    const result = mapBarcodeToProgram(scan('UNKNOWN'), map);

    expect(result).toEqual({ ok: false, error: 'NO_MAPPING', barcode: 'UNKNOWN', scannedAt: '2026-06-24T10:00:00.000Z' });
  });
});
