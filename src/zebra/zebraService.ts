import type { LpcResultValue } from '../shared/types';
import { buildResultLabelZpl } from './zplBuilder';
import type { ZebraClient } from './zebraClient';
import type { ZebraConfig } from './zebraConfig';
import type { ZebraPrintContext, ZebraPrintResult, ZebraResultLabelInput, ZebraLabelResultStatus, ZebraResultLike } from './zebraTypes';

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
  return [result.receivedAt, result.barcode, result.programText ?? result.program, result.result ?? result.value].filter(Boolean).join('|');
}

export class ZebraService {
  private readonly printedResultIds = new Set<string>();

  constructor(private readonly config: ZebraConfig, private readonly client: ZebraClient) {}

  getStatus() {
    const { enabled, host, port, printOnResult, labelWidthMm, labelHeightMm, dpi, orientation } = this.config;
    return { enabled, host, port, printOnResult, labelWidthMm, labelHeightMm, dpi, orientation };
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

  async printResultLabel(result: ZebraResultLike, context: ZebraPrintContext = {}): Promise<ZebraPrintResult> {
    if (!this.config.enabled) return { ok: false, status: 'skipped', message: 'Drukarka Zebra jest wyłączona w konfiguracji' };
    if (context.auto && !this.config.printOnResult) return { ok: true, status: 'skipped', message: 'Automatyczny wydruk Zebra jest wyłączony' };
    const resultId = buildResultKey(result);
    if (context.auto && !context.allowDuplicate && resultId && this.printedResultIds.has(resultId)) {
      console.info(`[ZEBRA] Skipped duplicate result ${resultId}`);
      return { ok: true, status: 'duplicate', message: 'Wynik był już drukowany automatycznie', resultId };
    }
    const input = this.buildLabelInput(result, context.operatorLogin);
    const zpl = buildResultLabelZpl(input, this.config);
    const sent = await this.client.sendZpl(zpl);
    if (!sent.ok) {
      console.error(`[ZEBRA] Print failed: ${sent.error}`);
      return { ok: false, status: 'failed', message: 'Nie udało się wysłać etykiety do drukarki', resultId, zpl, error: sent.error };
    }
    if (context.auto && resultId) this.printedResultIds.add(resultId);
    console.info(`[ZEBRA] Printed label for result ${resultId || '(no-id)'}`);
    return { ok: true, status: 'printed', message: 'Wydrukowano etykietę', resultId, zpl };
  }

  async printTestLabel(operatorLogin?: string | null): Promise<ZebraPrintResult> {
    return this.printResultLabel({ result: 'ACCEPT', leakValue: 7.253, leakUnit: 'pa/s', operatorLogin: operatorLogin ?? 'TEST' }, { operatorLogin, allowDuplicate: true });
  }
}
