import { describe, expect, it } from 'vitest';
import { buildResultLabelZpl } from './zplBuilder';
import type { ZebraLayoutConfig } from './zebraTypes';

const layout: ZebraLayoutConfig = { widthDots: 240, heightDots: 96, dpi: 203, labelOffsetX: 0, labelOffsetY: 0, textX: 0, textWidthDots: 240, copies: 1, fontLine1Height: 14, fontLine1Width: 14, fontLine2Height: 14, fontLine2Width: 14, fontLine3Height: 12, fontLine3Width: 12, line1Y: 4, line2Y: 30, line3Y: 56 };

describe('buildResultLabelZpl', () => {
  it('builds a three-line result label without a border', () => {
    const zpl = buildResultLabelZpl({ resultStatus: 'OK', testPressureLabel: '6 Bar', leakText: '7,253 pa/s', operatorLogin: 'GAZD', dateText: '30.06.2026' }, layout);
    expect(zpl).toContain('^XA');
    expect(zpl).toContain('^XZ');
    expect(zpl).toContain('^PW240');
    expect(zpl).toContain('^LL96');
    expect(zpl).not.toContain('^GB');
    expect(zpl).toContain('TEST OK - 6 Bar');
    expect(zpl).toContain('7,253 pa/s');
    expect(zpl).toContain('GAZD 30.06.2026');
  });
});
