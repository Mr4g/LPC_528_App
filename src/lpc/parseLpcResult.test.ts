import { describe, expect, it } from 'vitest';
import { normalizeLpcLine } from './normalizeLpcLine';
import { parseLpcResult } from './parseLpcResult';

const fullRejectFrame =
  'F54D060 R C01 N1 P05 R-- 06:40:13.630 06/23/26 0000020041 SL - No_barcode DPT P RL 10.787688 pa/s Pt 2.072516 bar EDC 0.000000 pa/s PL 108.005302 dPa LLR -7.994447 pa/s HLR 15.186239 pa/s FPR 2.083796 bar';

describe('parseLpcResult', () => {
  it('parses a full reject frame with message id and message type', () => {
    const result = parseLpcResult(fullRejectFrame);

    expect(result).not.toBeNull();
    expect(result?.source).toBe('LPC-528');
    expect(result?.messageId).toBe('F54D060');
    expect(result?.messageType).toBe('R');
    expect(result?.result).toBe('REJECT');
    expect(result?.value).toBe('REJECT');
    expect(result?.channel).toBe('C01');
    expect(result?.port).toBe('N1');
    expect(result?.program).toBe('P05');
    expect(result?.programText).toBe('P05');
    expect(result?.testerTime).toBe('06:40:13.630');
    expect(result?.testerDate).toBe('06/23/26');
    expect(result?.uniqueId).toBe('0000020041');
    expect(result?.totalAbs).toBe('SL');
    expect(result?.programEvaluation).toBe('-');
    expect(result?.spcFlag).toBe('-');
    expect(result?.barcodeFromResult).toBe('No_barcode');
    expect(result?.barcode).toBe('No_barcode');
    expect(result?.testType).toBe('DPT');
    expect(result?.testEvaluation).toBe('P');
    expect(result?.RL).toBe(10.787688);
    expect(result?.RL_unit).toBe('pa/s');
    expect(result?.Pt).toBe(2.072516);
    expect(result?.Pt_unit).toBe('bar');
    expect(result?.FPR).toBe(2.083796);
    expect(result?.FPR_unit).toBe('bar');
    expect(Object.keys(result?.measurements ?? {})).toEqual(['RL', 'Pt', 'EDC', 'PL', 'LLR', 'HLR', 'FPR']);
  });

  it('parses a frame without message id/type and derives result from linkInfo', () => {
    const result = parseLpcResult(
      'C01 N1 P05 R-- 06:40:13.630 06/23/26 0000020041 SL - No_barcode DPT P RL 10.787688 pa/s Pt 2.072516 bar',
    );

    expect(result?.messageId).toBeNull();
    expect(result?.messageType).toBeNull();
    expect(result?.linkInfo).toBe('R--');
    expect(result?.result).toBe('REJECT');
  });

  it('ignores menu, report, and backup lines', () => {
    expect(parseLpcResult('TCP/IP INTERFACE SELECTION')).toBeNull();
    expect(parseLpcResult('* 1 Interface Connection1 *')).toBeNull();
    expect(parseLpcResult('TREE ROOT')).toBeNull();
    expect(parseLpcResult('Q 29,C01 N1 P01 R-- 07:12:48.810 06/23/26 0000020048 SL - No_barcode')).toBeNull();
  });
});

describe('normalizeLpcLine', () => {
  it('removes carriage returns, tabs, arrows, extra spaces and trims', () => {
    expect(normalizeLpcLine('\r  C01\tN1  →  P05   R--  \r')).toBe('C01 N1 P05 R--');
  });
});
