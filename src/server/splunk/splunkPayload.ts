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

function mapCurve(points: LpcCurvePoint[], unit: string | null) {
  return {
    pointCount: points.length,
    unit,
    points: points.map((point, index) => ({
      t: index,
      elapsedSec: point.elapsedTimeSec,
      value: point.pressureMbar,
      raw: point.segment,
    })),
  };
}

export function buildSplunkResultEnvelope(config: SplunkRuntimeConfig, context: SplunkResultContext): SplunkHecEnvelope {
  const { result, session } = context;
  const endedAt = session?.completedAt ?? result.receivedAt;
  const programText = result.currentTestProgramText ?? result.programText ?? result.program;
  const programNumber = result.currentTestProgram ?? (programText?.startsWith('P') ? Number(programText.slice(1)) : null);
  const matchedKey = result.currentTestBarcode ?? result.barcode;
  const curve = config.sendCurve ? mapCurve(context.curvePoints, result.leakUnit) : mapCurve([], result.leakUnit);

  return {
    time: unixTime(endedAt),
    index: config.index,
    source: config.source,
    sourcetype: config.sourcetype,
    event: {
      eventType: 'lpc_test_result',
      device: config.source,
      app: 'lpc-528-app',
      testId: session?.activeTestId ?? null,
      startedAt: session?.startedAt ?? result.currentTestSelectedAt ?? null,
      endedAt,
      durationMs: durationMs(session?.startedAt, endedAt),
      operatorLogin: result.operatorLogin ?? session?.operatorLogin ?? null,
      barcode: result.barcode,
      matchedKey,
      programNumber,
      programText,
      resultStatus: resultStatus(result.result),
      resultRawStatus: result.result,
      leakValue: result.leakValue,
      leakUnit: result.leakUnit,
      leakText: leakText(result.leakValue, result.leakUnit),
      lpc: {
        host: context.config.LPC_HOST,
        telnetPort: context.config.LPC_PORT,
        interfaceSelection: Number(context.config.LPC_INTERFACE_SELECTION),
      },
      curve,
      errors: null,
    },
  };
}

export function buildSplunkErrorEnvelope(config: SplunkRuntimeConfig, context: SplunkErrorContext): SplunkHecEnvelope {
  const endedAt = context.session.completedAt ?? context.session.timeoutAt ?? new Date().toISOString();
  return {
    time: unixTime(endedAt),
    index: config.index,
    source: config.source,
    sourcetype: config.sourcetype,
    event: {
      eventType: 'lpc_test_result',
      device: config.source,
      app: 'lpc-528-app',
      testId: context.session.activeTestId,
      startedAt: context.session.startedAt,
      endedAt,
      durationMs: durationMs(context.session.startedAt, endedAt),
      operatorLogin: context.session.operatorLogin ?? null,
      barcode: context.session.barcode,
      matchedKey: context.session.barcode,
      programNumber: context.session.programNumber,
      programText: context.session.programText,
      resultStatus: 'ERROR',
      resultRawStatus: context.reason,
      leakValue: null,
      leakUnit: null,
      leakText: null,
      lpc: { host: context.config.LPC_HOST, telnetPort: context.config.LPC_PORT, interfaceSelection: Number(context.config.LPC_INTERFACE_SELECTION) },
      curve: config.sendCurve ? mapCurve(context.curvePoints, null) : mapCurve([], null),
      errors: { reason: context.reason, message: context.message },
    },
  };
}
