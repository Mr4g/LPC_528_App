import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('operator estimated leak UI wiring', () => {
  const mainSource = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');
  const chartSource = readFileSync(new URL('./components/PressureChart.tsx', import.meta.url), 'utf8');
  const stylesSource = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

  it('keeps estimated leak hidden behind LPC_ENABLE_ESTIMATED_LEAK_RATE', () => {
    expect(mainSource).toContain("frontendEnv.LPC_ENABLE_ESTIMATED_LEAK_RATE ?? 'false'");
    expect(mainSource).toContain('{estimatedLeakRateEnabled && (');
    expect(mainSource).toContain('Szacowany trend [Pa/s]');
  });

  it('keeps one stable RL metric card that switches live/final labels', () => {
    expect(mainSource).toContain('Ciśnienie [mbar]');
    expect(mainSource).toContain('Pomiar RL');
    expect(mainSource).toContain('RL live');
    expect(mainSource).toContain('Finalny RL');
    expect(mainSource).toContain('Live z ramki S / DPT');
    expect(mainSource).toContain('Finalny wynik z ramki R');
    expect(mainSource).toContain('Trend ciśnienia, nie wynik RL');
    expect((mainSource.match(/metric-card leak-live/g) ?? [])).toHaveLength(1);
  });

  it('labels DPT as proper measurement and EXH as exhaust without resetting the chart', () => {
    expect(mainSource).toContain("if (normalized === 'DPT') return 'Pomiar właściwy'");
    expect(mainSource).toContain("if (normalized === 'EXH') return 'Spuszczanie / wydech'");
    expect(mainSource).toContain("return normalized === 'DPT'");
    expect(mainSource).toContain('function toChartCurvePoints');
    expect(mainSource).toContain('buildChartRenderPoints(points)');
    expect(mainSource).toContain('applyChartPoints(nextPoints, false, payload.points.length)');
    expect(mainSource).toContain('liveCurveSignatureRef');
    expect(mainSource).toContain('CHART_RENDER_INTERVAL_MS = 250');
    expect(mainSource).toContain('VITE_DEBUG_CHART_PERF');
    expect(mainSource).toContain('[CHART_PERF]');
    expect(mainSource).toContain('Pomiar właściwy');
    expect(mainSource).toContain('Czas do końca fazy');
  });

  it('keeps the Y axis labels visible with a wider left plot margin', () => {
    expect(chartSource).toContain('left: 96');
    expect(chartSource).toContain('CHART_MAX_RENDER_POINTS = 120');
    expect(stylesSource).toContain('overflow: visible');
    expect(stylesSource).toContain('padding-left: 8px');
  });
});
