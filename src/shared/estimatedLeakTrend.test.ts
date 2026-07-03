import { describe, expect, it } from 'vitest';
import { calculateEstimatedLeakTrend, getLatestEstimatedLeakTrend, normalizeEstimatedLeakWindowPoints } from './estimatedLeakTrend';

describe('estimated leak trend', () => {
  it('calculates Pa/s from consecutive pressureBar and elapsedTimeSec points', () => {
    const trend = calculateEstimatedLeakTrend([
      { elapsedTimeSec: 1, pressureBar: 0.00100 },
      { elapsedTimeSec: 2, pressureBar: 0.00090 },
      { elapsedTimeSec: 4, pressureBar: 0.00070 },
    ], 10);

    expect(trend[0].estimatedLeakPaPerSec).toBeNull();
    expect(trend[1].estimatedLeakPaPerSec).toBeCloseTo(10);
    expect(trend[2].estimatedLeakPaPerSec).toBeCloseTo(10);
  });

  it('smooths estimated leak using the configured moving window', () => {
    const latest = getLatestEstimatedLeakTrend([
      { elapsedTimeSec: 1, pressureBar: 0.00100 },
      { elapsedTimeSec: 2, pressureBar: 0.00090 },
      { elapsedTimeSec: 3, pressureBar: 0.00070 },
    ], 2);

    expect(latest).toBeCloseTo(15);
  });

  it('ignores non-positive delta time and normalizes invalid window config', () => {
    expect(normalizeEstimatedLeakWindowPoints('bad')).toBe(10);
    expect(getLatestEstimatedLeakTrend([
      { elapsedTimeSec: 1, pressureBar: 0.001 },
      { elapsedTimeSec: 1, pressureBar: 0.0009 },
    ], 10)).toBeNull();
  });
});
