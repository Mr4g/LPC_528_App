import type { BarcodeScan } from '../shared/types';

export function parseBarcodeScan(input: string): BarcodeScan | null {
  const barcode = input.replace(/[\r\n]/g, '').trim();

  if (!barcode) return null;
  if (barcode.startsWith('Listening on:')) return null;

  return {
    type: 'barcode_scan',
    barcode,
    scannedAt: new Date().toISOString(),
    source: 'ui',
  };
}
