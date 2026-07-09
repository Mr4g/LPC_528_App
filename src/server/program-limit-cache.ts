import { Router } from 'express';
import type { LimitCheckMetadata, LpcResult, ProgramLimitCacheEntry, ProgramLimitSnapshot } from '../shared/types';
import type { AppDatabase } from './db/database';
import { requireAuth, requireRole } from './auth/authMiddleware';

export function normalizeLimitUnit(unit: string | null | undefined): string | null {
  if (!unit) return null;
  return unit.trim().toLowerCase() === 'pa/s' ? 'Pa/s' : unit.trim();
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function cacheEntryToSnapshot(entry: ProgramLimitCacheEntry | null): ProgramLimitSnapshot | null {
  if (!entry) return null;
  return { source: 'cache', programText: entry.programText, programNumber: entry.programNumber, testType: entry.testType, HLR: entry.HLR, HLR_unit: entry.HLR_unit, LLR: entry.LLR, LLR_unit: entry.LLR_unit, sourceUniqueId: entry.sourceUniqueId, sourceResultAt: entry.sourceResultAt, updatedAt: entry.updatedAt };
}

export function resultToLimitSnapshot(result: Pick<LpcResult, 'programText' | 'program' | 'testType' | 'HLR' | 'HLR_unit' | 'LLR' | 'LLR_unit' | 'uniqueId' | 'messageId' | 'testerDate' | 'testerTime' | 'receivedAt'>): ProgramLimitSnapshot | null {
  const programText = result.programText ?? result.program;
  const testType = result.testType;
  const HLR = finiteOrNull(result.HLR);
  const LLR = finiteOrNull(result.LLR);
  if (!programText || !testType || (HLR === null && LLR === null)) return null;
  return { source: 'result_frame', programText, programNumber: programText.startsWith('P') ? Number(programText.slice(1)) : null, testType, HLR, HLR_unit: normalizeLimitUnit(result.HLR_unit), LLR, LLR_unit: normalizeLimitUnit(result.LLR_unit), uniqueId: result.uniqueId, messageId: result.messageId, sourceUniqueId: result.uniqueId, sourceResultMessageId: result.messageId, sourceTesterDate: result.testerDate, sourceTesterTime: result.testerTime, sourceResultAt: result.receivedAt, updatedAt: result.receivedAt };
}

export function buildLimitsMetadata(cachedAtStart: ProgramLimitSnapshot | null, fromResult: ProgramLimitSnapshot | null) {
  const changedDuringTest = cachedAtStart && fromResult
    ? cachedAtStart.HLR !== fromResult.HLR || cachedAtStart.HLR_unit !== fromResult.HLR_unit || cachedAtStart.LLR !== fromResult.LLR || cachedAtStart.LLR_unit !== fromResult.LLR_unit
    : null;
  return { cachedAtStart, fromResult, changedDuringTest };
}

export function buildLimitCheck(result: LpcResult, cachedAtStart: ProgramLimitSnapshot | null, fromResult: ProgramLimitSnapshot | null): LimitCheckMetadata {
  const value = finiteOrNull(result.RL ?? result.leakValue);
  const upperLimit = finiteOrNull(fromResult?.HLR) ?? finiteOrNull(cachedAtStart?.HLR);
  const lowerLimit = finiteOrNull(fromResult?.LLR) ?? finiteOrNull(cachedAtStart?.LLR);
  const source = fromResult ? 'result_frame' : cachedAtStart ? 'cache' : null;
  const exceededUpper = value !== null && upperLimit !== null ? value > upperLimit : null;
  const exceededLower = value !== null && lowerLimit !== null ? value < lowerLimit : null;
  return { measurement: 'RL', value, unit: normalizeLimitUnit(result.RL_unit ?? result.leakUnit), upperLimitName: 'HLR', upperLimit, upperLimitUnit: normalizeLimitUnit(fromResult?.HLR_unit ?? cachedAtStart?.HLR_unit), lowerLimitName: 'LLR', lowerLimit, lowerLimitUnit: normalizeLimitUnit(fromResult?.LLR_unit ?? cachedAtStart?.LLR_unit), source: source as LimitCheckMetadata['source'], exceededUpper, exceededLower, exceeded: exceededUpper === null && exceededLower === null ? null : Boolean(exceededUpper || exceededLower) };
}

export function createProgramLimitCacheRouter(database: AppDatabase): Router {
  const router = Router();
  router.use(requireAuth);
  router.get('/', requireRole(['admin', 'line_leader']), (_req, res) => res.json({ ok: true, limits: database.listProgramLimitCache() }));
  return router;
}
