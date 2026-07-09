import { describe, expect, it } from 'vitest';
import { hasLlRole, requiresLlControl, resolvesLlControl, LL_OPEN } from './ll-control';
import { createDatabase } from './db/database';

describe('LL control status rules', () => {
  it('requires LL for NOK, REJECT and UNKNOWN only', () => {
    expect(requiresLlControl('NOK')).toBe(true);
    expect(requiresLlControl('REJECT')).toBe(true);
    expect(requiresLlControl('UNKNOWN')).toBe(true);
    expect(requiresLlControl('OK')).toBe(false);
    expect(requiresLlControl('TIMEOUT')).toBe(false);
  });

  it('resolves LL flags only for OK-like statuses', () => {
    expect(resolvesLlControl('OK')).toBe(true);
    expect(resolvesLlControl('ACCEPT')).toBe(true);
    expect(resolvesLlControl('PASS')).toBe(true);
    expect(resolvesLlControl('TIMEOUT')).toBe(false);
    expect(resolvesLlControl('NOK')).toBe(false);
  });

  it('allows only LL/admin to run flagged barcodes', () => {
    expect(hasLlRole('line_leader')).toBe(true);
    expect(hasLlRole('admin')).toBe(true);
    expect(hasLlRole('operator')).toBe(false);
  });
});


describe('LL control SQLite flags', () => {
  it('persists and resolves one active flag per barcode', () => {
    const db = createDatabase(':memory:');
    const flag = db.insertLlControlFlag({ id: 'flag-1', barcode: '7096630637770104', status: LL_OPEN, createdAt: '2026-07-09T07:00:00.000Z', updatedAt: '2026-07-09T07:00:00.000Z', createdByUserId: 'op-1', createdByLogin: 'OPR', createdByRole: 'operator', createdFromTestId: 'test-1', createdFromProgramText: 'P11', createdFromProgramNumber: 11, createdFromResultStatus: 'NOK', createdFromResultRawStatus: 'REJECT', createdFromLeakValue: 11.8, createdFromLeakUnit: 'Pa/s', createdFromUniqueId: 'UID-1', reason: 'Operator requested LL control after NOK' });
    expect(flag.barcode).toBe('7096630637770104');
    expect(db.findOpenLlControlFlag('7096630637770104')?.id).toBe('flag-1');
    const resolved = db.resolveLlControlFlag('7096630637770104', { resolvedByUserId: 'll-1', resolvedByLogin: 'LL1', resolvedByRole: 'line_leader', resolvedByTestId: 'test-2', resolvedByProgramText: 'P11', resolvedByProgramNumber: 11, resolvedByUniqueId: 'UID-2' });
    expect(resolved?.status).toBe('RESOLVED');
    expect(db.findOpenLlControlFlag('7096630637770104')).toBeNull();
  });
});
