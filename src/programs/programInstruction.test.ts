import { describe, expect, it } from 'vitest';
import { createDatabase } from '../server/db/database';
import { ProgramMappingService } from './programMappingStore';

describe('program instruction PDF metadata', () => {
  it('stores PDF metadata additively on program mappings without exposing a filesystem path in metadata', () => {
    const service = new ProgramMappingService(createDatabase(':memory:'));
    const mapping = service.create({ barcodePattern: 'ABC123', programNumber: 1, matchType: 'exact' }, 'ADM');

    expect(service.getInstructionMetadata(mapping.id)).toEqual({ exists: false, originalName: null, uploadedAt: null, uploadedBy: null, sizeBytes: null });

    service.setInstructionPdf(mapping.id, {
      storedName: 'safe-uuid.pdf',
      originalName: 'Instrukcja P01.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1234,
      uploadedBy: 'ADM',
    });

    const metadata = service.getInstructionMetadata(mapping.id);
    expect(metadata?.exists).toBe(true);
    expect(metadata?.originalName).toBe('Instrukcja P01.pdf');
    expect(metadata?.uploadedBy).toBe('ADM');
    expect(metadata?.sizeBytes).toBe(1234);
    expect(JSON.stringify(metadata)).not.toContain('safe-uuid.pdf');
  });

  it('removes PDF assignment without deleting the program mapping', () => {
    const service = new ProgramMappingService(createDatabase(':memory:'));
    const mapping = service.create({ barcodePattern: 'ABC123', programNumber: 1, matchType: 'exact' }, 'ADM');
    service.setInstructionPdf(mapping.id, { storedName: 'safe-uuid.pdf', originalName: 'Instrukcja.pdf', mimeType: 'application/pdf', sizeBytes: 10, uploadedBy: 'ADM' });

    service.removeInstructionPdf(mapping.id, 'ADM');

    expect(service.getInstructionMetadata(mapping.id)?.exists).toBe(false);
    expect(service.mapBarcode({ type: 'barcode_scan', barcode: 'ABC123', source: 'ui', scannedAt: '2026-01-01T00:00:00.000Z' }, {}).ok).toBe(true);
  });
});
