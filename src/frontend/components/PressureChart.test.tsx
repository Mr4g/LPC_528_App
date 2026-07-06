import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PressureChart } from './PressureChart';

describe('PressureChart', () => {
  it('renders one continuous chart with fill, DPT and EXH phases plus RL tooltip data', () => {
    const html = renderToStaticMarkup(
      <PressureChart
        lastResult={null}
        points={[
          { elapsedTimeSec: 1, pressureMbar: 1000, pressureBar: 1, segment: 'FILL' },
          { elapsedTimeSec: Number.NaN, pressureMbar: Number.NaN, pressureBar: null, segment: 'BROKEN' },
          { elapsedTimeSec: 2, pressureMbar: 5990.978, pressureBar: 5.990978, segment: 'DPT', liveLeakValue: 3.788533, liveLeakUnit: 'Pa/s' },
          { elapsedTimeSec: 3, pressureMbar: 200, pressureBar: 0.2, segment: 'EXH' },
        ]}
      />,
    );

    expect(html).toContain('FILL');
    expect(html).toContain('Pomiar właściwy');
    expect(html).toContain('Spuszczanie / wydech');
    expect(html).toContain('segment-dpt');
    expect(html).toContain('segment-exh');
    expect(html).toContain('RL: 3,789 Pa/s');
    expect(html).not.toContain('BROKEN');
  });
});
