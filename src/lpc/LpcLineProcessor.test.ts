import { describe, expect, it, vi } from 'vitest';
import type { CurrentTest } from '../shared/types';
import { CurrentTestStore } from '../scanner/currentTestStore';
import { LastResultStore } from './LastResultStore';
import { LpcLineProcessor } from './LpcLineProcessor';
import { ResultHistoryStore } from './ResultHistoryStore';
import { LpcTestCurveBuffer } from './LpcTestCurveBuffer';

const streamLine = '9369034 S C01,P01,PRF,ET 5.20 sec,T 19.80 sec,P -0.00011 bar';
const resultLine = 'F54D060 R C01 N1 P05 R-- 06:40:13.630 06/23/26 0000020041 SL - No_barcode DPT P RL 10.787688 pa/s Pt 2.072516 bar';

function currentTest(): CurrentTest {
  return {
    type: 'current_test',
    barcode: '7472475',
    matchedKey: '7472475',
    program: 1,
    programText: 'P01',
    selectedAt: new Date().toISOString(),
    operatorLogin: 'ABC',
    operatorRole: 'operator',
  };
}

function createProcessor(patch: Partial<ConstructorParameters<typeof LpcLineProcessor>[0]> = {}) {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const io = { emit: vi.fn((event: string, payload: unknown) => emitted.push({ event, payload })) };
  const tcpClient = { send: vi.fn() };
  const currentTestStore = new CurrentTestStore();
  const curveBuffer = new LpcTestCurveBuffer();
  const lastResultStore = new LastResultStore();
  const resultHistoryStore = new ResultHistoryStore(50);
  const processor = new LpcLineProcessor({
    io: io as never,
    tcpClient: tcpClient as never,
    currentTestStore,
    curveBuffer,
    lastResultStore,
    resultHistoryStore,
    autoSelectInterface: true,
    interfaceSelection: '1',
    currentTestMaxAgeMs: 600000,
    debugLines: false,
    ...patch,
  });

  return { processor, emitted, tcpClient, currentTestStore, curveBuffer, lastResultStore, resultHistoryStore };
}

