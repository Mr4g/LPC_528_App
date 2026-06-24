import type { LpcStreamPoint } from '../shared/types';

export class LpcTestBuffer {
  private points: LpcStreamPoint[] = [];

  constructor(private readonly limit: number, private readonly minElapsedStepSec: number) {}

  add(point: LpcStreamPoint): void {
    // TODO: Convert pressureValue in bar to mbar for chart points and enforce min elapsed step.
    void this.minElapsedStepSec;
    this.points.push(point);
    this.points = this.points.slice(-this.limit);
  }

  all(): LpcStreamPoint[] {
    return [...this.points];
  }
}
