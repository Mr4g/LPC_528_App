import crypto from 'node:crypto';
import type { Server } from 'socket.io';
import type { CurrentTest } from '../../shared/types';
import type { AppDatabase, StoredTestSession } from '../db/database';

export type TestSessionStatus = 'idle' | 'program_selected' | 'starting' | 'running' | 'waiting_for_result' | 'completed' | 'timeout' | 'error';

const LOCKED_STATUSES = new Set<TestSessionStatus>(['starting', 'running', 'waiting_for_result']);

export interface TestSessionState {
  ok: true;
  status: TestSessionStatus;
  locked: boolean;
  activeTestId: string | null;
  barcode: string | null;
  programNumber: number | null;
  programText: string | null;
  operatorUserId: string | null;
  operatorLogin: string | null;
  startedAt: string | null;
  firstLpcDataAt: string | null;
  lastLpcDataAt: string | null;
  lastStreamAt: string | null;
  finalResultAt: string | null;
  completedAt: string | null;
  timeoutAt: string | null;
  message: string | null;
}

export class TestSessionManager {
  private state: TestSessionState;
  private timeoutHandle: NodeJS.Timeout | null = null;
  private noDataWarningEmitted = false;

  constructor(
    private readonly database: AppDatabase,
    private readonly io: Server,
    private readonly options: { activeTestTimeoutMs: number; noDataWarningMs: number; noDataTimeoutMs: number; onEnded?: (state: TestSessionState, reason: string) => void },
  ) {
    this.state = this.restoreInitialState();
    if (this.state.locked) this.scheduleTimeoutCheck();
  }

  getStatus(): TestSessionState {
    return { ...this.state, locked: LOCKED_STATUSES.has(this.state.status) };
  }

  assertCanStart(): { ok: true } | { ok: false; response: unknown } {
    const status = this.getStatus();
    if (!status.locked) return { ok: true };
    return {
      ok: false,
      response: {
        ok: false,
        code: 'TEST_IN_PROGRESS',
        errorCode: 'TEST_IN_PROGRESS',
        message: 'Test jest w toku. Poczekaj na wynik przed kolejnym skanem.',
        activeTest: status,
      },
    };
  }

  start(currentTest: CurrentTest): TestSessionState {
    this.clearTimeoutCheck();
    this.noDataWarningEmitted = false;
    const now = new Date().toISOString();
    const activeTestId = crypto.randomUUID();
    console.log(`[ACTIVE_TEST] started testId=${activeTestId} barcode=${currentTest.barcode} program=${currentTest.programText}`);
    this.state = {
      ok: true,
      status: 'waiting_for_result',
      locked: true,
      activeTestId,
      barcode: currentTest.barcode,
      programNumber: currentTest.program,
      programText: currentTest.programText,
      operatorUserId: currentTest.operatorUserId ?? null,
      operatorLogin: currentTest.operatorLogin ?? null,
      startedAt: now,
      firstLpcDataAt: null,
      lastLpcDataAt: null,
      lastStreamAt: null,
      finalResultAt: null,
      completedAt: null,
      timeoutAt: null,
      message: 'Test w toku — poczekaj na wynik',
    };
    this.persistAndEmit();
    this.scheduleTimeoutCheck();
    return this.getStatus();
  }

  markLpcData(at = new Date().toISOString()): void {
    if (!LOCKED_STATUSES.has(this.state.status)) return;
    const first = !this.state.firstLpcDataAt;
    if (first) console.log(`[ACTIVE_TEST] first_lpc_data testId=${this.state.activeTestId}`);
    console.log(`[ACTIVE_TEST] lpc_data testId=${this.state.activeTestId} lastLpcDataAt=${at}`);
    this.noDataWarningEmitted = false;
    this.state = {
      ...this.state,
      status: 'running',
      firstLpcDataAt: this.state.firstLpcDataAt ?? at,
      lastLpcDataAt: at,
      lastStreamAt: at,
      message: 'Trwa test — poczekaj na wynik',
    };
    this.persistAndEmit();
    this.scheduleTimeoutCheck();
  }

  markStream(): void {
    this.markLpcData();
  }

  complete(status?: string): void {
    const now = new Date().toISOString();
    console.log(`[ACTIVE_TEST] final_result_received testId=${this.state.activeTestId} status=${status ?? 'UNKNOWN'}`);
    console.log(`[ACTIVE_TEST] ended reason=final_result testId=${this.state.activeTestId}`);
    this.clearTimeoutCheck();
    this.state = { ...this.state, status: 'completed', locked: false, finalResultAt: now, completedAt: now, message: 'Test zakończony' };
    this.persistAndEmit();
  }

  fail(message: string, reason = 'PROGRAM_START_FAILED'): void {
    console.log(`[ACTIVE_TEST] ended reason=${reason} testId=${this.state.activeTestId}`);
    this.clearTimeoutCheck();
    this.state = { ...this.state, status: 'error', locked: false, completedAt: new Date().toISOString(), message };
    this.persistAndEmit();
    this.options.onEnded?.(this.getStatus(), reason);
  }

  unlock(actorLogin: string | null): TestSessionState {
    this.clearTimeoutCheck();
    this.state = { ...this.state, status: 'error', locked: false, timeoutAt: new Date().toISOString(), message: `Test odblokowany ręcznie${actorLogin ? ` przez ${actorLogin}` : ''}` };
    this.persistAndEmit();
    this.options.onEnded?.(this.getStatus(), 'MANUAL_UNLOCK');
    return this.getStatus();
  }

  getActiveTestId(): string | null {
    return this.state.activeTestId;
  }

