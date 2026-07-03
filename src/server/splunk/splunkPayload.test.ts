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

describe('buildSplunkResultEnvelope', () => {
  it('includes test metadata, operator and full curve point package', () => {
    const envelope = buildSplunkResultEnvelope(config, {
      result,
      session: { ok: true, status: 'running', locked: true, activeTestId: 'test-1', barcode: '5901234123457', programNumber: 1, programText: 'P01', operatorUserId: 'user-1', operatorLogin: 'ADM', startedAt: '2026-06-30T10:00:00.000Z', lastStreamAt: null, completedAt: null, timeoutAt: null, message: null },
      curvePoints: [{ elapsedTimeSec: 0.1, remainingTimeSec: 1, pressureBar: 0.001, pressureMbar: 1, segment: 'raw-stream' }],
      config: { LPC_HOST: '192.0.2.10', LPC_PORT: 23, LPC_INTERFACE_SELECTION: '1' },
    });
    expect(envelope.index).toBe('machinedata_w16');
    expect(envelope).toMatchObject({ index: 'machinedata_w16', source: 'LPC-528-01', sourcetype: '_json' });
    expect(envelope.event).toMatchObject({ name: 'LPC.TestFinished', site: 'W16', line: 'PWT', workplace: 'LPC-528-01', device: 'LPC-528-01', barcode: '5901234123457', programNumber: 1, programText: 'P01', resultStatus: 'OK', resultRawStatus: 'ACCEPT', leakValue: 7.253, leakUnit: 'Pa/s', operatorLogin: 'ADM', operatorId: 'ADM', curvePointCount: 1, curveUnit: 'Pa/s', curvePoints: [{ t: 0, elapsedSec: 0.1, value: 1, raw: 'raw-stream' }] });
    expect(envelope.fields).toMatchObject({ site: 'W16', line: 'PWT', workplace: 'LPC-528-01', device: 'LPC-528-01' });
  });

  it('sends empty curve as pointCount 0 and points []', () => {
    const envelope = buildSplunkResultEnvelope(config, { result, session: null, curvePoints: [], config: { LPC_HOST: '192.0.2.10', LPC_PORT: 23, LPC_INTERFACE_SELECTION: '1' } });
    expect(envelope.event).toMatchObject({ curvePointCount: 0, curvePoints: [] });
  });
});
