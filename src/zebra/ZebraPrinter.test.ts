import { describe, expect, it } from 'vitest';
import { shouldPrintForResult, ZebraPrinter } from './ZebraPrinter';
import type { LpcResult } from '../shared/types';

const result = { result: 'ACCEPT', value: 'ACCEPT', programText: 'P01', barcode: '5901234123457', leakValue: 7.253, leakUnit: 'pa/s', operatorLogin: 'GAZD' } as LpcResult;

describe('ZebraPrinter', () => {
  it('builds checked 240x220 ZPL without frame', () => {
    const zpl = new ZebraPrinter().buildResultLabel(result);
    expect(zpl).toContain('^PW240');
    expect(zpl).toContain('^LL220');
    expect(zpl).toContain('^FO0,40^A0N,24,24');
    expect(zpl).toContain('^FO0,75^A0N,24,24');
    expect(zpl).toContain('^FO0,110^A0N,20,20');
    expect(zpl).not.toContain('^GB');
  });

  it('applies labelPrintMode rules', () => {
    expect(shouldPrintForResult('ACCEPT', 'ok_only')).toBe(true);
    expect(shouldPrintForResult('REJECT', 'ok_only')).toBe(false);
    expect(shouldPrintForResult('ACCEPT', 'ok_and_nok')).toBe(true);
    expect(shouldPrintForResult('REJECT', 'ok_and_nok')).toBe(true);
  });
});