  private checkTimeouts(): void {
    if (!LOCKED_STATUSES.has(this.state.status)) return;
    const nowMs = Date.now();
    const startedMs = this.state.startedAt ? Date.parse(this.state.startedAt) : nowMs;
    const lastDataMs = this.state.lastLpcDataAt ? Date.parse(this.state.lastLpcDataAt) : startedMs;
    const durationMs = nowMs - startedMs;
    const lastDataAgeMs = nowMs - lastDataMs;

    if (durationMs >= this.options.activeTestTimeoutMs) {
      this.endTimeout('max_duration_timeout', 'Test przekroczył maksymalny awaryjny czas oczekiwania na wynik');
      return;
    }

    if (lastDataAgeMs >= this.options.noDataTimeoutMs) {
      this.endTimeout('no_data_timeout', 'Test nie otrzymał wyniku końcowego z LPC po zaniku danych');
      return;
    }

    if (!this.noDataWarningEmitted && lastDataAgeMs >= this.options.noDataWarningMs) {
      this.noDataWarningEmitted = true;
      console.log(`[ACTIVE_TEST] no_data_warning testId=${this.state.activeTestId} idleMs=${lastDataAgeMs}`);
      this.state = { ...this.state, message: 'Brak nowych danych z LPC' };
      this.persistAndEmit();
    }

    if (this.state.lastLpcDataAt) {
      console.log(`[ACTIVE_TEST] timeout_ignored_data_flowing testId=${this.state.activeTestId} durationMs=${durationMs} lastDataAgeMs=${lastDataAgeMs}`);
    }
    this.scheduleTimeoutCheck();
  }

  private endTimeout(logReason: 'no_data_timeout' | 'max_duration_timeout', message: string): void {
    console.log(`[ACTIVE_TEST] ended reason=${logReason} testId=${this.state.activeTestId}`);
    this.clearTimeoutCheck();
    this.state = { ...this.state, status: 'timeout', locked: false, timeoutAt: new Date().toISOString(), message };
    this.persistAndEmit();
    this.options.onEnded?.(this.getStatus(), 'TIMEOUT');
  }

  private scheduleTimeoutCheck(): void {
    this.clearTimeoutCheck();
    if (!LOCKED_STATUSES.has(this.state.status)) return;
    const nowMs = Date.now();
    const startedMs = this.state.startedAt ? Date.parse(this.state.startedAt) : nowMs;
    const lastDataMs = this.state.lastLpcDataAt ? Date.parse(this.state.lastLpcDataAt) : startedMs;
    const nextWarningIn = this.noDataWarningEmitted ? Number.POSITIVE_INFINITY : Math.max(0, this.options.noDataWarningMs - (nowMs - lastDataMs));
    const nextNoDataIn = Math.max(0, this.options.noDataTimeoutMs - (nowMs - lastDataMs));
    const nextMaxIn = Math.max(0, this.options.activeTestTimeoutMs - (nowMs - startedMs));
    const nextDelay = Math.max(1, Math.min(nextWarningIn, nextNoDataIn, nextMaxIn));
    this.timeoutHandle = setTimeout(() => this.checkTimeouts(), nextDelay);
  }

  private clearTimeoutCheck(): void {
    if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
    this.timeoutHandle = null;
  }

  private persistAndEmit(): void {
    this.database.upsertTestSession(this.toStoredSession());
    this.io.emit('test-session:updated', this.getStatus());
  }

  private restoreInitialState(): TestSessionState {
    const stored = this.database.getLatestTestSession();
    if (!stored) return this.idle();
    const status = stored.status as TestSessionStatus;
    const startedMs = stored.startedAt ? Date.parse(stored.startedAt) : 0;
    if (LOCKED_STATUSES.has(status) && startedMs && Date.now() - startedMs > this.options.activeTestTimeoutMs) {
      const timeoutState = this.fromStored(stored, 'timeout', false, 'Test przekroczył maksymalny awaryjny czas oczekiwania na wynik po restarcie aplikacji');
      this.database.upsertTestSession(this.toStoredSession(timeoutState));
      return timeoutState;
    }
    return this.fromStored(stored, status, LOCKED_STATUSES.has(status), stored.message);
  }

  private idle(): TestSessionState {
    return { ok: true, status: 'idle', locked: false, activeTestId: null, barcode: null, programNumber: null, programText: null, operatorUserId: null, operatorLogin: null, startedAt: null, firstLpcDataAt: null, lastLpcDataAt: null, lastStreamAt: null, finalResultAt: null, completedAt: null, timeoutAt: null, message: null };
  }

  private fromStored(stored: StoredTestSession, status: TestSessionStatus, locked: boolean, message: string | null): TestSessionState {
    return { ok: true, status, locked, activeTestId: stored.id, barcode: stored.barcode, programNumber: stored.programNumber, programText: stored.programText, operatorUserId: stored.operatorUserId, operatorLogin: stored.operatorLogin, startedAt: stored.startedAt, firstLpcDataAt: stored.firstLpcDataAt, lastLpcDataAt: stored.lastLpcDataAt ?? stored.lastStreamAt, lastStreamAt: stored.lastStreamAt, finalResultAt: stored.finalResultAt, completedAt: stored.completedAt, timeoutAt: stored.timeoutAt, message };
  }

  private toStoredSession(state = this.state): StoredTestSession {
    return { id: state.activeTestId ?? 'idle', status: state.status, barcode: state.barcode, programNumber: state.programNumber, programText: state.programText, operatorUserId: state.operatorUserId, operatorLogin: state.operatorLogin, startedAt: state.startedAt, firstLpcDataAt: state.firstLpcDataAt, lastLpcDataAt: state.lastLpcDataAt, finalResultAt: state.finalResultAt, completedAt: state.completedAt, lastStreamAt: state.lastStreamAt, timeoutAt: state.timeoutAt, message: state.message };
  }
}
