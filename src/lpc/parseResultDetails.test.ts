import { describe, expect, it } from 'vitest';
import { parseResultDetails } from './parseResultDetails';

describe('parseResultDetails', () => {
  it('splits result details and uses the first measurement as the main leak measurement', () => {
    const result = parseResultDetails(
      'No_barcode DPT P RL 10.787688 pa/s Pt 2.072516 bar EDC 0.000000 pa/s PL 108.005302 dPa LLR -7.994447 pa/s HLR 15.186239 pa/s FPR 2.083796 bar',
    );

    expect(result.barcodeFromResult).toBe('No_barcode');
    expect(result.testType).toBe('DPT');
    expect(result.testEvaluation).toBe('P');
    expect(result.measurements.RL).toEqual({ value: 10.787688, unit: 'Pa/s' });
    expect(result.measurements.Pt).toEqual({ value: 2.072516, unit: 'bar' });
    expect(result.measurements.EDC).toEqual({ value: 0, unit: 'Pa/s' });
    expect(result.measurements.PL).toEqual({ value: 108.005302, unit: 'dPa' });
    expect(result.measurements.LLR).toEqual({ value: -7.994447, unit: 'Pa/s' });
    expect(result.measurements.HLR).toEqual({ value: 15.186239, unit: 'Pa/s' });
    expect(result.measurements.FPR).toEqual({ value: 2.083796, unit: 'bar' });
    expect(result.leakType).toBe('RL');
    expect(result.leakValue).toBe(10.787688);
    expect(result.leakUnit).toBe('Pa/s');
  });

  it('keeps bar and mbar units from comma decimal result details', () => {
    expect(parseResultDetails('No_barcode DPT P RL 0,012 bar').leakUnit).toBe('bar');
    expect(parseResultDetails('No_barcode DPT P RL 12 mbar').leakUnit).toBe('mbar');
    expect(parseResultDetails('No_barcode DPT P RL 0,012 bar').leakValue).toBe(0.012);
  });
});
