import { describe, expect, it } from 'vitest';
import { parseLpcStream } from './parseLpcStream';

describe('parseLpcStream', () => {
  it('parses a valid stream frame with dot decimals', () => {
    const result = parseLpcStream('9369034 S C01,P01,PRF,ET 5.20 sec,T 19.80 sec,P -0.00011 bar');

    expect(result).toMatchObject({
      source: 'LPC-528',
      type: 'stream',
      messageId: '9369034',
      messageType: 'S',
      channel: 'C01',
      program: 'P01',
      segment: 'PRF',
      elapsedTimeSec: 5.2,
      remainingTimeSec: 19.8,
      pressureValue: -0.00011,
      pressureUnit: 'bar',
      pressureMbar: -0.11,
    });
  });

  it('parses stream frame numbers with comma decimals', () => {
    const result = parseLpcStream('9369034 S C01,P01,PRF,ET 5,20 sec,T 19,80 sec,P -0,00011 bar');

    expect(result?.elapsedTimeSec).toBe(5.2);
    expect(result?.remainingTimeSec).toBe(19.8);
    expect(result?.pressureValue).toBe(-0.00011);
    expect(result?.pressureMbar).toBe(-0.11);
  });

  it('returns null for result frames and menu lines', () => {
    expect(
      parseLpcStream('F54D060 R C01 N1 P05 R-- 06:40:13.630 06/23/26 0000020041 SL - No_barcode'),
    ).toBeNull();
    expect(parseLpcStream('TCP/IP INTERFACE SELECTION')).toBeNull();
  });

  it('parses EXH stream pressure without requiring RL from streaming S frames', () => {
    const result = parseLpcStream('1234567 S C01,P17,EXH,ET 11.55 sec,T 0.80 sec,P 0.000273 bar');

    expect(result).toMatchObject({
      segment: 'EXH',
      elapsedTimeSec: 11.55,
      remainingTimeSec: 0.8,
      pressureValue: 0.000273,
      pressureUnit: 'bar',
      pressureMbar: 0.273,
    });
    expect(result?.raw).not.toContain('RL');
  });
});
