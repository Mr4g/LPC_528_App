import { describe, expect, it } from 'vitest';
import { ProgramMappingService, formatProgramText } from './programMappingStore';
import { createDatabase } from '../server/db/database';

function scan(barcode: string) {
  return { type: 'barcode_scan' as const, barcode, source: 'ui' as const, scannedAt: '2026-01-01T00:00:00.000Z' };
}

describe('ProgramMappingService', () => {
  it('formats program numbers as LPC program text', () => {
    expect(formatProgramText(1)).toBe('P01');
  });

  it('prefers exact match over contains and ignores inactive mappings', () => {
    const service = new ProgramMappingService(createDatabase(':memory:'));
    service.create({ barcodePattern: '123', programNumber: 2, matchType: 'contains' }, 'ADM');
    service.create({ barcodePattern: 'ABC123', programNumber: 1, matchType: 'exact' }, 'ADM');
    const inactive = service.create({ barcodePattern: 'ABC123', programNumber: 9, matchType: 'exact' }, 'ADM');
    service.setActive(inactive.id, false, 'ADM');

    const result = service.mapBarcode(scan('ABC123'), {});

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.currentTest.programText).toBe('P01');
  });

  it('creates mappings with ok_only label printing by default', () => {
    const service = new ProgramMappingService(createDatabase(':memory:'));
    const mapping = service.create({ barcodePattern: 'XYZ123', programNumber: 1 }, 'ADM');

    expect(mapping.labelPrintMode).toBe('ok_only');
  });

  it('does not fall back to env mapping when the table only has inactive records', () => {
    const service = new ProgramMappingService(createDatabase(':memory:'));
    const inactive = service.create({ barcodePattern: 'ABC123', programNumber: 1, matchType: 'exact' }, 'ADM');
    service.setActive(inactive.id, false, 'ADM');

    const result = service.mapBarcode(scan('ABC123'), { ABC123: 9 });

    expect(result.ok).toBe(false);
  });
});
