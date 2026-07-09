import { useMemo } from 'react';
import type { LpcResult, ProgramLimitSnapshot } from '../../shared/types';
import { formatMeasurement, formatNumber, getResultBadgeClass, getResultDisplayLabel } from '../formatters';

export interface PressureChartPoint {
  elapsedTimeSec: number;
  pressureMbar: number | null;
  remainingTimeSec?: number | null;
  pressureBar?: number | null;
  segment?: string;
  liveLeakValue?: number | null;
  liveLeakUnit?: string | null;
  RL?: number | null;
  RL_unit?: string | null;
}

export type PressureChartPressurePoint = PressureChartPoint & {
  pressureBar: number;
  phaseLabel: string;
};

export const CHART_VISIBLE_WINDOW_SEC = 20;
// 120 points over a 20-second live window gives ~6 points/s, enough for the operator view while keeping SVG rendering light.
export const CHART_MAX_RENDER_POINTS = 120;

interface PressureChartProps {
  points: PressureChartPoint[];
  lastResult: LpcResult | null;
  limit?: ProgramLimitSnapshot | null;
}

function buildTicks(min: number, max: number, count: number): number[] {
  if (count <= 1) return [min];
  const step = (max - min) / (count - 1 || 1);
  return Array.from({ length: count }, (_, index) => min + step * index);
}

export function buildTimeTicks(min: number, max: number, count: number): number[] {
  const epsilon = 1e-9;
  const labels = new Set<string>();
  return buildTicks(min, max, count).filter((tick) => {
    if (tick < min - epsilon || tick > max + epsilon) return false;
    if (min > epsilon && Math.abs(tick) <= epsilon) return false;
    const label = formatNumber(tick, 1);
    if (labels.has(label)) return false;
    labels.add(label);
    return true;
  });
}

function getSegmentDisplay(segment: string | null | undefined): string {
  const normalized = segment?.trim().toUpperCase();
  if (normalized === 'PRF' || normalized === 'FGN' || normalized === 'FILL' || normalized === 'FIL') return 'Napełnianie';
  if (normalized === 'STG') return 'Stabilizacja';
  if (normalized === 'DPT') return 'Pomiar właściwy';
  if (normalized === 'EXH') return 'Spuszczanie / wydech';
  return segment?.trim() || '-';
}

function isChartPressureSegment(segment: string | null | undefined): boolean {
  return segment?.trim().toUpperCase() !== 'EXH';
}

function pressureBarValue(point: PressureChartPoint): number | null {
  if (Number.isFinite(point.pressureBar)) return point.pressureBar ?? null;
  if (Number.isFinite(point.pressureMbar)) return (point.pressureMbar ?? 0) / 1000;
  return null;
}

function isValidPressurePoint(point: PressureChartPoint | null | undefined): point is PressureChartPoint {
  return Boolean(
    point
    && Number.isFinite(point.elapsedTimeSec)
    && typeof point.segment === 'string'
    && point.segment.trim() !== ''
    && isChartPressureSegment(point.segment)
    && pressureBarValue(point) !== null,
  );
}

export function isValidRlPoint(point: PressureChartPoint | null | undefined): point is PressureChartPoint {
  const leakValue = point?.liveLeakValue ?? point?.RL ?? null;
  const leakUnit = point?.liveLeakUnit ?? point?.RL_unit ?? null;
  return Boolean(
    point
    && point.segment?.trim().toUpperCase() === 'DPT'
    && Number.isFinite(point.elapsedTimeSec)
    && Number.isFinite(leakValue)
    && (typeof leakUnit === 'string' && leakUnit.trim() !== ''),
  );
}

