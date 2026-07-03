import type { LpcStreamPoint } from '../shared/types';
import { isIgnoredLpcLine } from './lpcFrameFilters';
import { normalizeLpcLine } from './normalizeLpcLine';

const STREAM_REGEX = /^(\S+)\s+S\s+(C\d+),(P\d+),([^,]+),ET\s+([-+]?\d+(?:[.,]\d+)?)\s+sec,T\s+([-+]?\d+(?:[.,]\d+)?)\s+sec,P\s+([-+]?\d+(?:[.,]\d+)?)\s+(\S+)(?:,RL\s+([-+]?\d+(?:[.,]\d+)?)\s+(\S+))?$/;

function parseDecimal(value: string): number {
  return Number(value.replace(',', '.'));
}

function normalizeLeakUnit(unit: string | undefined): string | null {
  if (!unit) return null;
  return unit.toLowerCase() === 'pa/s' ? 'Pa/s' : unit;
}

export function parseLpcStream(raw: string): LpcStreamPoint | null {
  if (isIgnoredLpcLine(raw)) return null;

  const normalized = normalizeLpcLine(raw);
  const match = normalized.match(STREAM_REGEX);
  if (!match) return null;

  const [, messageId, channel, program, segment, elapsedTime, remainingTime, pressureValue, pressureUnit, liveLeakValue, liveLeakUnit] = match;
  const parsedPressureValue = parseDecimal(pressureValue);
  const parsedLiveLeakValue = liveLeakValue === undefined ? null : parseDecimal(liveLeakValue);
  const normalizedLiveLeakUnit = normalizeLeakUnit(liveLeakUnit);

  return {
    source: 'LPC-528',
    type: 'stream',
    receivedAt: new Date().toISOString(),
    messageId,
    messageType: 'S',
    channel,
    program,
    segment,
    elapsedTimeSec: parseDecimal(elapsedTime),
    remainingTimeSec: parseDecimal(remainingTime),
    pressureValue: parsedPressureValue,
    pressureUnit,
    pressureMbar: pressureUnit.toLowerCase() === 'bar' ? parsedPressureValue * 1000 : null,
    liveLeakValue: parsedLiveLeakValue,
    liveLeakUnit: normalizedLiveLeakUnit,
    RL: parsedLiveLeakValue,
    RL_unit: normalizedLiveLeakUnit,
    raw,
    normalized,
  };
}
