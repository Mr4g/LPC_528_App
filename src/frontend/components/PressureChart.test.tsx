import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { isValidRlPoint, PressureChart } from './PressureChart';

describe('PressureChart', () => {
  it('renders one continuous chart with fill, DPT and EXH phases plus RL tooltip data', () => {
    const html = renderToStaticMarkup(
      <PressureChart
        lastResult={{ result: 'REJECT', leakValue: 11.686662, leakUnit: 'Pa/s', leakType: 'RL' } as never}
        points={[
          { elapsedTimeSec: 1, pressureMbar: 1000, pressureBar: 1, segment: 'FILL' },
          { elapsedTimeSec: 1.5, pressureMbar: 5996.863, pressureBar: 5.996863, segment: 'STG', liveLeakValue: null, RL: null },
          { elapsedTimeSec: Number.NaN, pressureMbar: Number.NaN, pressureBar: null, segment: 'BROKEN' },
          { elapsedTimeSec: 2, pressureMbar: 5990.978, pressureBar: 5.990978, segment: 'DPT', liveLeakValue: 3.788533, liveLeakUnit: 'Pa/s' },
          { elapsedTimeSec: 2.5, pressureMbar: 5990.5, pressureBar: 5.9905, segment: 'DPT', RL: 3.8, RL_unit: 'Pa/s' },
          { elapsedTimeSec: 3, pressureMbar: 200, pressureBar: 0.2, segment: 'EXH' },
        ]}
      />,
    );

    expect(html).toContain('FILL');
    expect(html).toContain('Stabilizacja');
    expect(html).toContain('Pomiar właściwy');
    expect(html).toContain('Spuszczanie / wydech');
    expect(html).toContain('segment-dpt');
    expect(html).toContain('segment-exh');
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
});