export function buildChartPressurePoints(points: PressureChartPoint[]): PressureChartPressurePoint[] {
  const allPressurePoints: PressureChartPressurePoint[] = points
    .filter(isValidPressurePoint)
    .map((point) => ({
      ...point,
      pressureBar: pressureBarValue(point) ?? 0,
      pressureMbar: Number.isFinite(point.pressureMbar) ? point.pressureMbar : (point.pressureBar ?? 0) * 1000,
      phaseLabel: getSegmentDisplay(point.segment),
    }));
  const lastDptElapsedSec = allPressurePoints.filter((point) => point.segment?.trim().toUpperCase() === 'DPT').at(-1)?.elapsedTimeSec ?? null;
  return lastDptElapsedSec === null
    ? allPressurePoints
    : allPressurePoints.filter((point) => point.elapsedTimeSec <= lastDptElapsedSec);
}

export function getVisibleChartPoints(points: PressureChartPressurePoint[], windowSec = CHART_VISIBLE_WINDOW_SEC): PressureChartPressurePoint[] {
  const latestElapsedTimeSec = points.at(-1)?.elapsedTimeSec ?? null;
  if (latestElapsedTimeSec === null) return [];
  const minElapsedTimeSec = Math.max(0, latestElapsedTimeSec - windowSec);
  return points.filter((point) => point.elapsedTimeSec >= minElapsedTimeSec && point.elapsedTimeSec <= latestElapsedTimeSec);
}

function hasLiveRl(point: PressureChartPoint): boolean {
  return Number.isFinite(point.liveLeakValue ?? point.RL ?? null);
}

function getLiveRlIndexes(points: PressureChartPressurePoint[]): number[] {
  const indexes: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    if (points[index].segment?.trim().toUpperCase() === 'DPT' && hasLiveRl(points[index])) indexes.push(index);
  }
  return indexes;
}

export function downsampleChartPoints(points: PressureChartPressurePoint[], maxPoints = CHART_MAX_RENDER_POINTS): PressureChartPressurePoint[] {
  if (points.length <= maxPoints) return points;
  const keep = new Set<number>([0, points.length - 1]);
  const rlIndexes = getLiveRlIndexes(points);
  const rlBudget = Math.max(1, Math.floor(maxPoints / 4));
  const leakStride = Math.max(1, Math.ceil(rlIndexes.length / rlBudget));
  const lastRlIndex = rlIndexes.at(-1);

  for (let index = 1; index < points.length; index += 1) {
    if (points[index].segment !== points[index - 1].segment) {
      keep.add(index - 1);
      keep.add(index);
    }
  }

  rlIndexes.forEach((index, rlIndex) => {
    if (rlIndex % leakStride === 0) keep.add(index);
  });
  if (lastRlIndex !== undefined) keep.add(lastRlIndex);

  if (keep.size < maxPoints) {
    const remainingSlots = maxPoints - keep.size;
    const step = Math.max(1, points.length / remainingSlots);
    for (let slot = 0; slot < remainingSlots && keep.size < maxPoints; slot += 1) {
      keep.add(Math.min(points.length - 1, Math.floor(slot * step)));
    }
  }

  if (keep.size > maxPoints) {
    const kept = [...keep].sort((a, b) => a - b);
    const sampled = new Set<number>([0, points.length - 1]);
    if (lastRlIndex !== undefined) sampled.add(lastRlIndex);
    const remainingSlots = Math.max(0, maxPoints - sampled.size);
    const step = remainingSlots > 0 ? kept.length / remainingSlots : kept.length;
    for (let slot = 0; slot < remainingSlots && sampled.size < maxPoints; slot += 1) {
      sampled.add(kept[Math.min(kept.length - 1, Math.floor(slot * step))]);
    }
    return [...sampled].sort((a, b) => a - b).map((index) => points[index]);
  }

  return [...keep].sort((a, b) => a - b).map((index) => points[index]);
}

export function buildChartRenderPoints(points: PressureChartPoint[]): PressureChartPressurePoint[] {
  return downsampleChartPoints(getVisibleChartPoints(buildChartPressurePoints(points)));
}