describe('LpcLineProcessor', () => {
  it('recognizes stream and updates the curve buffer', () => {
    const { processor, emitted, curveBuffer } = createProcessor();

    processor.processLine(streamLine);

    expect(curveBuffer.getPoints()).toHaveLength(1);
    expect(emitted.some((item) => item.event === 'lpc:stream')).toBe(true);
    expect(emitted.some((item) => item.event === 'lpc:curve-updated')).toBe(true);
    expect(processor.getPipelineStatus()).toMatchObject({ streamCount: 1 });
  });

  it('recognizes result, stores it and emits completion events', () => {
    const { processor, emitted, lastResultStore, resultHistoryStore } = createProcessor();

    processor.processLine(resultLine);

    expect(emitted.some((item) => item.event === 'lpc:result')).toBe(true);
    expect(emitted.some((item) => item.event === 'test:completed')).toBe(true);
    expect(emitted.some((item) => item.event === 'lpc:curve-completed')).toBe(true);
    expect(emitted.some((item) => item.event === 'lpc:results-updated')).toBe(true);
    expect(lastResultStore.get()?.result).toBe('REJECT');
    expect(resultHistoryStore.getAll()).toHaveLength(1);
    expect(processor.getPipelineStatus()).toMatchObject({ resultCount: 1 });
  });

  it('emits result when final result measurement has no unit', () => {
    const { processor, emitted, lastResultStore } = createProcessor();

    processor.processLine('F54D060 A C01 N1 P05 A-- 06:40:13.630 06/23/26 0000020041 SL - No_barcode DPT P RL 7,253');

    expect(emitted.some((item) => item.event === 'lpc:result')).toBe(true);
    expect(lastResultStore.get()).toMatchObject({ result: 'ACCEPT', leakValue: 7.253, leakUnit: null });
  });

  it('emits result with bar unit from comma decimal measurement', () => {
    const { processor, emitted, lastResultStore } = createProcessor();

    processor.processLine('F54D060 A C01 N1 P05 A-- 06:40:13.630 06/23/26 0000020041 SL - No_barcode DPT P RL 0,012 bar');

    expect(emitted.some((item) => item.event === 'lpc:result')).toBe(true);
    expect(lastResultStore.get()).toMatchObject({ result: 'ACCEPT', leakValue: 0.012, leakUnit: 'bar' });
  });

  it('ignores menu after sending interface selection', () => {
    const { processor, emitted, tcpClient } = createProcessor();

    processor.processLine('* 1 Interface Connection1 *');

    expect(tcpClient.send).toHaveBeenCalledWith('1\r\n');
    expect(emitted.some((item) => item.event === 'lpc:interface-selected')).toBe(true);
    expect(emitted.some((item) => item.event === 'lpc:result')).toBe(false);
  });

  it('uses currentTest barcode and programText for No_barcode result', () => {
    const { processor, emitted, currentTestStore } = createProcessor();
    currentTestStore.set(currentTest());

    processor.processLine(resultLine);

    const resultEvent = emitted.find((item) => item.event === 'lpc:result');
    expect(resultEvent?.payload).toMatchObject({
      barcode: '7472475',
      program: 'P01',
      programText: 'P01',
      currentTestValid: true,
      currentTestProgramText: 'P01',
      operatorLogin: 'ABC',
      operatorRole: 'operator',
    });
  });



  it('treats stop streaming as ignored and waits for final result', () => {
    const { processor, emitted } = createProcessor({ config: { LPC_HOST: '192.0.2.10', LPC_PORT: 23, LPC_INTERFACE_SELECTION: '1', LPC_RESULT_FRAME_FORMAT: 2, LPC_RESULT_OK_CODES: 'A,OK,PASS,ACCEPT,GOOD,GUT', LPC_RESULT_NOK_CODES: 'SB,NOK,FAIL,REJECT,BAD,FEHLER' } });

    processor.processLine('A5FB010 X Stop Streaming');

    expect(processor.getRawLines().at(-1)).toMatchObject({ parsedAs: 'ignored', reason: 'stop-streaming' });
    expect(emitted.some((item) => item.event === 'test:completed')).toBe(false);
    expect(processor.getPipelineStatus()).toMatchObject({ resultCount: 0 });
  });

  it('keeps format 2 stream frames as stream and not final result', () => {
    const { processor, emitted } = createProcessor({ config: { LPC_HOST: '192.0.2.10', LPC_PORT: 23, LPC_INTERFACE_SELECTION: '1', LPC_RESULT_FRAME_FORMAT: 2, LPC_RESULT_OK_CODES: 'A,OK,PASS,ACCEPT,GOOD,GUT', LPC_RESULT_NOK_CODES: 'SB,NOK,FAIL,REJECT,BAD,FEHLER' } });

    const diagnostic = processor.processLine('2BFA034	S	C01,P17,EXH,ET 25.25 sec,T 0.05 sec,P 0.000187 bar');

    expect(diagnostic.parsedAs).toBe('stream');
    expect(emitted.some((item) => item.event === 'lpc:stream')).toBe(true);
    expect(emitted.some((item) => item.event === 'test:completed')).toBe(false);
    const streamPayload = emitted.find((item) => item.event === 'lpc:stream')?.payload as { pressureUnit?: string; pressureMbar?: number; normalized?: string; raw?: string } | undefined;
    expect(streamPayload).toMatchObject({ pressureUnit: 'bar', pressureMbar: 0.187 });
  });

  it('completes active test from format 2 short R frame', () => {
    const testSessionManager = { getStatus: vi.fn(() => null), getActiveTestId: vi.fn(() => 'test-1'), complete: vi.fn(), markLpcData: vi.fn() };
    const { processor, emitted, lastResultStore } = createProcessor({
      testSessionManager: testSessionManager as never,
      config: { LPC_HOST: '192.0.2.10', LPC_PORT: 23, LPC_INTERFACE_SELECTION: '1', LPC_RESULT_FRAME_FORMAT: 2, LPC_RESULT_OK_CODES: 'A,OK,PASS,ACCEPT,GOOD,GUT', LPC_RESULT_NOK_CODES: 'SB,NOK,FAIL,REJECT,BAD,FEHLER' },
    });

    processor.processLine('2BFC030 R C01 P17 15:34:00.830 07/03/26 0000293998 SB -');

    expect(testSessionManager.complete).toHaveBeenCalledWith('SB');
    expect(emitted.some((item) => item.event === 'test:completed')).toBe(true);
    expect(lastResultStore.get()).toMatchObject({ result: 'REJECT', resultRawStatus: 'SB', lpcUniqueId: '0000293998' });
  });

  it('does not throw for garbage lines', () => {
    const { processor } = createProcessor();

    expect(() => processor.processLine('garbage telnet noise')).not.toThrow();
    expect(processor.getRawLines().at(-1)).toMatchObject({ parsedAs: 'ignored' });
  });
});
