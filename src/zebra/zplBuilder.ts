import type { ZebraLayoutConfig, ZebraResultLabelInput } from './zebraTypes';

export function sanitizeZplText(value: string): string {
  return value.replace(/[\^~]/g, ' ').replace(/[\r\n]+/g, ' ').trim().slice(0, 80);
}

export function buildResultLabelZpl(input: ZebraResultLabelInput, layout: ZebraLayoutConfig): string {
  const line1 = `TEST ${input.resultStatus} - ${input.testPressureLabel}`;
  const line2 = input.leakText || '-';
  const line3 = `${input.operatorLogin} ${input.dateText}`;
  const fieldX = layout.textX;

  return [
    '^XA',
    '^CI28',
    `^PW${layout.widthDots}`,
    `^LL${layout.heightDots}`,
    `^LH${layout.labelOffsetX},${layout.labelOffsetY}`,
    `^PQ${Math.max(1, layout.copies)}`,
    `^FO${fieldX},${layout.line1Y}^A0N,${layout.fontLine1Height},${layout.fontLine1Width}^FB${layout.textWidthDots},1,0,C,0^FD${sanitizeZplText(line1)}^FS`,
    `^FO${fieldX},${layout.line2Y}^A0N,${layout.fontLine2Height},${layout.fontLine2Width}^FB${layout.textWidthDots},1,0,C,0^FD${sanitizeZplText(line2)}^FS`,
    `^FO${fieldX},${layout.line3Y}^A0N,${layout.fontLine3Height},${layout.fontLine3Width}^FB${layout.textWidthDots},1,0,C,0^FD${sanitizeZplText(line3)}^FS`,
    '^XZ',
  ].join('\n');
}