export function PressureChart({ points, lastResult, limit = null }: PressureChartProps) {
  const pressureSeries = useMemo(() => buildChartRenderPoints(points), [points]);
  const hasLine = pressureSeries.length >= 2;
  const width = 930;
  const height = 420;
  const plot = { left: 96, top: 36, right: 830, bottom: 326 };
  const liveRlSeries = pressureSeries
    .filter(isValidRlPoint)
    .map((point) => ({ ...point, leakValue: point.liveLeakValue ?? point.RL ?? null, leakUnit: point.liveLeakUnit ?? point.RL_unit ?? null }))
    .filter((point): point is typeof point & { leakValue: number } => Number.isFinite(point.leakValue));
  const finalPoint = pressureSeries.at(-1) ?? null;
  const finalRlPoint = lastResult?.leakValue !== null && lastResult?.leakValue !== undefined && Number.isFinite(lastResult.leakValue) && finalPoint
    ? { ...finalPoint, leakValue: lastResult.leakValue, leakUnit: lastResult.leakUnit ?? 'Pa/s', segment: 'FINAL' }
    : null;
  const rlSeries = finalRlPoint ? [...liveRlSeries, finalRlPoint] : liveRlSeries;
  const minX = pressureSeries.length ? Math.min(...pressureSeries.map((point) => point.elapsedTimeSec)) : 0;
  const maxX = pressureSeries.length ? Math.max(...pressureSeries.map((point) => point.elapsedTimeSec)) : 1;
  const maxPressure = pressureSeries.length ? Math.max(...pressureSeries.map((point) => point.pressureBar)) : 0;
  const minY = 0;
  const maxY = Math.max(7, Math.ceil((maxPressure + 0.2) * 2) / 2);
  const xRange = maxX - minX || 1;
  const yRange = maxY - minY || 1;
  const xScale = (x: number) => plot.left + ((x - minX) / xRange) * (plot.right - plot.left);
  const yScale = (y: number) => plot.bottom - ((y - minY) / yRange) * (plot.bottom - plot.top);
  const hlrLimit = Number.isFinite(lastResult?.HLR ?? null) ? { HLR: lastResult!.HLR, HLR_unit: lastResult!.HLR_unit } : limit;
  const hlrValue = Number.isFinite(hlrLimit?.HLR ?? null) ? hlrLimit!.HLR as number : null;
  const rlValuesForScale = [...rlSeries.map((point) => point.leakValue), ...(hlrValue !== null ? [hlrValue] : [])];
  const rawMinRl = rlValuesForScale.length ? Math.min(...rlValuesForScale) : 0;
  const rawMaxRl = rlValuesForScale.length ? Math.max(...rlValuesForScale) : 1;
  const rlPadding = Math.max((rawMaxRl - rawMinRl) * 0.18, 0.5);
  const minRl = rawMinRl - rlPadding;
  const maxRl = rawMaxRl + rlPadding;
  const rlRange = maxRl - minRl || 1;
  const rlScale = (value: number) => plot.bottom - ((value - minRl) / rlRange) * (plot.bottom - plot.top);
  const polyline = pressureSeries.map((point) => `${xScale(point.elapsedTimeSec)},${yScale(point.pressureBar)}`).join(' ');
  const rlPolyline = rlSeries.map((point) => `${xScale(point.elapsedTimeSec)},${rlScale(point.leakValue)}`).join(' ');
  const hlrY = hlrValue !== null ? rlScale(hlrValue) : null;
  const hlrLabel = hlrValue !== null ? `HLR ${formatMeasurement(hlrValue, hlrLimit?.HLR_unit ?? 'Pa/s', 3)}` : null;
  const latestLiveLeakPoint = [...liveRlSeries].reverse().find((point) => point.liveLeakValue !== null && point.liveLeakValue !== undefined) ?? null;
  const latestLiveLeakLabel = latestLiveLeakPoint
    ? `RL ${formatMeasurement(latestLiveLeakPoint.liveLeakValue, latestLiveLeakPoint.liveLeakUnit, 3)}`
    : null;
  const finalClass = lastResult ? getResultBadgeClass(lastResult.result).replace('status-', 'chart-result-') : 'chart-result-unknown';
  const resultLabel = lastResult ? getResultDisplayLabel(lastResult.result) : null;
  const measurementLabel = lastResult ? `${lastResult.leakType ?? ''} ${formatMeasurement(lastResult.leakValue, lastResult.leakUnit)}`.trim() : null;
  const finalResultAnchorPoint = finalRlPoint ?? liveRlSeries.at(-1) ?? null;
  const finalMarkerX = finalResultAnchorPoint ? xScale(finalResultAnchorPoint.elapsedTimeSec) : finalPoint ? xScale(finalPoint.elapsedTimeSec) : 0;
  const finalMarkerY = finalResultAnchorPoint ? rlScale(finalResultAnchorPoint.leakValue) : finalPoint ? yScale(finalPoint.pressureBar) : 0;
  const resultLabelWidth = 190;
  const resultLabelHeight = 76;
  const resultLabelX = finalPoint
    ? Math.min(
        Math.max(
          finalMarkerX + 14 > plot.right - resultLabelWidth - 8 ? finalMarkerX - resultLabelWidth - 14 : finalMarkerX + 14,
          plot.left + 8,
        ),
        plot.right - resultLabelWidth - 8,
      )
    : 0;
  const resultLabelY = finalPoint
    ? Math.min(Math.max(finalMarkerY - 58, plot.top + 4), plot.bottom - resultLabelHeight - 8)
    : 0;
  const xTicks = buildTimeTicks(minX, maxX, 5);
  const yTicks = buildTicks(minY, maxY, 5);
  const rlTicks = buildTicks(minRl, maxRl, 5);
  const phaseBadges = pressureSeries.reduce<Array<{ segment: string; label: string }>>((badges, point) => {
    const label = point.phaseLabel;
    if (!point.segment || badges.some((badge) => badge.label === label)) return badges;
    badges.push({ segment: point.segment, label });
    return badges;
  }, []);

  return (
    <div className="chart-wrap">
      {phaseBadges.length > 0 && (
        <div className="chart-phase-badges" aria-label="Fazy testu">
          {phaseBadges.map((badge) => <span key={badge.segment}>{badge.label}</span>)}
        </div>
      )}
      <svg className="pressure-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Ciśnienie w czasie">
        <line className="chart-axis" x1={plot.left} y1={plot.bottom} x2={plot.right} y2={plot.bottom} />
        <line className="chart-axis" x1={plot.left} y1={plot.top} x2={plot.left} y2={plot.bottom} />
        <line className="chart-axis chart-axis-rl" x1={plot.right} y1={plot.top} x2={plot.right} y2={plot.bottom} />
        {xTicks.map((tick) => (
          <g key={`x-${tick}`} className="chart-tick">
            <line x1={xScale(tick)} y1={plot.bottom} x2={xScale(tick)} y2={plot.bottom + 8} />
            <text x={xScale(tick)} y={plot.bottom + 28}>{formatNumber(tick, 1)}</text>
          </g>
        ))}
        {yTicks.map((tick) => (
          <g key={`y-${tick}`} className="chart-tick">
            <line x1={plot.left - 8} y1={yScale(tick)} x2={plot.left} y2={yScale(tick)} />
            <text x={plot.left - 12} y={yScale(tick) + 5} textAnchor="end">{formatNumber(tick, 2)}</text>
            <line className="chart-grid" x1={plot.left} y1={yScale(tick)} x2={plot.right} y2={yScale(tick)} />
          </g>
        ))}
        {rlTicks.map((tick) => (
          <g key={`rl-${tick}`} className="chart-tick chart-tick-rl">
            <line x1={plot.right} y1={rlScale(tick)} x2={plot.right + 8} y2={rlScale(tick)} />
            <text x={plot.right + 12} y={rlScale(tick) + 5}>{formatNumber(tick, 2)}</text>
          </g>
        ))}
        {hlrY !== null && (
          <g className="chart-hlr-limit">
            <line x1={plot.left} y1={hlrY} x2={plot.right} y2={hlrY} strokeDasharray="8 6" />
            <text x={plot.right - 8} y={Math.max(plot.top + 14, hlrY - 8)} textAnchor="end">{hlrLabel}</text>
          </g>
        )}
        {hasLine && <polyline className="chart-pressure-line" points={polyline} />}
        {rlSeries.length >= 2 && <polyline className="chart-rl-line" points={rlPolyline} />}
        {rlSeries.map((point) => (
          <circle key={`rl-${point.elapsedTimeSec}-${point.leakValue}`} className="chart-rl-point" cx={xScale(point.elapsedTimeSec)} cy={rlScale(point.leakValue)} r="4">
            <title>{`RL: ${formatMeasurement(point.leakValue, point.leakUnit, 3)}\nSegment: ${getSegmentDisplay(point.segment)}`}</title>
          </circle>
        ))}
        {pressureSeries.map((point) => {
          const leakValue = point.liveLeakValue ?? point.RL ?? null;
          const leakUnit = point.liveLeakUnit ?? point.RL_unit ?? null;
          const title = Number.isFinite(leakValue)
            ? `Ciśnienie: ${formatMeasurement(point.pressureBar, 'bar', 6)}\nRL: ${formatMeasurement(leakValue, leakUnit, 3)}\nSegment: ${point.phaseLabel}`
            : `Ciśnienie: ${formatMeasurement(point.pressureBar, 'bar', 6)}\nSegment: ${point.phaseLabel}`;
          return (
            <circle key={`${point.elapsedTimeSec}-${point.segment}-${point.pressureBar}`} className={`chart-point segment-${point.segment?.toLowerCase() ?? 'unknown'}`} cx={xScale(point.elapsedTimeSec)} cy={yScale(point.pressureBar)} r={point.segment === 'DPT' ? 4 : 3}>
              <title>{title}</title>
            </circle>
          );
        })}
        {lastResult && finalPoint && (
          <g className={`chart-final-marker ${finalClass}`}>
            <line x1={finalMarkerX} y1={plot.top} x2={finalMarkerX} y2={plot.bottom} />
            <circle cx={finalMarkerX} cy={finalMarkerY} r="9" />
            <foreignObject x={resultLabelX} y={resultLabelY} width={resultLabelWidth} height={resultLabelHeight}>
              <div className="chart-result-label">
                <strong>{resultLabel}</strong>
                <span>{measurementLabel}</span>
              </div>
            </foreignObject>
          </g>
        )}
        <text className="chart-label" x="430" y="382">Czas [s]</text>
        <text className="chart-label" x="80" y="26">Ciśnienie [bar]</text>
        <text className="chart-label chart-label-rl" x="806" y="26">RL [Pa/s]</text>
      </svg>
      {pressureSeries.length === 0 && <div className="chart-empty">Brak danych z testu</div>}
      {lastResult && !finalPoint && (
        <div className={`chart-result-overlay ${finalClass}`}>
          <strong>{resultLabel}</strong>
          <span>{measurementLabel}</span>
        </div>
      )}
      <div className="chart-legend">
        <span><i className="legend-line" /> linia ciśnienia</span>
        <span><i className="legend-rl-line" /> RL [Pa/s]</span>
        {hlrLabel && <span><i className="legend-hlr-line" /> {hlrLabel}</span>}
        <span><i className="legend-dot" /> punkt końcowy testu</span>
        <span><i className={`legend-result ${finalClass}`} /> wynik końcowy</span>
        {latestLiveLeakLabel && <span className="legend-live-rl">{latestLiveLeakPoint?.segment} {latestLiveLeakLabel}</span>}
      </div>
    </div>
  );
}
