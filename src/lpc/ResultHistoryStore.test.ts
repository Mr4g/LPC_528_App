import { describe, expect, it } from 'vitest';
import type { EnrichedLpcResult } from './LpcLineProcessor';
import { ResultHistoryStore } from './ResultHistoryStore';

function result(index: number): EnrichedLpcResult {
  return { receivedAt: `2026-06-24T10:00:${String(index).padStart(2, '0')}.000Z`, result: 'ACCEPT' } as EnrichedLpcResult;
}

describe('ResultHistoryStore', () => {
  it('keeps only the configured number of latest results', () => {
    const store = new ResultHistoryStore(50);
    for (let index = 0; index < 55; index += 1) store.add(result(index));

    expect(store.getAll()).toHaveLength(50);
    expect(store.getAll()[0].receivedAt).toBe('2026-06-24T10:00:54.000Z');
  });
});
