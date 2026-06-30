import net from 'node:net';
import type { AppConfig } from '../config';
import type { LabelPrintMode, LpcResult } from '../shared/types';

export function shouldPrintForResult(result: LpcResult['result'], mode: LabelPrintMode = 'ok_only'): boolean {
  if (result === 'ACCEPT') return mode === 'ok_only' || mode === 'ok_and_nok';
  if (result === 'REJECT') return mode === 'ok_and_nok';
  return false;
}

function formatLeak(value: number | null, unit: string | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  const text = value.toLocaleString('pl-PL', { maximumFractionDigits: 3 });
  return unit ? `${text} ${unit}` : text;
}

function formatDate(date = new Date()): string {
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
}

function sanitizeZplText(value: string): string {
  return value.replace(/\^/g, '').replace(/~/g, '').trim();
}

export class ZebraPrinter {
  private printedKeys = new Set<string>();

  constructor(private readonly config?: Pick<AppConfig,
    'ZEBRA_HOST' | 'ZEBRA_PORT' | 'ZEBRA_LABEL_WIDTH_DOTS' | 'ZEBRA_LABEL_HEIGHT_DOTS' | 'ZEBRA_TEXT_X' | 'ZEBRA_TEXT_WIDTH_DOTS' |
    'ZEBRA_LINE1_Y' | 'ZEBRA_LINE2_Y' | 'ZEBRA_LINE3_Y' | 'ZEBRA_FONT_LINE1_HEIGHT' | 'ZEBRA_FONT_LINE1_WIDTH' |
    'ZEBRA_FONT_LINE2_HEIGHT' | 'ZEBRA_FONT_LINE2_WIDTH' | 'ZEBRA_FONT_LINE3_HEIGHT' | 'ZEBRA_FONT_LINE3_WIDTH'>) {}

  buildResultLabel(result: LpcResult): string {
    const c = this.config ?? {
      ZEBRA_LABEL_WIDTH_DOTS: 240, ZEBRA_LABEL_HEIGHT_DOTS: 220, ZEBRA_TEXT_X: 0, ZEBRA_TEXT_WIDTH_DOTS: 240,
      ZEBRA_LINE1_Y: 40, ZEBRA_LINE2_Y: 75, ZEBRA_LINE3_Y: 110,
      ZEBRA_FONT_LINE1_HEIGHT: 24, ZEBRA_FONT_LINE1_WIDTH: 24, ZEBRA_FONT_LINE2_HEIGHT: 24, ZEBRA_FONT_LINE2_WIDTH: 24,
      ZEBRA_FONT_LINE3_HEIGHT: 20, ZEBRA_FONT_LINE3_WIDTH: 20,
    };
    const okText = result.result === 'ACCEPT' ? 'OK' : 'NOK';
    const line1 = sanitizeZplText(`TEST ${okText} - 6 Bar`);
    const line2 = sanitizeZplText(formatLeak(result.leakValue, result.leakUnit));
    const operator = sanitizeZplText((result.operatorLogin || 'OP').toUpperCase());
    const line3 = sanitizeZplText(`${operator || 'OP'} ${formatDate()}`);
    return [
      '^XA', '^CI28', `^PW${c.ZEBRA_LABEL_WIDTH_DOTS}`, `^LL${c.ZEBRA_LABEL_HEIGHT_DOTS}`, '^LH0,0',
      `^FO${c.ZEBRA_TEXT_X},${c.ZEBRA_LINE1_Y}^A0N,${c.ZEBRA_FONT_LINE1_HEIGHT},${c.ZEBRA_FONT_LINE1_WIDTH}^FB${c.ZEBRA_TEXT_WIDTH_DOTS},1,0,C,0^FD${line1}^FS`,
      `^FO${c.ZEBRA_TEXT_X},${c.ZEBRA_LINE2_Y}^A0N,${c.ZEBRA_FONT_LINE2_HEIGHT},${c.ZEBRA_FONT_LINE2_WIDTH}^FB${c.ZEBRA_TEXT_WIDTH_DOTS},1,0,C,0^FD${line2}^FS`,
      `^FO${c.ZEBRA_TEXT_X},${c.ZEBRA_LINE3_Y}^A0N,${c.ZEBRA_FONT_LINE3_HEIGHT},${c.ZEBRA_FONT_LINE3_WIDTH}^FB${c.ZEBRA_TEXT_WIDTH_DOTS},1,0,C,0^FD${line3}^FS`,
      '^XZ',
    ].join('\n');
  }

  buildTinyResultLabel(result: 'OK' | 'NOK', programText: string, barcode: string): string {
    return this.buildResultLabel({ result: result === 'OK' ? 'ACCEPT' : 'REJECT', value: result === 'OK' ? 'ACCEPT' : 'REJECT', programText, barcode, leakValue: 7.253, leakUnit: 'pa/s', operatorLogin: 'GAZD' } as LpcResult);
  }

  getAutoPrintKey(result: LpcResult): string {
    return result.uniqueId || [result.barcode, result.programText ?? result.program, result.receivedAt, result.result].join('|');
  }

  async printResult(result: LpcResult): Promise<void> {
    if (!this.config) return;
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: this.config!.ZEBRA_HOST, port: this.config!.ZEBRA_PORT }, () => socket.end(this.buildResultLabel(result), 'utf8'));
      socket.on('error', reject);
      socket.on('close', () => resolve());
    });
  }

  markPrinted(key: string): void { this.printedKeys.add(key); }
  hasPrinted(key: string): boolean { return this.printedKeys.has(key); }
}
