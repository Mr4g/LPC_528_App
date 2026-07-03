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
    const result = parseLpcStream('2DB7035 S C01,P17,EXH,ET 56.00 sec,T 10.00 sec,P 5.990931 bar');

    expect(result).toMatchObject({
      segment: 'EXH',
      elapsedTimeSec: 56,
      remainingTimeSec: 10,
      pressureValue: 5.990931,
      pressureUnit: 'bar',
      pressureMbar: 5990.931,
      liveLeakValue: null,
      liveLeakUnit: null,
    });
    expect(result?.raw).not.toContain('RL');
  });

  it('parses DPT stream frames with live RL and normalizes pa/s unit', () => {
    const result = parseLpcStream('B89C045 S C01,P17,DPT,ET 54.65 sec,T 1.35 sec,P 5.990978 bar,RL 3.788533 pa/s');

    expect(result).toMatchObject({
      messageId: 'B89C045',
      segment: 'DPT',
      elapsedTimeSec: 54.65,
      remainingTimeSec: 1.35,
      pressureValue: 5.990978,
      pressureUnit: 'bar',
      pressureMbar: 5990.978,
      liveLeakValue: 3.788533,
      liveLeakUnit: 'Pa/s',
      RL: 3.788533,
      RL_unit: 'Pa/s',
    });
  });

  it('parses DPT live RL when there is no space before RL', () => {
    const result = parseLpcStream('99B6045	S C01,P17,DPT,ET 55.95 sec,T 0.05 sec,P 5.990933 bar,RL 3.756427 PA/S');

    expect(result).toMatchObject({
      segment: 'DPT',
      pressureMbar: 5990.933,
      liveLeakValue: 3.756427,
      liveLeakUnit: 'Pa/s',
    });
  });

});
