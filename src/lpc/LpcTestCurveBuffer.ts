import type { LpcStreamPoint } from '../shared/types';

export interface LpcCurvePoint {
  elapsedTimeSec: number;
  remainingTimeSec: number | null;
  pressureBar: number | null;
  pressureMbar: number | null;
  segment: string;
  liveLeakValue?: number | null;
  liveLeakUnit?: string | null;
  RL?: number | null;
  RL_unit?: string | null;
}

export interface LpcCurveSummary {
  pointCount: number;
  firstElapsedTimeSec: number | null;
  lastElapsedTimeSec: number | null;
  minPressureMbar: number | null;
  maxPressureMbar: number | null;
}

export interface LpcCurveSnapshot {
  points: LpcCurvePoint[];
  summary: LpcCurveSummary;
  completed: boolean;
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
  private lastCompletedPoints: LpcCurvePoint[] = [];
  private lastCompletedSummary: LpcCurveSummary = this.buildSummary([]);

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

    const liveLeakValue = point.liveLeakValue ?? point.RL ?? null;
    const liveLeakUnit = point.liveLeakUnit ?? point.RL_unit ?? null;
    if (liveLeakValue !== null) {
      curvePoint.liveLeakValue = liveLeakValue;
      curvePoint.RL = liveLeakValue;
    }
    if (liveLeakUnit !== null) {
      curvePoint.liveLeakUnit = liveLeakUnit;
      curvePoint.RL_unit = liveLeakUnit;
    }

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

  getSnapshot(): LpcCurveSnapshot {
    if (this.points.length > 0) {
      return { points: this.getPoints(), summary: this.getSummary(), completed: false };
    }

    return {
      points: [...this.lastCompletedPoints],
      summary: { ...this.lastCompletedSummary },
      completed: this.lastCompletedPoints.length > 0,
    };
  }

  completeAndClear(): LpcCurveSnapshot {
    this.lastCompletedPoints = this.getPoints();
    this.lastCompletedSummary = this.getSummary();
    const snapshot = { points: [...this.lastCompletedPoints], summary: { ...this.lastCompletedSummary }, completed: true };
    this.clearCurrent();
    return snapshot;
  }

  clear(): void {
    this.clearCurrent();
    this.lastCompletedPoints = [];
    this.lastCompletedSummary = this.buildSummary([]);
  }

  getSummary(): LpcCurveSummary {
    return this.buildSummary(this.points);
  }

  private clearCurrent(): void {
    this.points = [];
    this.lastStoredElapsedTimeSec = null;
  }

  private buildSummary(points: LpcCurvePoint[]): LpcCurveSummary {
    const pressureValues = points
      .map((point) => point.pressureMbar)
      .filter((value): value is number => value !== null);

    return {
      pointCount: points.length,
      firstElapsedTimeSec: points[0]?.elapsedTimeSec ?? null,
      lastElapsedTimeSec: points.at(-1)?.elapsedTimeSec ?? null,
      minPressureMbar: pressureValues.length ? Math.min(...pressureValues) : null,
      maxPressureMbar: pressureValues.length ? Math.max(...pressureValues) : null,
    };
  }
}
