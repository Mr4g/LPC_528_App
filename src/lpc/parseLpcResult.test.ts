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
    expect(result?.RL_unit).toBe('Pa/s');
    expect(result?.Pt).toBe(2.072516);
    expect(result?.Pt_unit).toBe('bar');
    expect(result?.FPR).toBe(2.083796);
    expect(result?.FPR_unit).toBe('bar');
    expect(Object.keys(result?.measurements ?? {})).toEqual(['RL', 'Pt', 'EDC', 'PL', 'LLR', 'HLR', 'FPR']);
  });

  it('parses a final result frame even when the measurement unit is missing', () => {
    const result = parseLpcResult('F54D060 A C01 N1 P05 A-- 06:40:13.630 06/23/26 0000020041 SL - No_barcode DPT P RL 7,253');

    expect(result).not.toBeNull();
    expect(result?.result).toBe('ACCEPT');
    expect(result?.leakValue).toBe(7.253);
    expect(result?.leakUnit).toBeNull();
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

describe('parseLpcResult format 2', () => {
  it('parses short R result frame without allResultInformation', () => {
    const result = parseLpcResult('2BFC030 R C01 P17 15:34:00.830 07/03/26 0000293998 SB -', 2);

    expect(result).toMatchObject({
      lpcMessageId: '2BFC030',
      lpcMessageType: 'R',
      lpcChannel: 'C01',
      lpcProgram: 17,
      lpcProgramText: 'P17',
      lpcTesterTime: '15:34:00.830',
      lpcTesterDate: '07/03/26',
      lpcUniqueId: '0000293998',
      lpcProgramEvaluation: 'SB',
      lpcSpcFlag: '-',
      lpcAllResultInformation: null,
      resultRawStatus: 'SB',
      result: 'REJECT',
      resultFrameFormat: 2,
    });
  });

  it('parses optional allResultInformation', () => {
    const result = parseLpcResult('2BFC030 R C01 P17 15:34:00.830 07/03/26 0000293998 SB - ALL RESULT INFORMATION TEXT', 2);

    expect(result).toMatchObject({
      lpcAllResultInformation: 'ALL RESULT INFORMATION TEXT',
      resultRawStatus: 'SB',
    });
  });



  it('maps evaluation A to ACCEPT and parses measurements from allResultInformation', () => {
    const result = parseLpcResult('BD2A0D2 R C01 P17 15:58:45.620 07/03/26 0000294001 A - DPT P RL 2.664816 pa/s Pt 5.989275 bar EDC 0.000000 pa/s PL 32.298851 dPa LLR -4.623295 pa/s HLR 9.471334 pa/s FPR 5.991103 bar', 2);

    expect(result).toMatchObject({
      result: 'ACCEPT',
      value: 'ACCEPT',
      resultRawStatus: 'A',
      lpcProgramEvaluation: 'A',
      leakValue: 2.664816,
      leakUnit: 'Pa/s',
      RL: 2.664816,
      RL_unit: 'Pa/s',
      Pt: 5.989275,
      Pt_unit: 'bar',
      EDC: 0,
      EDC_unit: 'Pa/s',
      PL: 32.298851,
      PL_unit: 'dPa',
      LLR: -4.623295,
      LLR_unit: 'Pa/s',
      HLR: 9.471334,
      HLR_unit: 'Pa/s',
      FPR: 5.991103,
      FPR_unit: 'bar',
      measurements: {
        RL: { value: 2.664816, unit: 'Pa/s' },
        Pt: { value: 5.989275, unit: 'bar' },
        EDC: { value: 0, unit: 'Pa/s' },
        PL: { value: 32.298851, unit: 'dPa' },
        LLR: { value: -4.623295, unit: 'Pa/s' },
        HLR: { value: 9.471334, unit: 'Pa/s' },
        FPR: { value: 5.991103, unit: 'bar' },
      },
    });
  });

  it('maps configured SB to REJECT and keeps unknown evaluations as UNKNOWN without timeout', () => {
    expect(parseLpcResult('2BFC030 R C01 P17 15:34:00.830 07/03/26 0000293998 SB -', 2)).toMatchObject({ result: 'REJECT', resultRawStatus: 'SB' });
    expect(parseLpcResult('2BFC030 R C01 P17 15:34:00.830 07/03/26 0000293998 X -', 2)).toMatchObject({ result: 'UNKNOWN', resultRawStatus: 'X' });
  });

  it('does not parse short R result frame when format 1 is selected', () => {
    expect(parseLpcResult('2BFC030 R C01 P17 15:34:00.830 07/03/26 0000293998 SB -', 1)).toBeNull();
  });
});
