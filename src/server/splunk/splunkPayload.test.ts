import { describe, expect, it } from 'vitest';
import { buildSplunkResultEnvelope } from './splunkPayload';
import type { SplunkRuntimeConfig } from './splunkTypes';
import type { EnrichedLpcResult } from '../../lpc/LpcLineProcessor';

const config: SplunkRuntimeConfig = {
  enabled: true,
  url: 'https://splunk.example.local:8088/services/collector',
  token: 'token-for-test',
  index: 'machinedata_w16',
  source: 'LPC-528-01',
  sourcetype: '_json',
  site: 'W16',
  line: 'PWT',
  workplace: 'LPC-528-01',
  device: 'LPC-528-01',
  timeoutMs: 5000,
  verifyTls: true,
  sendResult: true,
  sendCurve: true,
  bufferEnabled: true,
  bufferRetryIntervalMs: 30000,
  bufferMaxAttempts: 0,
  streamPointsMode: 'full',
  streamPointsMax: 5000,
  includeRawStream: false,
  rawStreamMax: 1000,
};

const result: EnrichedLpcResult = {
  source: 'lpc', receivedAt: '2026-06-30T10:00:10.000Z', messageId: '1', messageType: 'R', channel: 'C01', port: null,
  program: 'P01', programText: 'P01', linkInfo: null, result: 'ACCEPT', value: 'ACCEPT', testerTime: null, testerDate: null,
  uniqueId: 'u1', totalAbs: null, programEvaluation: null, spcFlag: null, barcode: '5901234123457', barcodeFromResult: null,
  testType: null, testEvaluation: null, leakType: 'RL', leakValue: 7.253, leakUnit: 'Pa/s', resultDetailsRaw: null, measurements: {},
  RL: 7.253, RL_unit: 'Pa/s', Pt: null, Pt_unit: null, EDC: null, EDC_unit: null, PL: null, PL_unit: null, LLR: null, LLR_unit: null,
  HLR: null, HLR_unit: null, FPR: null, FPR_unit: null, raw: 'raw', normalized: 'raw', currentTestValid: true,
  currentTestBarcode: '5901234123457', currentTestProgram: 1, currentTestProgramText: 'P01', currentTestSelectedAt: '2026-06-30T10:00:00.000Z',
  operatorLogin: 'ADM', operatorRole: 'operator',
};

const appConfig = { LPC_HOST: '192.0.2.10', LPC_PORT: 23, LPC_INTERFACE_SELECTION: '1', LPC_RESULT_FRAME_FORMAT: 1 as const, LPC_RESULT_OK_CODES: 'A,OK,PASS,ACCEPT,GOOD,GUT', LPC_RESULT_NOK_CODES: 'SB,NOK,FAIL,REJECT,BAD,FEHLER' };

