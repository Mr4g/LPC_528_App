import type { LabelPrintMode, LpcResultValue } from '../shared/types';
import { buildResultLabelZpl } from './zplBuilder';
import type { ZebraClient } from './zebraClient';
import type { ZebraConfig } from './zebraConfig';
import { mergeZebraLayout } from './zebraConfig';
import type { ZebraPrintContext, ZebraPrintResult, ZebraResultLabelInput, ZebraLabelResultStatus, ZebraResultLike, ZebraLayoutConfig } from './zebraTypes';

export function mapResultStatus(result: string | null | undefined): ZebraLabelResultStatus {
  if (result === 'ACCEPT' || result === 'OK') return 'OK';
  if (result === 'REJECT' || result === 'NOK') return 'NOK';
  if (result === 'ERROR') return 'ERROR';
  return 'UNKNOWN';
}

export function formatLeakText(value: unknown, unit: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const rounded = Number(value.toFixed(3)).toLocaleString('pl-PL', { maximumFractionDigits: 3, minimumFractionDigits: 0 });
    return [rounded, typeof unit === 'string' && unit.trim() ? unit.trim() : ''].filter(Boolean).join(' ');
  }
  if (typeof value === 'string' && value.trim()) return [value.replace('.', ','), typeof unit === 'string' ? unit.trim() : ''].filter(Boolean).join(' ');
  return '-';
}

