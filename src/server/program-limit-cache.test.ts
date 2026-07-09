import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from './db/database';
import { buildLimitCheck, buildLimitsMetadata, normalizeLimitUnit, resultToLimitSnapshot } from './program-limit-cache';
import type { LpcResult } from '../shared/types';

function result(overrides: Partial<LpcResult> = {}): LpcResult {
  return { source: 'lpc', receivedAt: '2026-07-09T09:00:00.000Z', messageId: 'MSG1', messageType: 'R', channel: null, port: null, program: 'P11', programText: 'P11', linkInfo: null, result: 'REJECT', value: 'REJECT', testerTime: '10:00:00', testerDate: '07/09/26', uniqueId: 'UID1', totalAbs: null, programEvaluation: 'R', spcFlag: null, barcode: 'B1', barcodeFromResult: null, testType: 'DPT', testEvaluation: 'F', leakType: 'RL', leakValue: 11.815086, leakUnit: 'Pa/s', resultDetailsRaw: null, measurements: {}, RL: 11.815086, RL_unit: 'Pa/s', Pt: null, Pt_unit: null, EDC: null, EDC_unit: null, PL: null, PL_unit: null, LLR: -7.191792, LLR_unit: 'pa/s', HLR: 10.787688, HLR_unit: 'pa/s', FPR: null, FPR_unit: null, raw: '', normalized: '', ...overrides };
}

describe('program limit cache', () => {
  it('normalizes Pa/s units', () => {
    expect(normalizeLimitUnit('pa/s')).toBe('Pa/s');
    expect(normalizeLimitUnit('PA/S')).toBe('Pa/s');
  });

  it('creates, skips unchanged duplicate and updates changed limits', () => {
    const db = createDatabase(':memory:');
    const first = resultToLimitSnapshot(result())!;
    expect(db.upsertProgramLimitCache(first)).toMatchObject({ changed: true, created: true });
    expect(db.findProgramLimitCache('P11', 'DPT')?.HLR).toBe(10.787688);
    expect(db.upsertProgramLimitCache(first)).toMatchObject({ changed: false, created: false });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const updated = resultToLimitSnapshot(result({ HLR: 12, HLR_unit: 'Pa/s' }))!;
    expect(db.upsertProgramLimitCache(updated)).toMatchObject({ changed: true, created: false });
    console.log(`[LPC_LIMIT_CACHE] updated key=P11:DPT HLR ${first.HLR} ${first.HLR_unit} -> ${updated.HLR} ${updated.HLR_unit}`);
    expect(db.findProgramLimitCache('P11', 'DPT')?.HLR).toBe(12);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[LPC_LIMIT_CACHE] updated key=P11:DPT'));
    log.mockRestore();
  });

  it('uses a single program cache at start but does not guess ambiguous test types', () => {
    const db = createDatabase(':memory:');
    db.upsertProgramLimitCache(resultToLimitSnapshot(result())!);
    expect(db.findProgramLimitCacheForStart('P11')?.testType).toBe('DPT');
    db.upsertProgramLimitCache(resultToLimitSnapshot(result({ testType: 'XYZ', HLR: 9 }))!);
    expect(db.findProgramLimitCacheForStart('P11')).toBeNull();
  });

  it('builds limits metadata and limitCheck diagnostics', () => {
    const cached = resultToLimitSnapshot(result({ HLR: 10 }))!;
    const fromResult = resultToLimitSnapshot(result({ HLR: 12 }))!;
    expect(buildLimitsMetadata(cached, fromResult)).toMatchObject({ changedDuringTest: true });
    expect(buildLimitCheck(result({ RL: 13, leakValue: 13, HLR: 12 }), cached, fromResult)).toMatchObject({ exceededUpper: true, exceeded: true, source: 'result_frame' });
  });
});
