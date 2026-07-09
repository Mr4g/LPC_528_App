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

function isValidCurvePoint(point: LpcCurvePoint | null | undefined): point is LpcCurvePoint {
  return Boolean(
    point
    && Number.isFinite(point.elapsedTimeSec)
    && typeof point.segment === 'string'
    && point.segment.trim() !== ''
    && (Number.isFinite(point.pressureMbar) || Number.isFinite(point.pressureBar)),
  );
}

function sanitizeCurvePoints(points: LpcCurvePoint[]): LpcCurvePoint[] {
  return points.filter(isValidCurvePoint).map((point) => ({
    ...point,
    pressureMbar: Number.isFinite(point.pressureMbar) ? point.pressureMbar : (point.pressureBar ?? 0) * 1000,
  }));
}

function pickPoints(points: LpcCurvePoint[], config: SplunkRuntimeConfig): { points: LpcCurvePoint[]; truncated: boolean; reason: string | null } {
  const validPoints = sanitizeCurvePoints(points);
  if (!config.sendCurve || config.streamPointsMode === 'none') return { points: [], truncated: validPoints.length > 0, reason: config.streamPointsMode === 'none' ? 'streamPointsMode=none' : 'sendCurve=false' };
  const max = config.streamPointsMax;
  if (max === 0) return { points: [], truncated: validPoints.length > 0, reason: 'SPLUNK_STREAM_POINTS_MAX=0' };
  if (validPoints.length <= max) return { points: validPoints, truncated: false, reason: null };
  if (config.streamPointsMode === 'sampled') {
    const step = Math.ceil(validPoints.length / max);
    return { points: validPoints.filter((point, index) => index === 0 || index === validPoints.length - 1 || point.segment === 'DPT' || point.segment === 'EXH' || index % step === 0).slice(0, max), truncated: true, reason: `sampled_to_${max}` };
  }
  return { points: validPoints.slice(0, max), truncated: true, reason: `limited_to_${max}` };
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

function buildNestedCurve(points: LpcCurvePoint[]) {
  return {
    pointCount: points.length,
    dptPointCount: points.filter((point) => point.segment === 'DPT').length,
    unit: 'mbar',
    points: points.map((point) => ({
      elapsedTimeSec: point.elapsedTimeSec,
      remainingTimeSec: point.remainingTimeSec,
      pressureBar: point.pressureBar,
      pressureMbar: point.pressureMbar,
      segment: point.segment,
      liveLeakValue: point.liveLeakValue ?? point.RL ?? null,
      liveLeakUnit: point.liveLeakUnit ?? point.RL_unit ?? null,
      RL: point.RL ?? point.liveLeakValue ?? null,
      RL_unit: point.RL_unit ?? point.liveLeakUnit ?? null,
      messageId: point.messageId ?? null,
    })),
  };
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
  return Object.fromEntries(Object.entries({ site: config.site, line: config.line, workplace: config.workplace, device: config.device, workplaceName: config.workplace, isMachine: 'true', hostname: os.hostname(), app: 'lpc-528-app' }).filter(([, value]) => value !== null && value !== '')) as Record<string, string>;
}

function buildEventCounts(points: LpcCurvePoint[]) {
  const valid = sanitizeCurvePoints(points);
  return { curvePointCount: valid.length, dptPointCount: valid.filter((point) => point.segment === 'DPT' && Number.isFinite(point.liveLeakValue ?? point.RL)).length };
}

function min(values: number[]): number | null {
  return values.length ? Math.min(...values) : null;
}

function max(values: number[]): number | null {
  return values.length ? Math.max(...values) : null;
}

function dominantSegment(points: LpcCurvePoint[]): string | null {
  const counts = new Map<string, number>();
  for (const point of points) counts.set(point.segment, (counts.get(point.segment) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? points.at(-1)?.segment ?? null;
}

function buildSampledPoints(points: LpcCurvePoint[], config: SplunkRuntimeConfig) {
  const valid = sanitizeCurvePoints(points);
  const intervalSec = Math.max(config.curveSampleIntervalSec, 0.001);
  const maxPoints = config.curveSampleMaxPoints;
  if (!config.sendCurveSummary || maxPoints === 0 || valid.length === 0) return [];
  const firstElapsed = valid[0].elapsedTimeSec;
  const buckets = new Map<number, LpcCurvePoint[]>();
  for (const point of valid) {
    const bucket = Math.floor((point.elapsedTimeSec - firstElapsed) / intervalSec);
    const existing = buckets.get(bucket) ?? [];
    existing.push(point);
    buckets.set(bucket, existing);
  }

  const orderedBuckets = [...buckets.entries()].sort(([a], [b]) => a - b);
  const selectedBuckets = orderedBuckets.length <= maxPoints
    ? orderedBuckets
    : orderedBuckets.filter(([bucket, bucketPoints], index) => (
        index === 0
        || index === orderedBuckets.length - 1
        || bucketPoints.some((point) => point.segment === 'DPT')
        || bucket % Math.ceil(orderedBuckets.length / maxPoints) === 0
      )).slice(0, maxPoints);

  return selectedBuckets
    .map(([bucket, bucketPoints]) => {
      const pressureValues = bucketPoints
        .map((point) => point.pressureMbar)
        .filter((value): value is number => Number.isFinite(value));
      const rlValues = bucketPoints
        .filter((point) => point.segment === 'DPT')
        .map((point) => point.liveLeakValue ?? point.RL ?? null)
        .filter((value): value is number => Number.isFinite(value));
      return {
        t: Number((firstElapsed + bucket * intervalSec).toFixed(3)),
        segment: dominantSegment(bucketPoints),
        pressureMbarAvg: avg(pressureValues),
        pressureMbarMin: min(pressureValues),
        pressureMbarMax: max(pressureValues),
        rlAvg: avg(rlValues),
        rlMin: min(rlValues),
        rlMax: max(rlValues),
      };
    });
}

function buildCurveSummary(points: LpcCurvePoint[], config: SplunkRuntimeConfig) {
  const { curvePointCount, dptPointCount } = buildEventCounts(points);
  return {
    pointCount: curvePointCount,
    dptPointCount,
    pressureUnit: 'mbar',
    rlUnit: 'Pa/s',
    sampling: {
      enabled: config.sendCurveSummary,
      intervalSec: config.curveSampleIntervalSec,
      maxPoints: config.curveSampleMaxPoints,
      method: 'bucket_avg',
    },
    sampledPoints: buildSampledPoints(points, config),
  };
}

export function buildSplunkResultEnvelope(config: SplunkRuntimeConfig, context: SplunkResultContext): SplunkHecEnvelope {
  const { result, session } = context;
  const endedAt = session?.completedAt ?? result.receivedAt;
  const startedAt = session?.startedAt ?? result.currentTestSelectedAt ?? null;
  const ms = durationMs(startedAt, endedAt);
  const programText = result.currentTestProgramText ?? result.programText ?? result.program;
  const programNumber = result.currentTestProgram ?? (programText?.startsWith('P') ? Number(programText.slice(1)) : null);
  const matchedKey = result.currentTestBarcode ?? result.barcode;
  const operatorLogin = result.operatorLogin ?? session?.operatorLogin ?? null;
  const status = resultStatus(result.result);
  const { curvePointCount, dptPointCount } = buildEventCounts(context.curvePoints);
  const curveSummary = buildCurveSummary(context.curvePoints, config);

  return {
    time: unixTime(endedAt),
    sourcetype: config.sourcetype,
    index: config.index,
    source: config.source,
    event: {
      name: 'LPC.TestFinished',
      eventType: 'lpc_test_result',
      resultStatus: status,
      result: result.value ?? result.result,
      resultRawStatus: result.resultRawStatus ?? result.result,
      barcode: result.barcode,
      matchedKey,
      programNumber,
      programText,
      operatorLogin,
      operatorId: operatorLogin,
      testId: session?.activeTestId ?? null,
      startedAt,
      endedAt,
      durationMs: ms,
      leakType: result.leakType,
      leakValue: result.leakValue,
      leakUnit: result.leakUnit,
      leakText: leakText(result.leakValue, result.leakUnit),
      lpcMessageId: result.lpcMessageId ?? result.messageId,
      lpcMessageType: result.lpcMessageType ?? result.messageType,
      lpcChannel: result.lpcChannel ?? result.channel,
      lpcProgram: result.lpcProgram ?? programNumber,
      lpcProgramText: result.lpcProgramText ?? programText,
      lpcTesterTime: result.lpcTesterTime ?? result.testerTime,
      lpcTesterDate: result.lpcTesterDate ?? result.testerDate,
      lpcUniqueId: result.lpcUniqueId ?? result.uniqueId,
      lpcProgramEvaluation: result.lpcProgramEvaluation ?? result.programEvaluation,
      lpcTestType: result.testType,
      lpcTestEvaluation: result.testEvaluation,
      lpcSpcFlag: result.lpcSpcFlag ?? result.spcFlag,
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
      curvePointCount,
      dptPointCount,
      curveSummary,
      llControl: result.llControl ?? { requiredAtStart: false, flagId: null, testAllowedByRole: true, performedByRequiredRole: false, resolvedByThisTest: false },
      errorCode: result.errorCode ?? null,
      errorMessage: result.errorMessage ?? null,
    },
    fields: fields(config),
  };
}

export function buildSplunkErrorEnvelope(config: SplunkRuntimeConfig, context: SplunkErrorContext): SplunkHecEnvelope {
  const endedAt = context.session.completedAt ?? context.session.timeoutAt ?? new Date().toISOString();
  const ms = durationMs(context.session.startedAt, endedAt);
  const { curvePointCount, dptPointCount } = buildEventCounts(context.curvePoints);
  const curveSummary = buildCurveSummary(context.curvePoints, config);
  return {
    time: unixTime(endedAt),
    sourcetype: config.sourcetype,
    index: config.index,
    source: config.source,
    event: {
      name: 'LPC.TestFinished',
      eventType: 'lpc_test_result',
      resultStatus: 'ERROR',
      result: 'ERROR',
      resultRawStatus: context.reason,
      barcode: context.session.barcode,
      matchedKey: context.session.barcode,
      programNumber: context.session.programNumber,
      programText: context.session.programText,
      operatorLogin: context.session.operatorLogin ?? null,
      operatorId: context.session.operatorLogin ?? null,
      testId: context.session.activeTestId,
      startedAt: context.session.startedAt,
      endedAt,
      durationMs: ms,
      leakType: null,
      leakValue: null,
      leakUnit: null,
      leakText: null,
      lpcMessageId: null,
      lpcMessageType: null,
      lpcChannel: null,
      lpcProgram: context.session.programNumber,
      lpcProgramText: context.session.programText,
      lpcTesterTime: null,
      lpcTesterDate: null,
      lpcUniqueId: null,
      lpcProgramEvaluation: null,
      lpcTestType: null,
      lpcTestEvaluation: null,
      lpcSpcFlag: null,
      RL: null,
      RL_unit: null,
      Pt: null,
      Pt_unit: null,
      EDC: null,
      EDC_unit: null,
      PL: null,
      PL_unit: null,
      LLR: null,
      LLR_unit: null,
      HLR: null,
      HLR_unit: null,
      FPR: null,
      FPR_unit: null,
      llControl: { requiredAtStart: false, flagId: null, testAllowedByRole: false, performedByRequiredRole: false, resolvedByThisTest: false },
      curvePointCount,
      dptPointCount,
      curveSummary,
      errorCode: context.reason,
      errorMessage: context.message,
    },
    fields: fields(config),
  };
}
