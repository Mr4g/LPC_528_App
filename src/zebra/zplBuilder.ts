import type { ZebraLayoutConfig, ZebraResultLabelInput } from './zebraTypes';

export function mmToDots(mm: number, dpi: number): number {
  return Math.max(1, Math.round((mm / 25.4) * dpi));
}

export function sanitizeZplText(value: string): string {
  return value.replace(/[\^~]/g, ' ').replace(/[\r\n]+/g, ' ').trim().slice(0, 80);
}

export function buildResultLabelZpl(input: ZebraResultLabelInput, layout: ZebraLayoutConfig): string {
  const width = mmToDots(layout.labelWidthMm, layout.dpi);
  const height = mmToDots(layout.labelHeightMm, layout.dpi);
  const x = layout.offsetX;
  const y = layout.offsetY;
  const innerWidth = Math.max(20, width - (x * 2) - 8);
  const lineX = x + 6;
  const line1 = `TEST ${input.resultStatus} - ${input.testPressureLabel}`;
  const line2 = input.leakText || '-';
  const line3 = `${input.operatorLogin} ${input.dateText}`;

  return [
    '^XA',
    '^CI28',
    `^PW${width}`,
    `^LL${height}`,
    '^LH0,0',
    `^PQ${Math.max(1, layout.copies)}`,
    `^FO${x + 2},${y + 2}^GB${Math.max(10, width - 4 - x)},${Math.max(10, height - 4 - y)},${layout.frameThickness}^FS`,
    `^FO${lineX},${layout.line1Y}^A0N,${layout.fontLine1},${layout.fontLine1}^FB${innerWidth},1,0,C,0^FD${sanitizeZplText(line1)}^FS`,
    `^FO${lineX},${layout.line2Y}^A0N,${layout.fontLine2},${layout.fontLine2}^FB${innerWidth},1,0,C,0^FD${sanitizeZplText(line2)}^FS`,
    `^FO${lineX},${layout.line3Y}^A0N,${layout.fontLine3},${layout.fontLine3}^FB${innerWidth},1,0,C,0^FD${sanitizeZplText(line3)}^FS`,
    '^XZ',
  ].join('\n');
}
