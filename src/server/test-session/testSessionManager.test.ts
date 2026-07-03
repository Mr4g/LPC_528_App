import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDatabase } from '../db/database';
import { TestSessionManager } from './testSessionManager';
import type { CurrentTest } from '../../shared/types';

function createIo() {
  return { emit: vi.fn() } as never;
}

function currentTest(patch: Partial<CurrentTest> = {}): CurrentTest {
  return {
    barcode: '5901234123457',
    program: 17,
    programText: 'P17',
    createdAt: new Date().toISOString(),
    operatorUserId: 'op-1',
    operatorLogin: 'OPR',
    operatorRole: 'operator',
    ...patch,
  } as CurrentTest;
}

describe('TestSessionManager active test timeouts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not timeout after 5 seconds while LPC data keeps flowing and finishes on final result', () => {
    const onEnded = vi.fn();
    const manager = new TestSessionManager(new AppDatabase(':memory:'), createIo(), { activeTestTimeoutMs: 180_000, noDataWarningMs: 15_000, noDataTimeoutMs: 30_000, onEnded });
    manager.start(currentTest());

    for (let elapsed = 100; elapsed <= 15_000; elapsed += 100) {
      vi.advanceTimersByTime(100);
      manager.markLpcData(new Date(Date.now()).toISOString());
    }

    expect(manager.getStatus()).toMatchObject({ locked: true, status: 'running' });
    expect(onEnded).not.toHaveBeenCalled();

    manager.complete('ACCEPT');
    expect(manager.getStatus()).toMatchObject({ locked: false, status: 'completed' });
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('keeps a 60 second streaming test active and emits no timeout event before final result', () => {
    const onEnded = vi.fn();
    const manager = new TestSessionManager(new AppDatabase(':memory:'), createIo(), { activeTestTimeoutMs: 180_000, noDataWarningMs: 15_000, noDataTimeoutMs: 30_000, onEnded });
    manager.start(currentTest());

    for (let elapsed = 1_000; elapsed <= 60_000; elapsed += 1_000) {
      vi.advanceTimersByTime(1_000);
      manager.markLpcData(new Date(Date.now()).toISOString());
    }

    expect(manager.getStatus()).toMatchObject({ locked: true, status: 'running' });
    manager.complete('REJECT');
    expect(manager.getStatus()).toMatchObject({ locked: false, status: 'completed' });
    expect(onEnded).toHaveBeenCalledTimes(0);
  });

  it('warns when no LPC data arrives but only times out after no-data timeout', () => {
    const onEnded = vi.fn();
    const manager = new TestSessionManager(new AppDatabase(':memory:'), createIo(), { activeTestTimeoutMs: 180_000, noDataWarningMs: 15_000, noDataTimeoutMs: 30_000, onEnded });
    manager.start(currentTest());

    vi.advanceTimersByTime(15_000);
    expect(manager.getStatus()).toMatchObject({ locked: true, message: 'Brak nowych danych z LPC' });
    expect(onEnded).not.toHaveBeenCalled();

    vi.advanceTimersByTime(15_000);
    expect(manager.getStatus()).toMatchObject({ locked: false, status: 'timeout', message: 'Test nie otrzymał wyniku końcowego z LPC po zaniku danych' });
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(onEnded.mock.calls[0][1]).toBe('TIMEOUT');
  });

  it('uses max duration timeout when data keeps coming but final result never arrives', () => {
    const onEnded = vi.fn();
    const manager = new TestSessionManager(new AppDatabase(':memory:'), createIo(), { activeTestTimeoutMs: 60_000, noDataWarningMs: 15_000, noDataTimeoutMs: 30_000, onEnded });
    manager.start(currentTest());

    for (let elapsed = 1_000; elapsed <= 59_000; elapsed += 1_000) {
      vi.advanceTimersByTime(1_000);
      manager.markLpcData(new Date(Date.now()).toISOString());
    }
    expect(manager.getStatus().locked).toBe(true);

    vi.advanceTimersByTime(1_000);
    expect(manager.getStatus()).toMatchObject({ locked: false, status: 'timeout', message: 'Test przekroczył maksymalny awaryjny czas oczekiwania na wynik' });
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('does not send two terminal events for one test when final result completes it', () => {
    const onEnded = vi.fn();
    const manager = new TestSessionManager(new AppDatabase(':memory:'), createIo(), { activeTestTimeoutMs: 180_000, noDataWarningMs: 15_000, noDataTimeoutMs: 30_000, onEnded });
    manager.start(currentTest());
    manager.markLpcData(new Date(Date.now()).toISOString());
    manager.complete('ACCEPT');

    vi.advanceTimersByTime(180_000);
    expect(manager.getStatus()).toMatchObject({ locked: false, status: 'completed' });
    expect(onEnded).toHaveBeenCalledTimes(0);
  });
});
