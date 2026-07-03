import type { LpcStreamPoint } from '../shared/types';
import { isIgnoredLpcLine } from './lpcFrameFilters';
import { normalizeLpcLine } from './normalizeLpcLine';

const STREAM_REGEX = /^(\S+)\s+S\s+(C\d{2}),(P\d{2}),([^,]+),ET\s+([-+]?\d+(?:[.,]\d+)?)\s+sec,T\s+([-+]?\d+(?:[.,]\d+)?)\s+sec,P\s+([-+]?\d+(?:[.,]\d+)?)\s+([a-zA-Z]+)$/;

function parseDecimal(value: string): number {
  return Number(value.replace(',', '.'));
}

export function parseLpcStream(raw: string): LpcStreamPoint | null {
  if (isIgnoredLpcLine(raw)) return null;

  const normalized = normalizeLpcLine(raw);
  const match = normalized.match(STREAM_REGEX);
  if (!match) return null;

  const [, messageId, channel, program, segment, elapsedTime, remainingTime, pressureValue, pressureUnit] = match;
  const parsedPressureValue = parseDecimal(pressureValue);

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
    raw,
    normalized,
  };
}
