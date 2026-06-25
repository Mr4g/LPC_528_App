import type { LpcResult } from '../../shared/types';
import { formatMeasurement, formatNumber, getResultBadgeClass, getResultDisplayLabel } from '../formatters';

export interface PressureChartPoint {
  elapsedTimeSec: number;
  pressureMbar: number | null;
  remainingTimeSec?: number | null;
  pressureBar?: number | null;
  segment?: string;
}

interface PressureChartProps {
  points: PressureChartPoint[];
  lastResult: LpcResult | null;
}

function buildTicks(min: number, max: number, count: number): number[] {
  if (count <= 1) return [min];
  const step = (max - min) / (count - 1 || 1);
  return Array.from({ length: count }, (_, index) => min + step * index);
}

export function PressureChart({ points, lastResult }: PressureChartProps) {
  const validPoints = points.filter((point) => point.pressureMbar !== null) as Array<PressureChartPoint & { pressureMbar: number }>;
  const hasLine = validPoints.length >= 2;
  const width = 930;
  const height = 420;
  const plot = { left: 62, top: 36, right: 900, bottom: 326 };
  const minX = validPoints.length ? Math.min(...validPoints.map((point) => point.elapsedTimeSec)) : 0;
  const maxX = validPoints.length ? Math.max(...validPoints.map((point) => point.elapsedTimeSec)) : 1;
  const rawMinY = validPoints.length ? Math.min(...validPoints.map((point) => point.pressureMbar)) : -1;
  const rawMaxY = validPoints.length ? Math.max(...validPoints.map((point) => point.pressureMbar)) : 1;
  const yPadding = Math.max((rawMaxY - rawMinY) * 0.18, 0.05);
  const minY = rawMinY - yPadding;
  const maxY = rawMaxY + yPadding;
  const xRange = maxX - minX || 1;
  const yRange = maxY - minY || 1;
  const xScale = (x: number) => plot.left + ((x - minX) / xRange) * (plot.right - plot.left);
  const yScale = (y: number) => plot.bottom - ((y - minY) / yRange) * (plot.bottom - plot.top);
  const polyline = validPoints.map((point) => `${xScale(point.elapsedTimeSec)},${yScale(point.pressureMbar)}`).join(' ');
  const finalPoint = validPoints.at(-1) ?? null;
  const finalClass = lastResult ? getResultBadgeClass(lastResult.result).replace('status-', 'chart-result-') : 'chart-result-unknown';
  const resultLabel = lastResult ? getResultDisplayLabel(lastResult.result) : null;
  const measurementLabel = lastResult ? `${lastResult.leakType ?? ''} ${formatMeasurement(lastResult.leakValue, lastResult.leakUnit)}`.trim() : null;
  const xTicks = buildTicks(minX, maxX, 5);
  const yTicks = buildTicks(minY, maxY, 5);

  return (
    <div className="chart-wrap">
      <svg className="pressure-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Ciśnienie w czasie">
        <line className="chart-axis" x1={plot.left} y1={plot.bottom} x2={plot.right} y2={plot.bottom} />
        <line className="chart-axis" x1={plot.left} y1={plot.top} x2={plot.left} y2={plot.bottom} />
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
        {hasLine && <polyline className="chart-pressure-line" points={polyline} />}
        {lastResult && finalPoint && (
          <g className={`chart-final-marker ${finalClass}`}>
            <line x1={xScale(finalPoint.elapsedTimeSec)} y1={plot.top} x2={xScale(finalPoint.elapsedTimeSec)} y2={plot.bottom} />
            <circle cx={xScale(finalPoint.elapsedTimeSec)} cy={yScale(finalPoint.pressureMbar)} r="9" />
            <foreignObject x={Math.min(xScale(finalPoint.elapsedTimeSec) + 14, plot.right - 190)} y={Math.max(yScale(finalPoint.pressureMbar) - 58, plot.top + 4)} width="190" height="76">
              <div className="chart-result-label">
                <strong>{resultLabel}</strong>
                <span>{measurementLabel}</span>
              </div>
            </foreignObject>
          </g>
        )}
        <text className="chart-label" x="430" y="382">Czas [s]</text>
        <text className="chart-label" x="80" y="26">Ciśnienie [mbar]</text>
      </svg>
      {validPoints.length === 0 && <div className="chart-empty">Brak danych z testu</div>}
      {lastResult && !finalPoint && (
        <div className={`chart-result-overlay ${finalClass}`}>
          <strong>{resultLabel}</strong>
          <span>{measurementLabel}</span>
        </div>
      )}
      <div className="chart-legend">
        <span><i className="legend-line" /> linia ciśnienia</span>
        <span><i className="legend-dot" /> punkt końcowy testu</span>
        <span><i className={`legend-result ${finalClass}`} /> wynik końcowy</span>
      </div>
    </div>
  );
}
