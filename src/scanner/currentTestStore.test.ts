import { describe, expect, it } from 'vitest';
import type { CurrentTest } from '../shared/types';
import { CurrentTestStore } from './currentTestStore';

function currentTest(selectedAt = new Date().toISOString()): CurrentTest {
  return {
    type: 'current_test',
    barcode: '7472475',
    matchedKey: '7472475',
    program: 1,
    programText: 'P01',
    selectedAt,
  };
}

describe('CurrentTestStore', () => {
  it('stores and returns currentTest', () => {
    const store = new CurrentTestStore();
    const test = currentTest();

    store.set(test);

    expect(store.get()).toBe(test);
    expect(store.isValid()).toBe(true);
  });

  it('clears currentTest', () => {
    const store = new CurrentTestStore();
    store.set(currentTest());

    store.clear();

    expect(store.get()).toBeNull();
    expect(store.isValid()).toBe(false);
  });

  it('returns false for an old currentTest', () => {
    const store = new CurrentTestStore();
    store.set(currentTest('2020-01-01T00:00:00.000Z'));

    expect(store.isValid(1000)).toBe(false);
  });
});
