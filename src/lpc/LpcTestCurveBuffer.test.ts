import { describe, expect, it } from 'vitest';
import type { LpcStreamPoint } from '../shared/types';
import { LpcTestCurveBuffer } from './LpcTestCurveBuffer';

function streamPoint(elapsedTimeSec: number, pressureValue = 0.123): LpcStreamPoint {
  return {
    source: 'LPC-528',
    type: 'stream',
    receivedAt: '2026-06-24T10:00:00.000Z',
    messageId: String(elapsedTimeSec),
    messageType: 'S',
    channel: 'C01',
    program: 'P01',
    segment: 'PRF',
    elapsedTimeSec,
    remainingTimeSec: 10,
    pressureValue,
    pressureUnit: 'bar',
    pressureMbar: pressureValue * 1000,
    raw: '',
    normalized: '',
  };
}

describe('LpcTestCurveBuffer', () => {
  it('adds a point and converts bar to mbar', () => {
    const buffer = new LpcTestCurveBuffer();

    buffer.addStreamPoint(streamPoint(0.1, -0.00011));

    expect(buffer.getPoints()).toEqual([
      { elapsedTimeSec: 0.1, remainingTimeSec: 10, pressureBar: -0.00011, pressureMbar: -0.11, segment: 'PRF', messageId: '0.1' },
    ]);
  });

  it('samples by minimum elapsed step', () => {
    const buffer = new LpcTestCurveBuffer({ minElapsedStepSec: 0.1 });

    buffer.addStreamPoint(streamPoint(1.0));
    buffer.addStreamPoint(streamPoint(1.05));
    buffer.addStreamPoint(streamPoint(1.1));

    expect(buffer.getPoints()).toHaveLength(2);
    expect(buffer.getFullStreamPoints()).toHaveLength(3);
  });

  it('limits points to maxPoints', () => {
    const buffer = new LpcTestCurveBuffer({ maxPoints: 1000, minElapsedStepSec: 0 });

    for (let index = 0; index < 1005; index += 1) {
      buffer.addStreamPoint(streamPoint(index));
    }

    expect(buffer.getPoints()).toHaveLength(1000);
    expect(buffer.getSummary().pointCount).toBe(1000);
  });

  it('clears the buffer', () => {
    const buffer = new LpcTestCurveBuffer();
    buffer.addStreamPoint(streamPoint(0.1));

    buffer.clear();

    expect(buffer.getPoints()).toEqual([]);
    expect(buffer.getSummary().pointCount).toBe(0);
  });
});
