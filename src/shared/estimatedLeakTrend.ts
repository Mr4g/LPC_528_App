export interface EstimatedLeakInputPoint {
  elapsedTimeSec: number | null;
  pressureBar: number | null;
}

export interface EstimatedLeakTrendPoint extends EstimatedLeakInputPoint {
  estimatedLeakPaPerSec: number | null;
}

export function normalizeEstimatedLeakWindowPoints(value: string | number | undefined, defaultValue = 10): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return defaultValue;
  return Math.floor(parsed);
}

export function calculateEstimatedLeakTrend(
  points: EstimatedLeakInputPoint[],
  windowPoints = 10,
): EstimatedLeakTrendPoint[] {
  const normalizedWindow = Math.max(1, Math.floor(windowPoints));
  const estimates: number[] = [];

  return points.map((point, index) => {
    const previous = index > 0 ? points[index - 1] : null;
    let instantEstimate: number | null = null;

    if (
      previous?.pressureBar !== null
      && previous?.pressureBar !== undefined
      && previous?.elapsedTimeSec !== null
      && previous?.elapsedTimeSec !== undefined
      && point.pressureBar !== null
      && point.pressureBar !== undefined
      && point.elapsedTimeSec !== null
      && point.elapsedTimeSec !== undefined
    ) {
      const deltaTimeSec = point.elapsedTimeSec - previous.elapsedTimeSec;
      if (deltaTimeSec > 0) {
        const deltaPressurePa = (previous.pressureBar - point.pressureBar) * 100000;
        instantEstimate = deltaPressurePa / deltaTimeSec;
        estimates.push(instantEstimate);
        if (estimates.length > normalizedWindow) estimates.shift();
      }
    }

    const estimatedLeakPaPerSec = instantEstimate === null || estimates.length === 0
      ? null
      : estimates.reduce((sum, value) => sum + value, 0) / estimates.length;

    return { ...point, estimatedLeakPaPerSec };
  });
}

export function getLatestEstimatedLeakTrend(
  points: EstimatedLeakInputPoint[],
  windowPoints = 10,
): number | null {
  return calculateEstimatedLeakTrend(points, windowPoints).at(-1)?.estimatedLeakPaPerSec ?? null;
}
