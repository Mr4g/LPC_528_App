import { normalizeLpcLine } from './normalizeLpcLine';

const NOISE_PATTERNS = [
  /TCP\/IP INTERFACE SELECTION/i,
  /TREE ROOT/i,
  /Interface Connection/i,
  /Global config/i,
  /Channel config/i,
  /Result data/i,
  /Conditional Options/i,
  /Test Result Report/i,
  /Stop,\s*Test Result Report/i,
  /\bHelp\b/i,
  /Undefined command/i,
];

export function isInterfaceSelectionPrompt(payload: string): boolean {
  return payload.includes('* 1 Interface Connection1 *');
}

export function isIgnoredLpcLine(raw: string): boolean {
  const normalized = normalizeLpcLine(raw);

  if (!normalized) return true;
  if (normalized.startsWith('*')) return true;
  if (/^Q\s+\d+,/i.test(normalized)) return true;

  return NOISE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function containsResultFrameSignature(raw: string): boolean {
  return /\bC\d{2}\s+N\d+\s+P\d{2}\b/.test(normalizeLpcLine(raw));
}

export function isStopStreamingLine(raw: string): boolean {
  return /^\S+\s+X\s+Stop Streaming$/i.test(normalizeLpcLine(raw));
}
