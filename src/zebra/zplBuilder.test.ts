import { describe, expect, it } from 'vitest';
import { buildResultLabelZpl } from './zplBuilder';
import type { ZebraLayoutConfig } from './zebraTypes';

const layout: ZebraLayoutConfig = { widthDots: 240, heightDots: 220, dpi: 203, labelOffsetX: 0, labelOffsetY: 0, textX: 0, textWidthDots: 240, copies: 1, fontLine1Height: 24, fontLine1Width: 24, fontLine2Height: 24, fontLine2Width: 24, fontLine3Height: 20, fontLine3Width: 20, line1Y: 40, line2Y: 75, line3Y: 110 };

describe('buildResultLabelZpl', () => {
  it('builds the verified three-line result label without a border', () => {
    const zpl = buildResultLabelZpl({ resultStatus: 'OK', testPressureLabel: '6 Bar', leakText: '7,253 pa/s', operatorLogin: 'GAZD', dateText: '30.06.2026' }, layout);
    expect(zpl).toContain('^XA');
    expect(zpl).toContain('^XZ');
    expect(zpl).toContain('^PW240');
    expect(zpl).toContain('^LL220');
    expect(zpl).toContain('^FO0,40^A0N,24,24');
    expect(zpl).toContain('^FO0,75^A0N,24,24');
    expect(zpl).toContain('^FO0,110^A0N,20,20');
    expect(zpl).not.toContain('^GB');
    expect(zpl).toContain('TEST OK - 6 Bar');
    expect(zpl).toContain('7,253 pa/s');
    expect(zpl).toContain('GAZD 30.06.2026');
  });
});
