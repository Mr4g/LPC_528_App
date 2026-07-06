import { describe, expect, it } from 'vitest';
import { buildSplunkErrorEnvelope, buildSplunkResultEnvelope } from './splunkPayload';
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
  sendCurve: false,
  sendCurveSummary: true,
  curveSampleIntervalSec: 1,
  curveSampleMaxPoints: 2,
  bufferEnabled: true,
  bufferRetryIntervalMs: 30000,
  bufferMaxAttempts: 0,
  streamPointsMode: 'full',
  streamPointsMax: 5000,
  includeRawStream: false,
  rawStreamMax: 1000,
};

const result: EnrichedLpcResult = {
  source: 'lpc', receivedAt: '2026-06-30T10:00:10.000Z', messageId: '59DA0D2', messageType: 'R', channel: 'C01', port: null,
  program: 'P11', programText: 'P11', linkInfo: null, result: 'REJECT', value: 'REJECT', testerTime: '11:04:36.780', testerDate: '07/06/26',
  uniqueId: '0000294244', totalAbs: null, programEvaluation: 'R', spcFlag: '-', barcode: '7096', barcodeFromResult: null,
  testType: 'DPT', testEvaluation: 'F', leakType: 'RL', leakValue: 11.686662, leakUnit: 'Pa/s', resultDetailsRaw: 'DPT F RL 11.686662 pa/s',
  measurements: { RL: { value: 11.686662, unit: 'Pa/s' }, Pt: { value: 5.995510, unit: 'bar' }, EDC: { value: 0, unit: 'Pa/s' }, PL: { value: 140.368362, unit: 'dPa' }, LLR: { value: -7.191792, unit: 'Pa/s' }, HLR: { value: 10.787688, unit: 'Pa/s' }, FPR: { value: 6.000356, unit: 'bar' } },
  RL: 11.686662, RL_unit: 'Pa/s', Pt: 5.995510, Pt_unit: 'bar', EDC: 0, EDC_unit: 'Pa/s', PL: 140.368362, PL_unit: 'dPa', LLR: -7.191792, LLR_unit: 'Pa/s', HLR: 10.787688, HLR_unit: 'Pa/s', FPR: 6.000356, FPR_unit: 'bar',
  raw: 'raw', normalized: 'raw', currentTestValid: true, currentTestBarcode: '7096', currentTestProgram: 11, currentTestProgramText: 'P11', currentTestSelectedAt: '2026-06-30T10:00:00.000Z',
  operatorLogin: 'ADM', operatorRole: 'operator', resultFrameFormat: 2, resultRawStatus: 'R', lpcProgram: 11, lpcProgramText: 'P11', lpcProgramEvaluation: 'R', lpcSpcFlag: '-', lpcUniqueId: '0000294244', lpcTesterTime: '11:04:36.780', lpcTesterDate: '07/06/26', lpcMessageId: '59DA0D2', lpcMessageType: 'R', lpcChannel: 'C01', lpcAllResultInformation: 'DPT F RL ...',
};

const appConfig = { LPC_HOST: '192.0.2.10', LPC_PORT: 23, LPC_INTERFACE_SELECTION: '1', LPC_RESULT_FRAME_FORMAT: 2 as const, LPC_RESULT_OK_CODES: 'A,OK,PASS,ACCEPT,GOOD,GUT', LPC_RESULT_NOK_CODES: 'R,F,SB,NOK,FAIL,REJECT,BAD,FEHLER' };

