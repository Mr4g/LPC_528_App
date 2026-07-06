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

function avg(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function pickPoints(points: LpcCurvePoint[], config: SplunkRuntimeConfig): { points: LpcCurvePoint[]; truncated: boolean; reason: string | null } {
  if (!config.sendCurve || config.streamPointsMode === 'none') return { points: [], truncated: points.length > 0, reason: config.streamPointsMode === 'none' ? 'streamPointsMode=none' : 'sendCurve=false' };
  const max = config.streamPointsMax;
  if (max === 0) return { points: [], truncated: points.length > 0, reason: 'SPLUNK_STREAM_POINTS_MAX=0' };
  if (points.length <= max) return { points, truncated: false, reason: null };
  if (config.streamPointsMode === 'sampled') {
    const step = Math.ceil(points.length / max);
    return { points: points.filter((point, index) => index === 0 || index === points.length - 1 || point.segment === 'DPT' || point.segment === 'EXH' || index % step === 0).slice(0, max), truncated: true, reason: `sampled_to_${max}` };
  }
  return { points: points.slice(0, max), truncated: true, reason: `limited_to_${max}` };
}

function legacyCurvePoints(points: LpcCurvePoint[]) {
  return points.map((point, index) => ({
    t: index,
    elapsedSec: point.elapsedTimeSec,
    remainingTimeSec: point.remainingTimeSec,
    value: point.pressureMbar,
    pressureBar: point.pressureBar,
    pressureMbar: point.pressureMbar,
    raw: point.segment,
    segment: point.segment,
    liveLeakValue: point.liveLeakValue ?? null,
    liveLeakUnit: point.liveLeakUnit ?? null,
    RL: point.RL ?? point.liveLeakValue ?? null,
    RL_unit: point.RL_unit ?? point.liveLeakUnit ?? null,
  }));
}

function buildCurves(points: LpcCurvePoint[]) {
  const segments = [...new Set(points.map((point) => point.segment))];
  const pressure = points.filter((point) => point.pressureBar !== null).map((point) => ({ t: point.elapsedTimeSec, remaining: point.remainingTimeSec, segment: point.segment, bar: point.pressureBar, mbar: point.pressureMbar, messageId: point.messageId ?? null }));
  const liveLeak = points.filter((point) => (point.liveLeakValue ?? point.RL ?? null) !== null).map((point) => ({ t: point.elapsedTimeSec, remaining: point.remainingTimeSec, segment: point.segment, value: point.liveLeakValue ?? point.RL ?? null, unit: point.liveLeakUnit ?? point.RL_unit ?? null, messageId: point.messageId ?? null }));
  const combined = points.map((point) => ({ t: point.elapsedTimeSec, remaining: point.remainingTimeSec, segment: point.segment, pressureBar: point.pressureBar, pressureMbar: point.pressureMbar, liveLeakValue: point.liveLeakValue ?? point.RL ?? null, liveLeakUnit: point.liveLeakUnit ?? point.RL_unit ?? null, messageId: point.messageId ?? null }));
  return { pointCount: combined.length, segments, pressureUnit: 'bar', pressureMbarUnit: 'mbar', liveLeakUnit: liveLeak.find((point) => point.unit)?.unit ?? 'Pa/s', pressure, liveLeak, points: combined };
}

function buildProcess(points: LpcCurvePoint[]) {
  const segments: Record<string, Record<string, unknown>> = {};
  for (const segment of [...new Set(points.map((point) => point.segment))]) {
    const segmentPoints = points.filter((point) => point.segment === segment);
    const pressures = segmentPoints.map((point) => point.pressureBar).filter((value): value is number => value !== null);
    const leaks = segmentPoints.map((point) => point.liveLeakValue ?? point.RL ?? null).filter((value): value is number => value !== null);
    segments[segment] = {
      pointCount: segmentPoints.length,
      startedAtElapsedSec: segmentPoints[0]?.elapsedTimeSec ?? null,
      endedAtElapsedSec: segmentPoints.at(-1)?.elapsedTimeSec ?? null,
      durationSec: segmentPoints.length ? (segmentPoints.at(-1)?.elapsedTimeSec ?? 0) - (segmentPoints[0]?.elapsedTimeSec ?? 0) : null,
      pressureStartBar: pressures[0] ?? null,
      pressureEndBar: pressures.at(-1) ?? null,
      liveLeakStart: leaks[0] ?? null,
      liveLeakEnd: leaks.at(-1) ?? null,
      liveLeakMin: leaks.length ? Math.min(...leaks) : null,
      liveLeakMax: leaks.length ? Math.max(...leaks) : null,
      liveLeakAvg: avg(leaks),
    };
  }
  return { segments };
}

function buildSummary(points: LpcCurvePoint[]) {
  const pressures = points.map((point) => point.pressureBar).filter((value): value is number => value !== null);
  const leaks = points.map((point) => point.liveLeakValue ?? point.RL ?? null).filter((value): value is number => value !== null);
  return {
    streamPointCount: points.length,
    curvePointCount: points.length,
    dptPointCount: points.filter((point) => point.segment === 'DPT').length,
    pressure: { minBar: pressures.length ? Math.min(...pressures) : null, maxBar: pressures.length ? Math.max(...pressures) : null, startBar: pressures[0] ?? null, endBar: pressures.at(-1) ?? null },
    liveLeak: { min: leaks.length ? Math.min(...leaks) : null, max: leaks.length ? Math.max(...leaks) : null, avg: avg(leaks), last: leaks.at(-1) ?? null, unit: points.find((point) => point.liveLeakUnit || point.RL_unit)?.liveLeakUnit ?? points.find((point) => point.RL_unit)?.RL_unit ?? 'Pa/s' },
  };
}

function measurementItems(result: SplunkResultContext['result']) {
  return { ...result.measurements };
}

function fields(config: SplunkRuntimeConfig) {
  return Object.fromEntries(Object.entries({ site: config.site, line: config.line, workplace: config.workplace, device: config.device, workplaceName: config.workplace, isMachine: 'true', hostname: os.hostname() }).filter(([, value]) => value !== null && value !== '')) as Record<string, string>;
}

export function buildSplunkResultEnvelope(config: SplunkRuntimeConfig, context: SplunkResultContext): SplunkHecEnvelope {
  const { result, session } = context;
  const endedAt = session?.completedAt ?? result.receivedAt;
  const startedAt = session?.startedAt ?? result.currentTestSelectedAt ?? null;
  const ms = durationMs(startedAt, endedAt);
  const programText = result.currentTestProgramText ?? result.programText ?? result.program;
  const programNumber = result.currentTestProgram ?? (programText?.startsWith('P') ? Number(programText.slice(1)) : null);
  const matchedKey = result.currentTestBarcode ?? result.barcode;
  const selected = pickPoints(context.curvePoints, config);
  const curves = buildCurves(selected.points);
  const fullSummary = buildSummary(context.curvePoints);
  const process = buildProcess(context.curvePoints);
  const operatorLogin = result.operatorLogin ?? session?.operatorLogin ?? null;
  const status = resultStatus(result.result);
  const items = measurementItems(result);
  const mainMeasurement = result.leakType ? { name: result.leakType, value: result.leakValue, unit: result.leakUnit, text: leakText(result.leakValue, result.leakUnit)?.replace(',', '.') ?? null } : null;
  const rawStream = context.curvePoints.map((point) => point.raw).filter((line): line is string => Boolean(line));
  const raw: Record<string, unknown> = { resultLine: result.raw, resultNormalized: result.normalized, streamFirstLine: rawStream[0] ?? null, streamLastLine: rawStream.at(-1) ?? null, streamLineCount: rawStream.length };
  if (config.includeRawStream) raw.streamLines = rawStream.slice(0, config.rawStreamMax);

  return { time: unixTime(endedAt), sourcetype: config.sourcetype, index: config.index, source: config.source, event: {
    eventType: 'lpc_test_result', schemaVersion: 2, name: 'LPC.TestFinished', app: 'lpc-528-app', site: config.site, line: config.line, workplace: config.workplace, device: config.device,
    station: { site: config.site, line: config.line, workplace: config.workplace, device: config.device, source: config.source },
    test: { id: session?.activeTestId ?? null, startedAt, endedAt, durationMs: ms, durationSec: ms === null ? null : ms / 1000, status: status === 'ERROR' ? 'error' : 'completed', activeTestEndReason: 'final_result', resultFrameFormat: result.resultFrameFormat ?? context.config.LPC_RESULT_FRAME_FORMAT },
    operator: { id: session?.operatorUserId ?? operatorLogin, login: operatorLogin, role: result.operatorRole ?? null },
    product: { barcode: result.barcode, matchedKey },
    program: { number: programNumber, text: programText },
    result: { status, rawStatus: result.resultRawStatus ?? result.result, programEvaluation: result.lpcProgramEvaluation ?? result.programEvaluation, testType: result.testType, testEvaluation: result.testEvaluation, spcFlag: result.lpcSpcFlag ?? result.spcFlag, isOk: status === 'OK', isNok: status === 'NOK', isError: status === 'ERROR', errorCode: result.errorCode ?? null, errorMessage: result.errorMessage ?? null, lpc: { messageId: result.lpcMessageId ?? result.messageId, messageType: result.lpcMessageType ?? result.messageType, channel: result.lpcChannel ?? result.channel, channelNumber: result.lpcChannelNumber ?? null, program: result.lpcProgram ?? programNumber, programText: result.lpcProgramText ?? programText, testerTime: result.lpcTesterTime ?? result.testerTime, testerDate: result.lpcTesterDate ?? result.testerDate, uniqueId: result.lpcUniqueId ?? result.uniqueId, allResultInformation: result.lpcAllResultInformation ?? result.resultDetailsRaw ?? null } },
    measurements: { main: mainMeasurement, items }, process, curves, summary: fullSummary, raw,
    diagnostics: { splunkPayloadSchemaVersion: 2, bufferedStreamPoints: context.curvePoints.length, sentStreamPoints: selected.points.length, streamPointsMode: config.streamPointsMode, truncated: selected.truncated, truncatedReason: selected.reason, parserWarnings: [] },
    testId: session?.activeTestId ?? null, startedAt, endedAt, durationMs: ms, operatorLogin, operatorId: operatorLogin, barcode: result.barcode, matchedKey, programNumber, programText, resultStatus: status, resultRawStatus: result.resultRawStatus ?? result.result, leakValue: result.leakValue, leakUnit: result.leakUnit, leakText: leakText(result.leakValue, result.leakUnit), curvePointCount: curves.pointCount, curveUnit: result.leakUnit, curvePoints: legacyCurvePoints(selected.points), lpcResultFrameFormat: result.resultFrameFormat ?? 1, lpcMessageId: result.lpcMessageId ?? result.messageId, lpcMessageType: result.lpcMessageType ?? result.messageType, lpcChannel: result.lpcChannel ?? result.channel, lpcProgram: result.lpcProgram ?? programNumber, lpcProgramText: result.lpcProgramText ?? programText, lpcTesterTime: result.lpcTesterTime ?? result.testerTime, lpcTesterDate: result.lpcTesterDate ?? result.testerDate, lpcUniqueId: result.lpcUniqueId ?? result.uniqueId, lpcProgramEvaluation: result.lpcProgramEvaluation ?? result.programEvaluation, lpcSpcFlag: result.lpcSpcFlag ?? result.spcFlag, lpcAllResultInformation: result.lpcAllResultInformation ?? null, RL: result.RL, RL_unit: result.RL_unit, Pt: result.Pt, Pt_unit: result.Pt_unit, EDC: result.EDC, EDC_unit: result.EDC_unit, PL: result.PL, PL_unit: result.PL_unit, LLR: result.LLR, LLR_unit: result.LLR_unit, HLR: result.HLR, HLR_unit: result.HLR_unit, FPR: result.FPR, FPR_unit: result.FPR_unit, errorCode: result.errorCode ?? null, errorMessage: result.errorMessage ?? null,
  }, fields: fields(config) };
}

export function buildSplunkErrorEnvelope(config: SplunkRuntimeConfig, context: SplunkErrorContext): SplunkHecEnvelope {
  const endedAt = context.session.completedAt ?? context.session.timeoutAt ?? new Date().toISOString();
  const selected = pickPoints(context.curvePoints, config);
  const curves = buildCurves(selected.points);
  return { time: unixTime(endedAt), sourcetype: config.sourcetype, index: config.index, source: config.source, event: { eventType: 'lpc_test_result', schemaVersion: 2, name: 'LPC.TestFinished', site: config.site, line: config.line, workplace: config.workplace, device: config.device, app: 'lpc-528-app', station: { site: config.site, line: config.line, workplace: config.workplace, device: config.device, source: config.source }, testId: context.session.activeTestId, startedAt: context.session.startedAt, endedAt, durationMs: durationMs(context.session.startedAt, endedAt), operatorLogin: context.session.operatorLogin ?? null, operatorId: context.session.operatorLogin ?? null, barcode: context.session.barcode, matchedKey: context.session.barcode, programNumber: context.session.programNumber, programText: context.session.programText, resultStatus: 'ERROR', resultRawStatus: context.reason, leakValue: null, leakUnit: null, leakText: null, curvePointCount: curves.pointCount, curveUnit: null, curvePoints: legacyCurvePoints(selected.points), test: { id: context.session.activeTestId, startedAt: context.session.startedAt, endedAt, durationMs: durationMs(context.session.startedAt, endedAt), durationSec: null, status: 'error', activeTestEndReason: context.reason, resultFrameFormat: context.config.LPC_RESULT_FRAME_FORMAT }, operator: { id: context.session.operatorUserId ?? context.session.operatorLogin, login: context.session.operatorLogin, role: null }, product: { barcode: context.session.barcode, matchedKey: context.session.barcode }, program: { number: context.session.programNumber, text: context.session.programText }, result: { status: 'ERROR', rawStatus: context.reason, isOk: false, isNok: false, isError: true, errorCode: context.reason, errorMessage: context.message }, measurements: { main: null, items: {} }, process: buildProcess(context.curvePoints), curves, summary: buildSummary(context.curvePoints), raw: { resultLine: null, resultNormalized: null, streamFirstLine: null, streamLastLine: null, streamLineCount: context.curvePoints.length }, diagnostics: { splunkPayloadSchemaVersion: 2, bufferedStreamPoints: context.curvePoints.length, sentStreamPoints: selected.points.length, streamPointsMode: config.streamPointsMode, truncated: selected.truncated, truncatedReason: selected.reason, parserWarnings: [] }, errorCode: context.reason, errorMessage: context.message }, fields: fields(config) };
}
