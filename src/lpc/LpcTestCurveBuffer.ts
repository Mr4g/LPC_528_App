import type { LpcStreamPoint } from '../shared/types';

export interface LpcCurvePoint {
  elapsedTimeSec: number;
  remainingTimeSec: number | null;
  pressureBar: number | null;
  pressureMbar: number | null;
  segment: string;
}

export interface LpcCurveSummary {
  pointCount: number;
  firstElapsedTimeSec: number | null;
  lastElapsedTimeSec: number | null;
  minPressureMbar: number | null;
  maxPressureMbar: number | null;
}

export interface LpcTestCurveBufferOptions {
  maxPoints?: number;
  minElapsedStepSec?: number;
}

export class LpcTestCurveBuffer {
  private readonly maxPoints: number;
  private readonly minElapsedStepSec: number;
  private points: LpcCurvePoint[] = [];
  private lastStoredElapsedTimeSec: number | null = null;

  constructor(options: LpcTestCurveBufferOptions = {}) {
    this.maxPoints = options.maxPoints ?? 1000;
    this.minElapsedStepSec = options.minElapsedStepSec ?? 0.1;
  }

  addStreamPoint(point: LpcStreamPoint): LpcCurvePoint | null {
    if (point.elapsedTimeSec === null) return null;
    if (
      this.lastStoredElapsedTimeSec !== null
      && point.elapsedTimeSec - this.lastStoredElapsedTimeSec < this.minElapsedStepSec
    ) {
      return null;
    }

    const pressureBar = point.pressureValue;
    const curvePoint: LpcCurvePoint = {
      elapsedTimeSec: point.elapsedTimeSec,
      remainingTimeSec: point.remainingTimeSec,
      pressureBar,
      pressureMbar: pressureBar === null ? null : pressureBar * 1000,
      segment: point.segment,
    };

    this.points.push(curvePoint);
    this.lastStoredElapsedTimeSec = point.elapsedTimeSec;

    if (this.points.length > this.maxPoints) {
      this.points = this.points.slice(-this.maxPoints);
    }

    return curvePoint;
  }

  getPoints(): LpcCurvePoint[] {
    return [...this.points];
  }

  clear(): void {
    this.points = [];
    this.lastStoredElapsedTimeSec = null;
  }

  getSummary(): LpcCurveSummary {
    const pressureValues = this.points
      .map((point) => point.pressureMbar)
      .filter((value): value is number => value !== null);

    return {
      pointCount: this.points.length,
      firstElapsedTimeSec: this.points[0]?.elapsedTimeSec ?? null,
      lastElapsedTimeSec: this.points.at(-1)?.elapsedTimeSec ?? null,
      minPressureMbar: pressureValues.length ? Math.min(...pressureValues) : null,
      maxPressureMbar: pressureValues.length ? Math.max(...pressureValues) : null,
    };
  }
}