describe('buildSplunkResultEnvelope', () => {
  it('includes test metadata, operator and full curve point package', () => {
    const envelope = buildSplunkResultEnvelope(config, {
      result,
      session: { ok: true, status: 'running', locked: true, activeTestId: 'test-1', barcode: '5901234123457', programNumber: 1, programText: 'P01', operatorUserId: 'user-1', operatorLogin: 'ADM', startedAt: '2026-06-30T10:00:00.000Z', firstLpcDataAt: null, lastLpcDataAt: null, lastStreamAt: null, finalResultAt: null, completedAt: null, timeoutAt: null, message: null },
      curvePoints: [{ elapsedTimeSec: 54.65, remainingTimeSec: 1.35, pressureBar: 5.990978, pressureMbar: 5990.978, segment: 'DPT', liveLeakValue: 3.788533, liveLeakUnit: 'Pa/s', RL: 3.788533, RL_unit: 'Pa/s' }],
      config: appConfig,
    });
    expect(envelope.index).toBe('machinedata_w16');
    expect(envelope).toMatchObject({ index: 'machinedata_w16', source: 'LPC-528-01', sourcetype: '_json' });
    expect(envelope.event).toMatchObject({ name: 'LPC.TestFinished', site: 'W16', line: 'PWT', workplace: 'LPC-528-01', device: 'LPC-528-01', barcode: '5901234123457', programNumber: 1, programText: 'P01', resultStatus: 'OK', resultRawStatus: 'ACCEPT', leakValue: 7.253, leakUnit: 'Pa/s', operatorLogin: 'ADM', operatorId: 'ADM', curvePointCount: 1, curveUnit: 'Pa/s', curvePoints: [{ t: 0, elapsedSec: 54.65, remainingTimeSec: 1.35, value: 5990.978, pressureBar: 5.990978, pressureMbar: 5990.978, raw: 'DPT', segment: 'DPT', liveLeakValue: 3.788533, liveLeakUnit: 'Pa/s', RL: 3.788533, RL_unit: 'Pa/s' }] });
    expect(envelope.fields).toMatchObject({ site: 'W16', line: 'PWT', workplace: 'LPC-528-01', device: 'LPC-528-01' });
    expect(envelope.event).toMatchObject({
      schemaVersion: 2,
      station: { site: 'W16', line: 'PWT', workplace: 'LPC-528-01', device: 'LPC-528-01', source: 'LPC-528-01' },
      test: { id: 'test-1', status: 'completed', activeTestEndReason: 'final_result' },
      operator: { login: 'ADM' },
      product: { barcode: '5901234123457' },
      program: { number: 1, text: 'P01' },
      result: { status: 'OK', isOk: true },
      curves: { pointCount: 1, liveLeak: [{ value: 3.788533 }] },
      process: { segments: { DPT: { liveLeakMin: 3.788533, liveLeakMax: 3.788533, liveLeakAvg: 3.788533 } } },
      summary: { streamPointCount: 1, curvePointCount: 1, dptPointCount: 1 },
      raw: { streamLineCount: 0 },
      diagnostics: { splunkPayloadSchemaVersion: 2, bufferedStreamPoints: 1, sentStreamPoints: 1, truncated: false },
    });
  });

  it('sends empty curve as pointCount 0 and points []', () => {
    const envelope = buildSplunkResultEnvelope(config, { result, session: null, curvePoints: [], config: appConfig });
    expect(envelope.event).toMatchObject({ curvePointCount: 0, curvePoints: [] });
  });

  it('includes format 2 LPC fields and does not report timeout for short R frame', () => {
    const shortResult: EnrichedLpcResult = {
      ...result,
      result: 'ACCEPT',
      value: 'ACCEPT',
      resultFrameFormat: 2,
      resultRawStatus: 'A',
      messageId: '2BFC030',
      messageType: 'R',
      channel: 'C01',
      program: 'P17',
      programText: 'P17',
      testerTime: '15:34:00.830',
      testerDate: '07/03/26',
      uniqueId: '0000293998',
      programEvaluation: 'A',
      spcFlag: '-',
      lpcMessageId: '2BFC030',
      lpcMessageType: 'R',
      lpcChannel: 'C01',
      lpcProgram: 17,
      lpcProgramText: 'P17',
      lpcTesterTime: '15:34:00.830',
      lpcTesterDate: '07/03/26',
      lpcUniqueId: '0000293998',
      lpcProgramEvaluation: 'A',
      lpcSpcFlag: '-',
      lpcAllResultInformation: null,
    };
    const envelope = buildSplunkResultEnvelope(config, { result: shortResult, session: null, curvePoints: [], config: { ...appConfig, LPC_RESULT_FRAME_FORMAT: 2 } });

    expect(envelope.event).toMatchObject({
      resultStatus: 'OK',
      resultRawStatus: 'A',
      lpcResultFrameFormat: 2,
      lpcUniqueId: '0000293998',
      lpcProgramEvaluation: 'A',
      leakValue: 7.253,
      RL: 7.253,
      Pt: null,
      errorCode: null,
    });
    expect(envelope.event).not.toMatchObject({ resultRawStatus: 'TIMEOUT' });
  });

  it('builds final measurements from R frame values and keeps legacy measurement fields', () => {
    const richResult = {
      ...result,
      resultFrameFormat: 2 as const,
      resultRawStatus: 'SB',
      result: 'REJECT' as const,
      value: 'REJECT' as const,
      testType: 'DPT',
      testEvaluation: 'F',
      leakValue: 11.815086,
      leakUnit: 'Pa/s',
      measurements: {
        RL: { value: 11.815086, unit: 'Pa/s' },
        Pt: { value: 5.997561, unit: 'bar' },
        EDC: { value: 0, unit: 'Pa/s' },
        PL: { value: 141.973679, unit: 'dPa' },
        LLR: { value: -7.191792, unit: 'Pa/s' },
        HLR: { value: 10.787688, unit: 'Pa/s' },
        FPR: { value: 6.002622, unit: 'bar' },
      },
      RL: 11.815086,
      Pt: 5.997561,
      EDC: 0,
      PL: 141.973679,
      LLR: -7.191792,
      HLR: 10.787688,
      FPR: 6.002622,
    };
    const envelope = buildSplunkResultEnvelope(config, { result: richResult, session: null, curvePoints: [], config: { ...appConfig, LPC_RESULT_FRAME_FORMAT: 2 } });
    expect(envelope.event).toMatchObject({
      resultStatus: 'NOK',
      measurements: {
        main: { name: 'RL', value: 11.815086, unit: 'Pa/s' },
        items: { RL: { value: 11.815086, unit: 'Pa/s' }, Pt: { value: 5.997561, unit: 'bar' }, EDC: { value: 0, unit: 'Pa/s' }, PL: { value: 141.973679, unit: 'dPa' }, LLR: { value: -7.191792, unit: 'Pa/s' }, HLR: { value: 10.787688, unit: 'Pa/s' }, FPR: { value: 6.002622, unit: 'bar' } },
      },
      RL: 11.815086,
      Pt: 5.997561,
      EDC: 0,
      PL: 141.973679,
      LLR: -7.191792,
      HLR: 10.787688,
      FPR: 6.002622,
    });
  });

  it('keeps EXH pressure points without RL and truncates sent curves without losing full-buffer summary', () => {
    const points = [
      { elapsedTimeSec: 1, remainingTimeSec: 3, pressureBar: 1, pressureMbar: 1000, segment: 'STB', raw: 's1' },
      { elapsedTimeSec: 2, remainingTimeSec: 2, pressureBar: 2, pressureMbar: 2000, segment: 'DPT', liveLeakValue: 4, liveLeakUnit: 'Pa/s', raw: 's2' },
      { elapsedTimeSec: 3, remainingTimeSec: 1, pressureBar: 0.2, pressureMbar: 200, segment: 'EXH', raw: 's3' },
    ];
    const envelope = buildSplunkResultEnvelope({ ...config, streamPointsMax: 2 }, { result, session: null, curvePoints: points, config: appConfig });
    expect(envelope.event).toMatchObject({
      curves: { pointCount: 2, pressure: [{ bar: 1 }, { bar: 2 }], points: [{ liveLeakValue: null }, { liveLeakValue: 4 }] },
      summary: { streamPointCount: 3, dptPointCount: 1, liveLeak: { min: 4, max: 4, avg: 4, last: 4 } },
      raw: { streamFirstLine: 's1', streamLastLine: 's3', streamLineCount: 3 },
      diagnostics: { truncated: true, sentStreamPoints: 2 },
    });
  });
});
