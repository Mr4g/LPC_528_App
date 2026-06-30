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
  operatorLogin: string | null;
  startedAt: string | null;
  lastStreamAt: string | null;
  completedAt: string | null;
  timeoutAt: string | null;
  message: string | null;
}

export class TestSessionManager {
  private state: TestSessionState;
  private timeoutHandle: NodeJS.Timeout | null = null;
  private noDataWarningHandle: NodeJS.Timeout | null = null;

  constructor(
    private readonly database: AppDatabase,
    private readonly io: Server,
    private readonly options: { activeTestTimeoutMs: number; noDataWarningMs: number },
  ) {
    this.state = this.restoreInitialState();
    if (this.state.locked) {
      this.scheduleTimeout();
      this.scheduleNoDataWarning();
    }
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
        errorCode: 'TEST_IN_PROGRESS',
        message: 'Test jest w toku. Poczekaj na zakończenie poprzedniego testu.',
        activeTest: status,
      },
    };
  }

  start(currentTest: CurrentTest): TestSessionState {
    this.clearTimeout();
    this.clearNoDataWarning();
    const now = new Date().toISOString();
    this.state = {
      ok: true,
      status: 'running',
      locked: true,
      activeTestId: crypto.randomUUID(),
      barcode: currentTest.barcode,
      programNumber: currentTest.program,
      programText: currentTest.programText,
      operatorLogin: currentTest.operatorLogin ?? null,
      startedAt: now,
      lastStreamAt: null,
      completedAt: null,
      timeoutAt: null,
      message: 'Test w toku — poczekaj na wynik',
    };
    this.persistAndEmit();
    this.scheduleTimeout();
    this.scheduleNoDataWarning();
    return this.getStatus();
  }

  markStream(): void {
    if (!LOCKED_STATUSES.has(this.state.status)) return;
    this.state = { ...this.state, status: 'running', lastStreamAt: new Date().toISOString(), message: null };
    this.clearNoDataWarning();
    this.persistAndEmit();
  }

  complete(): void {
    this.clearTimeout();
    this.clearNoDataWarning();
    this.state = { ...this.state, status: 'completed', locked: false, completedAt: new Date().toISOString(), message: 'Test zakończony' };
    this.persistAndEmit();
  }

  fail(message: string): void {
    this.clearTimeout();
    this.clearNoDataWarning();
    this.state = { ...this.state, status: 'error', locked: false, completedAt: new Date().toISOString(), message };
    this.persistAndEmit();
  }

  unlock(actorLogin: string | null): TestSessionState {
    this.clearTimeout();
    this.clearNoDataWarning();
    this.state = { ...this.state, status: 'error', locked: false, timeoutAt: new Date().toISOString(), message: `Test odblokowany ręcznie${actorLogin ? ` przez ${actorLogin}` : ''}` };
    this.persistAndEmit();
    return this.getStatus();
  }

  getActiveTestId(): string | null {
    return this.state.activeTestId;
  }

  private timeout(): void {
    if (!LOCKED_STATUSES.has(this.state.status)) return;
    this.state = { ...this.state, status: 'error', locked: false, timeoutAt: new Date().toISOString(), message: 'Program został wysłany do LPC, ale aplikacja nie otrzymała danych ze streamingu. Sprawdź połączenie Telnet/Interface Connection.' };
    this.persistAndEmit();
  }

  private scheduleTimeout(): void {
    this.clearTimeout();
    this.timeoutHandle = setTimeout(() => this.timeout(), this.options.activeTestTimeoutMs);
  }

  private scheduleNoDataWarning(): void {
    this.clearNoDataWarning();
    this.noDataWarningHandle = setTimeout(() => {
      if (!LOCKED_STATUSES.has(this.state.status) || this.state.lastStreamAt) return;
      this.state = { ...this.state, message: 'Brak danych ze streamingu LPC po starcie programu.' };
      this.persistAndEmit();
    }, this.options.noDataWarningMs);
  }

  private clearTimeout(): void {
    if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
    this.timeoutHandle = null;
  }

  private clearNoDataWarning(): void {
    if (this.noDataWarningHandle) clearTimeout(this.noDataWarningHandle);
    this.noDataWarningHandle = null;
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
      const timeoutState = this.fromStored(stored, 'timeout', false, 'Test przekroczył czas oczekiwania na wynik po restarcie aplikacji');
      this.database.upsertTestSession(this.toStoredSession(timeoutState));
      return timeoutState;
    }
    return this.fromStored(stored, status, LOCKED_STATUSES.has(status), stored.message);
  }

  private idle(): TestSessionState {
    return { ok: true, status: 'idle', locked: false, activeTestId: null, barcode: null, programNumber: null, programText: null, operatorLogin: null, startedAt: null, lastStreamAt: null, completedAt: null, timeoutAt: null, message: null };
  }

  private fromStored(stored: StoredTestSession, status: TestSessionStatus, locked: boolean, message: string | null): TestSessionState {
    return { ok: true, status, locked, activeTestId: stored.id, barcode: stored.barcode, programNumber: stored.programNumber, programText: stored.programText, operatorLogin: stored.operatorLogin, startedAt: stored.startedAt, lastStreamAt: stored.lastStreamAt, completedAt: stored.completedAt, timeoutAt: stored.timeoutAt, message };
  }

  private toStoredSession(state = this.state): StoredTestSession {
    return { id: state.activeTestId ?? 'idle', status: state.status, barcode: state.barcode, programNumber: state.programNumber, programText: state.programText, operatorLogin: state.operatorLogin, startedAt: state.startedAt, completedAt: state.completedAt, lastStreamAt: state.lastStreamAt, timeoutAt: state.timeoutAt, message: state.message };
  }
}
