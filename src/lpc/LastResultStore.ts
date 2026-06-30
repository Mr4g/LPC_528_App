import type { EnrichedLpcResult } from './LpcLineProcessor';

export class LastResultStore {
  private result: EnrichedLpcResult | null = null;

  set(result: EnrichedLpcResult): void {
    this.result = result;
  }

  get(): EnrichedLpcResult | null {
    return this.result;
  }

  clear(): void {
    this.result = null;
  }
}
