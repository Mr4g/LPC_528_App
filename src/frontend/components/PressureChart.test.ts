import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildChartRenderPoints, buildTimeTicks, CHART_MAX_RENDER_POINTS, CHART_VISIBLE_WINDOW_SEC, getVisibleChartPoints, isValidRlPoint, PressureChart } from './PressureChart';

describe('PressureChart', () => {
  it('renders separate pressure/RL series until the last DPT and hides EXH from chart data', () => {
    const html = renderToStaticMarkup(
      React.createElement(PressureChart, {
        lastResult: { result: 'REJECT', leakValue: 11.686662, leakUnit: 'Pa/s', leakType: 'RL' } as never,
        points: [
          { elapsedTimeSec: 1, pressureMbar: 1000, pressureBar: 1, segment: 'FILL' },
          { elapsedTimeSec: 1.5, pressureMbar: 5996.863, pressureBar: 5.996863, segment: 'STG', liveLeakValue: null, RL: null },
          { elapsedTimeSec: Number.NaN, pressureMbar: Number.NaN, pressureBar: null, segment: 'BROKEN' },
          { elapsedTimeSec: 2, pressureMbar: 5990.978, pressureBar: 5.990978, segment: 'DPT', liveLeakValue: 3.788533, liveLeakUnit: 'Pa/s' },
          { elapsedTimeSec: 2.5, pressureMbar: 5990.5, pressureBar: 5.9905, segment: 'DPT', RL: 3.8, RL_unit: 'Pa/s' },
          { elapsedTimeSec: 3, pressureMbar: 200, pressureBar: 0.2, segment: 'EXH' },
        ],
      }),
    );

    expect(html).toContain('Napełnianie');
    expect(html).toContain('Stabilizacja');
    expect(html).toContain('Pomiar właściwy');
    expect(html).toContain('Ciśnienie [bar]');
    expect(html).toContain('7.00');
    expect(html).not.toContain('Spuszczanie / wydech');
    expect(html).toContain('segment-dpt');
    expect(html).not.toContain('segment-exh');
    expect(html).toContain('RL: 3,789 Pa/s');
    expect(html).toContain('RL [Pa/s]');
    expect(html).toContain('chart-axis-rl');
    expect(html).toContain('chart-rl-line');
    expect(html).not.toContain('RL: 0');
    expect(html).not.toContain('BROKEN');
  });

  it('validates RL points only for DPT finite RL samples', () => {
    expect(isValidRlPoint({ elapsedTimeSec: 1, pressureMbar: 1000, segment: 'STG', liveLeakValue: null })).toBe(false);
    expect(isValidRlPoint({ elapsedTimeSec: 2, pressureMbar: 5990, segment: 'EXH', RL: 3.1, RL_unit: 'Pa/s' })).toBe(false);
    expect(isValidRlPoint({ elapsedTimeSec: 3, pressureMbar: 5990, segment: 'DPT', liveLeakValue: 0, liveLeakUnit: 'Pa/s' })).toBe(true);
    expect(isValidRlPoint({ elapsedTimeSec: 4, pressureMbar: 5990, segment: 'DPT', liveLeakValue: Number.NaN, liveLeakUnit: 'Pa/s' })).toBe(false);
  });

  it('renders only the latest visible time window', () => {
    const points = Array.from({ length: 61 }, (_, elapsedTimeSec) => ({
      elapsedTimeSec,
      pressureMbar: 5000,
      pressureBar: 5,
      segment: elapsedTimeSec < 30 ? 'PRF' : 'DPT',
    }));

    const visible = getVisibleChartPoints(buildChartRenderPoints(points), CHART_VISIBLE_WINDOW_SEC);

    expect(visible[0].elapsedTimeSec).toBe(40);
    expect(visible.at(-1)?.elapsedTimeSec).toBe(60);
  });

  it('does not render a sticky zero tick after the visible X window moves forward', () => {
    expect(buildTimeTicks(0, 20, 5)).toContain(0);
    expect(buildTimeTicks(40, 60, 5)).toEqual([40, 45, 50, 55, 60]);
    expect(buildTimeTicks(40, 60, 5)).not.toContain(0);
  });

  it('anchors the final result label near the RL series instead of the pressure line', () => {
    const html = renderToStaticMarkup(
      React.createElement(PressureChart, {
        lastResult: { result: 'REJECT', leakValue: 3.8, leakUnit: 'Pa/s', leakType: 'RL' } as never,
        points: [
          { elapsedTimeSec: 40, pressureMbar: 5900, pressureBar: 5.9, segment: 'STG' },
          { elapsedTimeSec: 50, pressureMbar: 5990, pressureBar: 5.99, segment: 'DPT', liveLeakValue: 3.7, liveLeakUnit: 'Pa/s' },
          { elapsedTimeSec: 60, pressureMbar: 5991, pressureBar: 5.991, segment: 'DPT', liveLeakValue: 3.8, liveLeakUnit: 'Pa/s' },
        ],
      }),
    );

    const labelY = Number(html.match(/<foreignObject[^>]* y="([^"]+)"/)?.[1]);

    expect(labelY).toBeGreaterThan(100);
    expect(html).toContain('RL 3,8 Pa/s');
  });

  it('limits 1000 live points in the 20 second window to the render budget', () => {
    const points = Array.from({ length: 1000 }, (_, index) => ({
      elapsedTimeSec: 40 + (index * 20) / 999,
      pressureMbar: 5000 + index / 10,
      pressureBar: 5 + index / 10_000,
      segment: index < 450 ? 'STG' : 'DPT',
      liveLeakValue: index >= 450 && index % 12 === 0 ? 3 + index / 1000 : null,
      liveLeakUnit: index >= 450 && index % 12 === 0 ? 'Pa/s' : null,
    }));

    const chartPoints = buildChartRenderPoints(points);

    expect(chartPoints.length).toBeLessThanOrEqual(CHART_MAX_RENDER_POINTS);
    expect(chartPoints[0].elapsedTimeSec).toBe(40);
    expect(chartPoints.at(-1)?.elapsedTimeSec).toBe(60);
  });

  it('keeps the full short curve when it fits in the visible window', () => {
    const points = Array.from({ length: 11 }, (_, elapsedTimeSec) => ({ elapsedTimeSec, pressureMbar: 5000, pressureBar: 5, segment: 'STG' }));

    expect(buildChartRenderPoints(points)).toHaveLength(11);
  });

  it('downsamples render points while preserving edges, segment changes and RL samples', () => {
    const points = Array.from({ length: 600 }, (_, index) => ({
      elapsedTimeSec: index / 20,
      pressureMbar: 5000 + index,
      pressureBar: 5 + index / 10000,
      segment: index < 250 ? 'PRF' : 'DPT',
      liveLeakValue: index >= 250 && index % 20 === 0 ? 3.5 + index / 1000 : null,
      liveLeakUnit: index >= 250 && index % 20 === 0 ? 'Pa/s' : null,
    }));

    const chartPoints = buildChartRenderPoints(points);
    const firstDptPoint = chartPoints.find((point, index) => index > 0 && chartPoints[index - 1].segment !== 'DPT' && point.segment === 'DPT');
    const lastRenderedRlPoint = [...chartPoints].reverse().find((point) => point.segment === 'DPT' && Number.isFinite(point.liveLeakValue));

    expect(chartPoints.length).toBeLessThanOrEqual(CHART_MAX_RENDER_POINTS);
    expect(chartPoints[0].elapsedTimeSec).toBeGreaterThanOrEqual(9.95);
    expect(chartPoints.at(-1)?.elapsedTimeSec).toBe(599 / 20);
    expect(firstDptPoint).toBeDefined();
    expect(chartPoints.some((point) => point.segment === 'DPT' && point.liveLeakValue !== null)).toBe(true);
    expect(lastRenderedRlPoint?.elapsedTimeSec).toBe(29);
  });
});

