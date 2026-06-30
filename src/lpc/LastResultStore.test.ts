import { describe, expect, it } from 'vitest';
import type { EnrichedLpcResult } from './LpcLineProcessor';
import { LastResultStore } from './LastResultStore';

const result = { result: 'ACCEPT', receivedAt: '2026-06-24T10:00:00.000Z' } as EnrichedLpcResult;

describe('LastResultStore', () => {
  it('stores, returns and clears the last result', () => {
    const store = new LastResultStore();
    store.set(result);
    expect(store.get()).toBe(result);
    store.clear();
    expect(store.get()).toBeNull();
  });
});
