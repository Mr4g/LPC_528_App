import type { ProgramStartResult } from '../shared/types';

export function getProgramStartOperatorMessage(result: ProgramStartResult, programText?: string): string {
  if (result.mode === 'mock') return 'TRYB MOCK — program nie jest wysyłany do LPC';
  if (result.success) return `Program ${programText ?? ''} wysłany do LPC`.trim();
  return result.message || result.errorMessage || 'Błąd wysłania programu do LPC';
}