it('renders cached HLR limit on the RL axis and hides it when absent', () => {
  const points = [
    { elapsedTimeSec: 1, pressureMbar: 5900, pressureBar: 5.9, segment: 'STG' },
    { elapsedTimeSec: 2, pressureMbar: 5990, pressureBar: 5.99, segment: 'DPT', liveLeakValue: 3.7, liveLeakUnit: 'Pa/s' },
  ];
  const withLimit = renderToStaticMarkup(React.createElement(PressureChart, { lastResult: null, points, limit: { source: 'cache', programText: 'P11', programNumber: 11, testType: 'DPT', HLR: 10.787688, HLR_unit: 'Pa/s', LLR: -7.191792, LLR_unit: 'Pa/s' } }));
  const withoutLimit = renderToStaticMarkup(React.createElement(PressureChart, { lastResult: null, points }));

  expect(withLimit).toContain('chart-hlr-limit');
  expect(withLimit).toContain('HLR 10,788 Pa/s');
  expect(withoutLimit).not.toContain('chart-hlr-limit');
});

it('renders compact Kontrola LL action before the chart legend for NOK-like results', () => {
  const points = [
    { elapsedTimeSec: 1, pressureMbar: 5900, pressureBar: 5.9, segment: 'STG' },
    { elapsedTimeSec: 2, pressureMbar: 5990, pressureBar: 5.99, segment: 'DPT', liveLeakValue: 3.7, liveLeakUnit: 'Pa/s' },
  ];
  const html = renderToStaticMarkup(React.createElement(PressureChart, { lastResult: { result: 'REJECT', leakValue: 12, leakUnit: 'Pa/s', leakType: 'RL', barcode: 'B1' } as never, points, llControlAction: { visible: true, message: 'Oznaczono do kontroli LL' } }));

  expect(html).toContain('Kontrola jakości:');
  expect(html).toContain('Kontrola LL');
  expect(html.indexOf('chart-quality-action')).toBeLessThan(html.indexOf('chart-legend'));
});
