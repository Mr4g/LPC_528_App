import type { EnrichedLpcResult } from './LpcLineProcessor';

export class ResultHistoryStore {
  private results: EnrichedLpcResult[] = [];

  constructor(private readonly limit = 50) {}

  add(result: EnrichedLpcResult): void {
    this.results = [result, ...this.results].slice(0, this.limit);
  }

  getAll(): EnrichedLpcResult[] {
    return [...this.results];
  }

  clear(): void {
    this.results = [];
  }
}
