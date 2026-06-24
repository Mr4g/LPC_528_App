import { describe, expect, it } from 'vitest';
import { isInterfaceSelectionPrompt, parseLpcResult, parseLpcStream } from './parser';

describe('LPC parser skeleton', () => {
  it('detects the interface selection prompt', () => {
    expect(isInterfaceSelectionPrompt('noise * 1 Interface Connection1 * more')).toBe(true);
  });

  it('keeps result parser placeholder explicit', () => {
    expect(parseLpcResult('F54D060 R C01 N1 P05 R-- 06:40:13.630 06/23/26 0000020041 SL - No_barcode DPT P RL 10.787688 pa/s')).toBeNull();
  });

  it('keeps stream parser placeholder explicit', () => {
    expect(parseLpcStream('9369034 S C01,P01,PRF,ET 5.20 sec,T 19.80 sec,P -0.00011 bar')).toBeNull();
  });
});
