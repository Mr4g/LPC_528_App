import { describe, expect, it } from 'vitest';
import { buildResultLabelZpl } from './zplBuilder';
import type { ZebraLayoutConfig } from './zebraTypes';

const layout: ZebraLayoutConfig = { labelWidthMm: 30, labelHeightMm: 8, dpi: 203, orientation: 'landscape', copies: 1, fontLine1: 16, fontLine2: 16, fontLine3: 13, line1Y: 7, line2Y: 25, line3Y: 43, offsetX: 0, offsetY: 0, frameThickness: 2 };

describe('buildResultLabelZpl', () => {
  it('builds a three-line result label with dimensions', () => {
    const zpl = buildResultLabelZpl({ resultStatus: 'OK', testPressureLabel: '6 Bar', leakText: '7,253 pa/s', operatorLogin: 'GAZD', dateText: '24.06.2026' }, layout);
    expect(zpl).toContain('^XA');
    expect(zpl).toContain('^XZ');
    expect(zpl).toContain('^PW');
    expect(zpl).toContain('^LL');
    expect(zpl).toContain('TEST OK - 6 Bar');
    expect(zpl).toContain('7,253 pa/s');
    expect(zpl).toContain('GAZD 24.06.2026');
  });
});