export function formatZebraDate(result: ZebraResultLike, now = new Date()): string {
  const raw = typeof result.testerDate === 'string' && result.testerDate.trim() ? result.testerDate.trim() : null;
  const match = raw?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (match) {
    const month = match[1].padStart(2, '0');
    const day = match[2].padStart(2, '0');
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${day}.${month}.${year}`;
  }
  return `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`;
}

export function resolveOperatorLogin(result: ZebraResultLike, fallback?: string | null): string {
  const login = (typeof result.operatorLogin === 'string' && result.operatorLogin.trim()) ? result.operatorLogin : fallback;
  return (login && login.trim() ? login.trim() : 'OP').toUpperCase();
}

export function buildResultKey(result: ZebraResultLike): string {
  if (result.uniqueId) return String(result.uniqueId);
  return [result.barcode, result.programText ?? result.program, result.testerDate, result.testerTime ?? result.receivedAt, result.result ?? result.value].filter(Boolean).join('|');
}

export function isAutoPrintAllowed(mode: LabelPrintMode | null | undefined, status: ZebraLabelResultStatus): boolean {
  const effectiveMode = mode ?? 'ok_only';
  if (effectiveMode === 'disabled') return false;
  if (status === 'OK') return effectiveMode === 'ok_only' || effectiveMode === 'ok_and_nok';
  if (status === 'NOK') return effectiveMode === 'ok_and_nok';
  return false;
}

export class ZebraService {
  private readonly printedResultIds = new Set<string>();

  constructor(private readonly config: ZebraConfig, private readonly client: ZebraClient, private readonly getRuntimeAutoPrintEnabled: () => boolean = () => true) {}

  getStatus() {
    const { enabled, host, port, printOnResult, widthDots, heightDots, dpi } = this.config;
    return { enabled, host, port, printOnResult, widthDots, heightDots, dpi, border: false };
  }

  getLayout(override: Partial<ZebraLayoutConfig> = {}): ZebraLayoutConfig {
    return mergeZebraLayout(this.config, override);
  }

  buildLabelInput(result: ZebraResultLike, operatorLogin?: string | null): ZebraResultLabelInput {
    const leakValue = result.leakValue ?? result.RL ?? result.LLR ?? result.HLR ?? null;
    const leakUnit = result.leakUnit ?? result.RL_unit ?? result.LLR_unit ?? result.HLR_unit ?? null;
    return {
      resultStatus: mapResultStatus((result.result ?? result.value) as LpcResultValue | string | null | undefined),
      testPressureLabel: this.config.testPressureLabel,
      leakText: formatLeakText(leakValue, leakUnit),
      operatorLogin: resolveOperatorLogin(result, operatorLogin),
      dateText: formatZebraDate(result),
      barcode: result.barcode,
      programText: result.programText ?? result.program ?? undefined,
      uniqueId: result.uniqueId ?? undefined,
    };
  }

  previewResultLabel(result: ZebraResultLike, context: ZebraPrintContext = {}): { zpl: string; layout: ZebraLayoutConfig; input: ZebraResultLabelInput } {
    const input = { ...this.buildLabelInput(result, context.operatorLogin), ...context.inputOverride };
    const layout = this.getLayout(context.layout);
    return { zpl: buildResultLabelZpl(input, layout), layout, input };
  }

  async printResultLabel(result: ZebraResultLike, context: ZebraPrintContext = {}): Promise<ZebraPrintResult> {
    if (!this.config.enabled) return { ok: false, status: 'skipped', message: 'Drukarka Zebra jest wyłączona w konfiguracji' };
    if (context.auto && !this.config.printOnResult) return { ok: true, status: 'skipped', message: 'Automatyczny wydruk Zebra jest wyłączony' };
    const runtimeEnabled = context.runtimeAutoPrintEnabled ?? this.getRuntimeAutoPrintEnabled();
    if (context.auto && !runtimeEnabled) {
      console.info('[ZEBRA] Auto print globally disabled by runtime setting');
      return { ok: true, status: 'skipped', message: 'Automatyczny wydruk Zebra jest wyłączony globalnie' };
    }
    const inputForPolicy = this.buildLabelInput(result, context.operatorLogin);
    const mode = context.labelPrintMode ?? result.labelPrintMode ?? 'ok_only';
    const resultId = buildResultKey(result);
    if (context.auto && resultId && this.printedResultIds.has(resultId)) {
      console.info(`[ZEBRA] Auto print skipped duplicate: resultId=${resultId}`);
      return { ok: true, status: 'duplicate', message: 'Wynik był już drukowany automatycznie', resultId };
    }
    if (context.auto && !isAutoPrintAllowed(mode, inputForPolicy.resultStatus)) {
      console.info(`[ZEBRA] Auto print skipped by barcode print mode: barcode=${result.barcode ?? '-'}, mode=${mode}, result=${inputForPolicy.resultStatus}`);
      return { ok: true, status: 'skipped', message: 'Automatyczny wydruk pominięty przez tryb drukowania etykiet', resultId };
    }
    if (context.auto) console.info(`[ZEBRA] Auto print allowed: barcode=${result.barcode ?? '-'}, mode=${mode}, result=${inputForPolicy.resultStatus}`);
    const { zpl, layout } = this.previewResultLabel(result, context);
    const sent = await this.client.sendZpl(zpl);
    if (!sent.ok) {
      console.error(`[ZEBRA] Print failed: ${sent.error}`);
      return { ok: false, status: 'failed', message: 'Nie udało się wysłać etykiety do drukarki', resultId, zpl, layout, error: sent.error };
    }
    if (context.auto && resultId) this.printedResultIds.add(resultId);
    console.info(`[ZEBRA] Printed label for result ${resultId || '(no-id)'}`);
    return { ok: true, status: 'printed', message: 'Wydrukowano etykietę', resultId, zpl, layout };
  }

  async printTestLabel(input: Partial<ZebraResultLabelInput> = {}, layout: Partial<ZebraLayoutConfig> = {}): Promise<ZebraPrintResult> {
    return this.printResultLabel(
      { result: input.resultStatus === 'NOK' ? 'REJECT' : 'ACCEPT', leakValue: 7.253, leakUnit: 'pa/s', operatorLogin: input.operatorLogin ?? 'GAZD' },
      { allowDuplicate: true, layout, inputOverride: { resultStatus: 'OK', testPressureLabel: this.config.testPressureLabel, leakText: '7,253 pa/s', operatorLogin: 'GAZD', dateText: '30.06.2026', ...input } },
    );
  }
}
