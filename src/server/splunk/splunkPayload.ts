import os from 'node:os';
import type { SplunkErrorContext, SplunkHecEnvelope, SplunkResultContext, SplunkRuntimeConfig } from './splunkTypes';
import type { LpcCurvePoint } from '../../lpc/LpcTestCurveBuffer';

function unixTime(iso: string | null | undefined): number {
  const ms = iso ? Date.parse(iso) : Date.now();
  return Number.isFinite(ms) ? ms / 1000 : Date.now() / 1000;
}

function durationMs(startedAt: string | null | undefined, endedAt: string | null | undefined): number | null {
  if (!startedAt || !endedAt) return null;
  const duration = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) ? duration : null;
}

function leakText(value: number | null, unit: string | null): string | null {
  if (value === null) return null;
  return `${String(value).replace('.', ',')}${unit ? ` ${unit}` : ''}`;
}

function resultStatus(raw: string): 'OK' | 'NOK' | 'ERROR' | 'UNKNOWN' {
  if (raw === 'ACCEPT') return 'OK';
  if (raw === 'REJECT') return 'NOK';
  if (raw === 'ERROR') return 'ERROR';
  return 'UNKNOWN';
}

function mapCurvePoints(points: LpcCurvePoint[]) {
  return points.map((point, index) => ({
    t: index,
    elapsedSec: point.elapsedTimeSec,
    value: point.pressureMbar,
    raw: point.segment,
  }));
}

function fields(config: SplunkRuntimeConfig) {
  return Object.fromEntries(Object.entries({
    site: config.site,
    line: config.line,
    workplace: config.workplace,
    device: config.device,
    workplaceName: config.workplace,
    isMachine: 'true',
    hostname: os.hostname(),
  }).filter(([, value]) => value !== null && value !== '')) as Record<string, string>;
}

export function buildSplunkResultEnvelope(config: SplunkRuntimeConfig, context: SplunkResultContext): SplunkHecEnvelope {
  const { result, session } = context;
  const endedAt = session?.completedAt ?? result.receivedAt;
  const programText = result.currentTestProgramText ?? result.programText ?? result.program;
  const programNumber = result.currentTestProgram ?? (programText?.startsWith('P') ? Number(programText.slice(1)) : null);
  const matchedKey = result.currentTestBarcode ?? result.barcode;
  const curvePoints = config.sendCurve ? mapCurvePoints(context.curvePoints) : [];
  const operatorLogin = result.operatorLogin ?? session?.operatorLogin ?? null;

  return {
    time: unixTime(endedAt),
    sourcetype: config.sourcetype,
    index: config.index,
    source: config.source,
    event: {
      eventType: 'lpc_test_result',
      name: 'LPC.TestFinished',
      site: config.site,
      line: config.line,
      workplace: config.workplace,
      device: config.device,
      app: 'lpc-528-app',
      testId: session?.activeTestId ?? null,
      startedAt: session?.startedAt ?? result.currentTestSelectedAt ?? null,
      endedAt,
      durationMs: durationMs(session?.startedAt, endedAt),
      operatorLogin,
      operatorId: operatorLogin,
      barcode: result.barcode,
      matchedKey,
      programNumber,
      programText,
      resultStatus: resultStatus(result.result),
      resultRawStatus: result.resultRawStatus ?? result.result,
      leakValue: result.leakValue,
      leakUnit: result.leakUnit,
      leakText: leakText(result.leakValue, result.leakUnit),
      curvePointCount: curvePoints.length,
      curveUnit: result.leakUnit,
      curvePoints,
      lpcResultFrameFormat: result.resultFrameFormat ?? 1,
      lpcMessageId: result.lpcMessageId ?? result.messageId,
      lpcMessageType: result.lpcMessageType ?? result.messageType,
      lpcChannel: result.lpcChannel ?? result.channel,
      lpcProgram: result.lpcProgram ?? programNumber,
      lpcProgramText: result.lpcProgramText ?? programText,
      lpcTesterTime: result.lpcTesterTime ?? result.testerTime,
      lpcTesterDate: result.lpcTesterDate ?? result.testerDate,
      lpcUniqueId: result.lpcUniqueId ?? result.uniqueId,
      lpcProgramEvaluation: result.lpcProgramEvaluation ?? result.programEvaluation,
      lpcSpcFlag: result.lpcSpcFlag ?? result.spcFlag,
      lpcAllResultInformation: result.lpcAllResultInformation ?? null,
      measurements: result.measurements ?? {},
      RL: result.RL,
      RL_unit: result.RL_unit,
      Pt: result.Pt,
      Pt_unit: result.Pt_unit,
      EDC: result.EDC,
      EDC_unit: result.EDC_unit,
      PL: result.PL,
      PL_unit: result.PL_unit,
      LLR: result.LLR,
      LLR_unit: result.LLR_unit,
      HLR: result.HLR,
      HLR_unit: result.HLR_unit,
      FPR: result.FPR,
      FPR_unit: result.FPR_unit,
      errorCode: result.errorCode ?? null,
      errorMessage: result.errorMessage ?? null,
    },
    fields: fields(config),
  };
}

export function buildSplunkErrorEnvelope(config: SplunkRuntimeConfig, context: SplunkErrorContext): SplunkHecEnvelope {
  const endedAt = context.session.completedAt ?? context.session.timeoutAt ?? new Date().toISOString();
  const curvePoints = config.sendCurve ? mapCurvePoints(context.curvePoints) : [];
  return {
    time: unixTime(endedAt),
    sourcetype: config.sourcetype,
    index: config.index,
    source: config.source,
    event: {
      eventType: 'lpc_test_result',
      name: 'LPC.TestFinished',
      site: config.site,
      line: config.line,
      workplace: config.workplace,
      device: config.device,
      app: 'lpc-528-app',
      testId: context.session.activeTestId,
      startedAt: context.session.startedAt,
      endedAt,
      durationMs: durationMs(context.session.startedAt, endedAt),
      operatorLogin: context.session.operatorLogin ?? null,
      operatorId: context.session.operatorLogin ?? null,
      barcode: context.session.barcode,
      matchedKey: context.session.barcode,
      programNumber: context.session.programNumber,
      programText: context.session.programText,
      resultStatus: 'ERROR',
      resultRawStatus: context.reason,
      leakValue: null,
      leakUnit: null,
      leakText: null,
      curvePointCount: curvePoints.length,
      curveUnit: null,
      curvePoints,
      errorCode: context.reason,
      errorMessage: context.message,
    },
    fields: fields(config),
  };
}