describe('buildSplunkResultEnvelope', () => {
  it('builds HEC envelope with final result event fields and context fields only', () => {
    const envelope = buildSplunkResultEnvelope(config, {
      result,
      session: { ok: true, status: 'running', locked: true, activeTestId: 'test-1', barcode: '7096', programNumber: 11, programText: 'P11', operatorUserId: 'ADM', operatorLogin: 'ADM', startedAt: '2026-06-30T10:00:00.000Z', firstLpcDataAt: null, lastLpcDataAt: null, lastStreamAt: null, finalResultAt: null, completedAt: '2026-06-30T10:00:10.000Z', timeoutAt: null, message: null },
      curvePoints: [
        { elapsedTimeSec: 20.1, remainingTimeSec: 2, pressureBar: 5.8, pressureMbar: 5800, segment: 'STG' },
        { elapsedTimeSec: 20.6, remainingTimeSec: 1, pressureBar: 5.9, pressureMbar: 5900, segment: 'STG' },
        { elapsedTimeSec: 54.65, remainingTimeSec: 1.35, pressureBar: 5.990978, pressureMbar: 5990.978, segment: 'DPT', liveLeakValue: 3.788533, liveLeakUnit: 'Pa/s', RL: 3.788533, RL_unit: 'Pa/s' },
        { elapsedTimeSec: Number.NaN, remainingTimeSec: null, pressureBar: null, pressureMbar: null, segment: 'BROKEN' },
      ],
      config: appConfig,
    });

    expect(envelope).toMatchObject({ index: 'machinedata_w16', source: 'LPC-528-01', sourcetype: '_json' });
    expect(envelope.fields).toMatchObject({ site: 'W16', line: 'PWT', workplace: 'LPC-528-01', workplaceName: 'LPC-528-01', device: 'LPC-528-01', isMachine: 'true', app: 'lpc-528-app' });
    expect(envelope.event).toMatchObject({
      name: 'LPC.TestFinished', eventType: 'lpc_test_result', resultStatus: 'NOK', result: 'REJECT', resultRawStatus: 'R', barcode: '7096', matchedKey: '7096', programNumber: 11, programText: 'P11', operatorLogin: 'ADM', operatorId: 'ADM', testId: 'test-1',
      leakType: 'RL', leakValue: 11.686662, leakUnit: 'Pa/s', leakText: '11,686662 Pa/s',
      lpcMessageId: '59DA0D2', lpcMessageType: 'R', lpcChannel: 'C01', lpcProgram: 11, lpcProgramText: 'P11', lpcTesterTime: '11:04:36.780', lpcTesterDate: '07/06/26', lpcUniqueId: '0000294244', lpcProgramEvaluation: 'R', lpcTestType: 'DPT', lpcTestEvaluation: 'F', lpcSpcFlag: '-',
      RL: 11.686662, RL_unit: 'Pa/s', Pt: 5.995510, Pt_unit: 'bar', EDC: 0, EDC_unit: 'Pa/s', PL: 140.368362, PL_unit: 'dPa', LLR: -7.191792, LLR_unit: 'Pa/s', HLR: 10.787688, HLR_unit: 'Pa/s', FPR: 6.000356, FPR_unit: 'bar', curvePointCount: 3, dptPointCount: 1,
    });
    expect(envelope.event.curveSummary).toMatchObject({
      pointCount: 3,
      dptPointCount: 1,
      pressureUnit: 'mbar',
      rlUnit: 'Pa/s',
      sampling: { enabled: true, intervalSec: 1, maxPoints: 2, method: 'bucket_avg' },
    });
    expect((envelope.event.curveSummary as { sampledPoints: unknown[] }).sampledPoints).toHaveLength(2);
    expect((envelope.event.curveSummary as { sampledPoints: Array<Record<string, unknown>> }).sampledPoints[0]).toMatchObject({ t: 20.1, segment: 'STG', pressureMbarAvg: 5850, pressureMbarMin: 5800, pressureMbarMax: 5900, rlAvg: null });
    expect(envelope.event).not.toHaveProperty('curvePoints');
    expect(envelope.event).not.toHaveProperty('curve');
  });

  it('builds timeout/error payload without curve point arrays', () => {
    const envelope = buildSplunkErrorEnvelope(config, {
      session: { ok: true, status: 'timeout', locked: false, activeTestId: 'test-timeout', barcode: '7096', programNumber: 11, programText: 'P11', operatorUserId: 'ADM', operatorLogin: 'ADM', startedAt: '2026-06-30T10:00:00.000Z', firstLpcDataAt: null, lastLpcDataAt: null, lastStreamAt: null, finalResultAt: null, completedAt: null, timeoutAt: '2026-06-30T10:01:00.000Z', message: 'Timeout' },
      reason: 'TIMEOUT', message: 'No final result', curvePoints: [{ elapsedTimeSec: 1, remainingTimeSec: 1, pressureBar: 1, pressureMbar: 1000, segment: 'STG' }], config: appConfig,
    });

    expect(envelope.event).toMatchObject({ resultStatus: 'ERROR', result: 'ERROR', resultRawStatus: 'TIMEOUT', errorCode: 'TIMEOUT', errorMessage: 'No final result', curvePointCount: 1, dptPointCount: 0 });
    expect(envelope.event.curveSummary).toMatchObject({ pointCount: 1, sampledPoints: [{ t: 1, segment: 'STG', pressureMbarAvg: 1000, rlAvg: null }] });
    expect(envelope.event).not.toHaveProperty('curvePoints');
    expect(envelope.event).not.toHaveProperty('curve');
  });
});
