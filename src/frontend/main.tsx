import React, { FormEvent, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { getLatestEstimatedLeakTrend, normalizeEstimatedLeakWindowPoints } from '../shared/estimatedLeakTrend';
import type { BarcodeScan, CurrentTest, LpcResult, LpcStreamPoint, ProgramStartRequest, ProgramStartResult } from '../shared/types';
import { formatDateTime, formatMeasurement, formatNumber, formatResultLabel, getConnectionLabel, getResultClass } from './formatters';
import { LastResultPanel } from './components/LastResultPanel';
import carrierLogo from './assets/carrier-logo.svg';
import { PressureChart } from './components/PressureChart';
import { UserMenu } from './components/UserMenu';
import { getProgramStartOperatorMessage } from './programStartMessages';
import { mergeResultIntoHistory, replaceHistoryFromResultsUpdated } from './resultHistoryState';
import { persistTheme, readStoredTheme, type ThemeMode } from './theme';
import './styles.css';

interface ScanAcceptedPayload {
  scan: BarcodeScan;
  currentTest: CurrentTest;
  programStartRequest: ProgramStartRequest;
  programStart: ProgramStartResult;
  activeTest?: TestSessionState | null;
}

interface ScanRejectedPayload {
  ok?: false;
  barcode: string;
  error: 'NO_MAPPING' | 'TEST_IN_PROGRESS';
  code?: 'TEST_IN_PROGRESS';
  errorCode?: 'TEST_IN_PROGRESS';
  message: string;
  activeTest?: TestSessionState;
}

interface ScanAcceptedResponse extends ScanAcceptedPayload {
  ok: true;
}

type LpcConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | 'reconnecting' | 'error';

interface LpcStatusPayload {
  ok?: true;
  connected: boolean;
  status: LpcConnectionStatus;
  host: string;
  port: number;
  autoConnect: boolean;
  reconnectEnabled: boolean;
  reconnectDelayMs: number;
  connectTimeoutMs: number;
  lastConnectionAttemptAt: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastError: string | null;
  reconnectAttemptCount: number;
  nextReconnectAt: string | null;
  lastRawLinesCount?: number;
  curvePointCount?: number;
  lastDataReceivedAt?: string | null;
  lastSuccessfulWriteAt?: string | null;
  lastHeartbeatAt?: string | null;
  staleConnectionDetectedAt?: string | null;
  socketDestroyed?: boolean;
  socketWritable?: boolean;
}

interface SplunkStatusPayload {
  ok: true;
  enabled: boolean;
  configured: boolean;
  urlConfigured: boolean;
  tokenConfigured: boolean;
  index: string;
  source: string;
  sourcetype: string;
  verifyTls: boolean;
  site: string | null;
  line: string | null;
  workplace: string;
  device: string;
  pending: number;
  sending?: number;
  sent: number;
  failed?: number;
  lastError: string | null;
  bufferEnabled?: boolean;
  bufferWorkerEnabled?: boolean;
  retryIntervalMs?: number;
  lastRetryAt?: string | null;
  nextRetryAt?: string | null;
  lastSplunkStatus?: 'sent' | 'buffered' | 'failed' | 'disabled' | 'not_configured' | null;
  lastSplunkAt?: string | null;
  lastSplunkErrorCode?: number | null;
  lastSplunkErrorText?: string | null;
}

interface LpcPortCheckPayload {
  ok: true;
  host: string;
  port: number;
  reachable: boolean;
  latencyMs: number;
  error?: string;
}

interface LpcStreamPayload extends LpcStreamPoint {
  pressureMbar: number | null;
}

interface LpcCurvePoint {
  elapsedTimeSec: number;
  remainingTimeSec: number | null;
  pressureBar: number | null;
  pressureMbar: number | null;
  segment: string;
  liveLeakValue?: number | null;
  liveLeakUnit?: string | null;
  RL?: number | null;
  RL_unit?: string | null;
}

interface EnrichedLpcResult extends LpcResult {
  currentTestValid: boolean;
  currentTestBarcode?: string;
  currentTestProgram?: number;
  currentTestProgramText?: string;
  currentTestSelectedAt?: string;
}

type SocketHandler<TPayload> = (payload: TPayload) => void;

interface SocketLike {
  on(event: 'scan:accepted', handler: SocketHandler<ScanAcceptedPayload>): void;
  on(event: 'scan:rejected', handler: SocketHandler<ScanRejectedPayload>): void;
  on(event: 'lpc:status', handler: SocketHandler<LpcStatusPayload>): void;
  on(event: 'lpc:connected', handler: SocketHandler<LpcStatusPayload>): void;
  on(event: 'lpc:disconnected', handler: SocketHandler<LpcStatusPayload>): void;
  on(event: 'lpc:reconnecting', handler: SocketHandler<LpcStatusPayload>): void;
  on(event: 'lpc:error', handler: SocketHandler<{ message: string; state?: LpcStatusPayload }>): void;
  on(event: 'lpc:stream', handler: SocketHandler<LpcStreamPayload>): void;
  on(event: 'lpc:result', handler: SocketHandler<EnrichedLpcResult>): void;
  on(event: 'lpc:curve-updated', handler: SocketHandler<{ points: LpcCurvePoint[] }>): void;
  on(event: 'lpc:curve-completed', handler: SocketHandler<{ points: LpcCurvePoint[] }>): void;
  on(event: 'lpc:results-updated', handler: SocketHandler<{ results: EnrichedLpcResult[] }>): void;
  on(event: 'test:completed', handler: SocketHandler<EnrichedLpcResult>): void;
  on(event: 'test-session:updated', handler: SocketHandler<TestSessionState>): void;
  off(event: string): void;
  disconnect(): void;
}

declare global {
  interface Window {
    io?: () => SocketLike;
  }
}

type OperatorStatus = 'ready' | 'scanning' | 'program-selected' | 'no-mapping' | 'start-error';
type ClassifiedScan = { type: 'card'; value: string } | { type: 'barcode'; value: string } | { type: 'invalid'; value: string };
type UserRole = 'operator' | 'line_leader' | 'admin';
type ChartStatus = 'waiting' | 'live' | 'completed';
type TestSessionStatus = 'idle' | 'program_selected' | 'starting' | 'running' | 'waiting_for_result' | 'completed' | 'timeout' | 'error';

interface TestSessionState {
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
  firstLpcDataAt?: string | null;
  lastLpcDataAt?: string | null;
  lastStreamAt: string | null;
  finalResultAt?: string | null;
  completedAt: string | null;
  timeoutAt: string | null;
  message: string | null;
}

interface FinalMarkerResult {
  result: EnrichedLpcResult;
  displayLabel: string;
  leakType: string | null;
  leakValue: number | null;
  leakUnit: string | null;
  point: LpcCurvePoint | null;
  receivedAt: string;
}

interface AuthUser {
  id: string;
  login: string;
  role: UserRole;
}


interface ProgramMappingRecord {
  id: string;
  barcodePattern: string;
  programNumber: number;
  programText: string;
  description: string | null;
  isActive: boolean;
  matchType: 'exact' | 'contains';
  labelPrintMode: 'ok_only' | 'ok_and_nok';
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  instructionPdf?: ProgramInstructionMeta;
}

interface ProgramInstructionMeta {
  exists: boolean;
  originalName: string | null;
  uploadedAt: string | null;
  uploadedBy: string | null;
  sizeBytes: number | null;
}

interface PublicUser extends AuthUser {
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  createdBy: string | null;
  cardUidLast4: string | null;
  cardMask: string | null;
  lastTestAt: string | null;
  deletedAt?: string | null;
}

const statusLabels: Record<OperatorStatus, string> = {
  ready: 'Gotowy do skanu',
  scanning: 'Skanuję...',
  'program-selected': 'Program wysłany do LPC',
  'no-mapping': 'Brak mapowania',
  'start-error': 'Błąd startu programu',
};

const frontendEnv = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
const showDiagnostics = (frontendEnv.VITE_SHOW_DIAGNOSTICS ?? 'false') === 'true';
const estimatedLeakRateEnabled = (frontendEnv.LPC_ENABLE_ESTIMATED_LEAK_RATE ?? 'false') === 'true';
const estimatedLeakWindowPoints = normalizeEstimatedLeakWindowPoints(frontendEnv.LPC_ESTIMATED_LEAK_WINDOW_POINTS, 10);
const LOGIN_REGEX = /^[A-Za-z]{3,5}$/;
const CARD_UID_REGEX = /^\d{8}$/;
const CARD_SCAN_IDLE_MS = 200;
function normalizeCardScanInput(value: string): string { return value.trim().replace(/[\r\n]/g, ''); }
function maskCardUid(value: string): string { return `****${value.slice(-4)}`; }

function classifyScan(raw: string): ClassifiedScan {
  const value = raw.trim().replace(/[\r\n]/g, '');
  if (!value || value.length < 3) return { type: 'invalid', value };
  if (CARD_UID_REGEX.test(value)) return { type: 'card', value };
  return { type: 'barcode', value };
}

function getInitialRoute(): string {
  return ['/login', '/admin/users', '/admin/programs'].includes(window.location.pathname) ? window.location.pathname : '/operator';
}

function navigateTo(path: string, setRoute: (route: string) => void): void {
  window.history.pushState({}, '', path);
  setRoute(path);
}

function isManager(user: AuthUser | null): boolean {
  return user?.role === 'admin' || user?.role === 'line_leader';
}

function canManagePrograms(user: AuthUser | null): boolean {
  return user?.role === 'admin' || user?.role === 'line_leader';
}

function canOpenDiagnostics(user: AuthUser | null): boolean {
  return user?.role === 'admin' && showDiagnostics;
}

function loadSocketIoClient(): Promise<SocketLike | null> {
  if (window.io) return Promise.resolve(window.io());

  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = '/socket.io/socket.io.js';
    script.async = true;
    script.onload = () => resolve(window.io ? window.io() : null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) return null;
  return response.json() as Promise<T>;
}

async function fetchLpcStatus(): Promise<LpcStatusPayload | null> {
  return fetchJson<LpcStatusPayload>('/api/lpc/status');
}

async function fetchTestSessionStatus(): Promise<TestSessionState | null> {
  return fetchJson<TestSessionState>('/api/test-session/status');
}

async function fetchSplunkStatus(): Promise<SplunkStatusPayload | null> {
  return fetchJson<SplunkStatusPayload>('/api/splunk/status');
}

async function fetchLpcRuntimeState(): Promise<{
  lastResult: EnrichedLpcResult | null;
  results: EnrichedLpcResult[];
  points: LpcCurvePoint[];
}> {
  const [lastResultPayload, resultsPayload, curvePayload] = await Promise.all([
    fetchJson<{ ok: true; result: EnrichedLpcResult | null }>('/api/lpc/last-result'),
    fetchJson<{ ok: true; results: EnrichedLpcResult[]; total?: number }>('/api/test-results?limit=50'),
    fetchJson<{ ok: true; points: LpcCurvePoint[] }>('/api/lpc/curve'),
  ]);

  return {
    lastResult: lastResultPayload?.result ?? null,
    results: resultsPayload?.results ?? [],
    points: curvePayload?.points ?? [],
  };
}

function getSafeLpcConnectionLabel(status: LpcStatusPayload | null): string {
  if (!status) return getConnectionLabel(null, false);
  const safeConnected = status.connected && !status.lastError && status.socketDestroyed !== true && status.socketWritable !== false;
  return getConnectionLabel(status.status, safeConnected);
}

type CompactLpcStatus = 'online' | 'stale' | 'offline';

function getCompactLpcStatus(status: LpcStatusPayload | null): { label: string; state: CompactLpcStatus } {
  if (!status || !status.connected || status.status === 'disconnected' || status.socketDestroyed === true || status.socketWritable === false) {
    return { label: 'LPC offline', state: 'offline' };
  }
  if (status.staleConnectionDetectedAt || status.lastError) return { label: 'Brak danych', state: 'stale' };
  return { label: 'LPC online', state: 'online' };
}

function getCompactSplunkLabel(status: SplunkStatusPayload | null): string {
  if (!status || !status.enabled) return 'Splunk OFF';
  switch (status.lastSplunkStatus) {
    case 'sent': return 'Splunk OK';
    case 'buffered': return 'Splunk bufor';
    case 'failed':
    case 'not_configured':
      return 'Splunk błąd';
    case 'disabled':
      return 'Splunk OFF';
    default:
      return status.configured ? 'Splunk OK' : 'Splunk błąd';
  }
}


function getSegmentDisplay(segment: string | null | undefined): string {
  const normalized = segment?.trim().toUpperCase();
  if (normalized === 'DPT') return 'Pomiar właściwy';
  if (normalized === 'EXH') return 'Spuszczanie / wydech';
  return segment?.trim() || '-';
}

function isMeasurementSegment(segment: string | null | undefined): boolean {
  const normalized = segment?.trim().toUpperCase();
  return normalized === 'DPT';
}

function buildCurveSignature(points: LpcCurvePoint[]): string {
  const lastPoint = points.at(-1);
  if (!lastPoint) return 'empty';
  return `${points.length}:${lastPoint.elapsedTimeSec}:${lastPoint.pressureMbar ?? 'null'}:${lastPoint.segment}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidCurvePoint(point: LpcCurvePoint | null | undefined): point is LpcCurvePoint {
  return Boolean(
    point
    && isFiniteNumber(point.elapsedTimeSec)
    && typeof point.segment === 'string'
    && point.segment.trim() !== ''
    && (isFiniteNumber(point.pressureMbar) || isFiniteNumber(point.pressureBar)),
  );
}

function LoginPage(props: { onLoggedIn: (user: AuthUser) => void; idleMessage?: string | null }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const loginInputRef = useRef<HTMLInputElement | null>(null);
  const cardInputRef = useRef<HTMLInputElement | null>(null);
  const cardBufferRef = useRef('');

  async function submitCard(uidInput: string) {
    const cardUid = normalizeCardScanInput(uidInput);
    if (!cardUid) return;
    cardBufferRef.current = '';
    if (cardInputRef.current) cardInputRef.current.value = '';
    if (!CARD_UID_REGEX.test(cardUid)) {
      setError('Nieznana karta. Przyłóż przypisaną kartę lub zaloguj hasłem.');
      window.setTimeout(() => cardInputRef.current?.focus(), 0);
      return;
    }
    const response = await fetch('/api/auth/card-login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardUid }),
    });
    const payload = (await response.json()) as { ok: boolean; user?: AuthUser; message?: string; error?: string };
    if (!response.ok || !payload.user) {
      setError(payload.message ?? payload.error ?? 'Nieznana karta. Przyłóż przypisaną kartę lub zaloguj hasłem.');
      window.setTimeout(() => cardInputRef.current?.focus(), 0);
      return;
    }
    setError(null);
    props.onLoggedIn(payload.user);
  }

  function onCardInput(value: string) {
    cardBufferRef.current = value;
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => void submitCard(value), CARD_SCAN_IDLE_MS);
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedLogin = login.trim().toUpperCase();
    if (!LOGIN_REGEX.test(normalizedLogin)) {
      setError('Skrót musi mieć 3–5 liter A-Z, bez cyfr i znaków specjalnych.');
      return;
    }
    if (password.length < 4) {
      setError('Hasło musi mieć minimum 4 znaki.');
      return;
    }

    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: normalizedLogin, password }),
    });
    const payload = (await response.json()) as { ok: boolean; user?: AuthUser; error?: string };
    if (!response.ok || !payload.user) {
      setError(payload.error ?? 'Nieprawidłowy login lub hasło');
      return;
    }
    props.onLoggedIn(payload.user);
  }

  function togglePasswordLogin() {
    setPasswordVisible((visible) => {
      const next = !visible;
      if (next) window.setTimeout(() => loginInputRef.current?.focus(), 120);
      else window.setTimeout(() => cardInputRef.current?.focus(), 120);
      return next;
    });
  }

  useEffect(() => {
    if (!passwordVisible) cardInputRef.current?.focus();
  }, [passwordVisible]);

  return (
    <main className="login-shell">
      <div className="login-card operator-login-card">
        <div className="login-hero">
          <div>
            <span className="eyebrow">LPC-528</span>
            <h1>Przyłóż kartę <span>operatora</span></h1>
            <p>Czytnik ELATEC TWN4 wpisuje UID automatycznie i zatwierdza Enterem.</p>
          </div>
          <div className="rfid-badge" aria-hidden="true">
            <svg viewBox="0 0 48 48" role="img" focusable="false">
              <rect x="8" y="12" width="32" height="24" rx="6" />
              <path d="M16 21h10M16 28h16" />
              <path d="M34 18c3 3 3 9 0 12M39 15c5 5 5 15 0 20" />
            </svg>
          </div>
        </div>
        {props.idleMessage && <p className="login-info-message">{props.idleMessage}</p>}

        <section className="login-reader-panel card-reader-panel" aria-label="Karta operatora" onClick={() => cardInputRef.current?.focus()}>
          <div className="card-reader-copy">
            <span className="card-reader-icon" aria-hidden="true">▣</span>
            <div>
              <strong>Przyłóż kartę operatora</strong>
              <span>Przyłóż kartę do czytnika ELATEC TWN4.</span>
            </div>
          </div>
          <input
            id="cardUidInput"
            ref={cardInputRef}
            className="card-scan-hidden-input"
            autoFocus={!passwordVisible}
            defaultValue=""
            onChange={(event) => onCardInput(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submitCard(cardBufferRef.current); } }}
            inputMode="numeric"
            autoComplete="off"
            aria-label="Ukryty odczyt karty operatora"
          />
          {error && <p className="login-error card-login-error">{error}</p>}
        </section>

        <button type="button" className="password-toggle-button" onClick={togglePasswordLogin} aria-expanded={passwordVisible}>Nie masz karty? Zaloguj hasłem</button>
        {passwordVisible && (
          <form className="password-fallback" onSubmit={submitLogin}>
            <div className="password-panel-header">
              <strong>Logowanie hasłem</strong>
              <span>Wpisz login i hasło, aby zalogować operatora.</span>
            </div>
            <div className="password-field-stack">
              <label htmlFor="passwordLoginInput">Login / skrót osobowy</label>
              <input id="passwordLoginInput" ref={loginInputRef} className="auth-input" value={login} onChange={(event) => setLogin(event.target.value.toUpperCase())} placeholder="Login" />
            </div>
            <div className="password-field-stack">
              <label htmlFor="passwordInput">Hasło</label>
              <input id="passwordInput" className="auth-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Hasło" />
            </div>
            <button type="submit" className="password-submit-button">Zaloguj hasłem</button>
          </form>
        )}
      </div>
    </main>
  );
}

function userRoleLabel(role: UserRole): string {
  if (role === 'admin') return 'Admin';
  if (role === 'line_leader') return 'Line Leader';
  return 'Operator';
}

function canDeleteUserInUi(actor: AuthUser, target: PublicUser, activeAdminCount: number): boolean {
  if (actor.id === target.id) return false;
  if (actor.role === 'admin') return !(target.role === 'admin' && target.isActive && activeAdminCount <= 1);
  if (actor.role === 'line_leader') return target.role === 'operator';
  return false;
}

function UsersPage(props: { user: AuthUser; onBack: () => void }) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('operator');
  const [cardUid, setCardUid] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function loadUsers() {
    const payload = await fetchJson<{ ok: true; users: PublicUser[] }>('/api/users');
    if (payload?.users) setUsers(payload.users);
  }

  useEffect(() => {
    if (props.user.role === 'line_leader') setRole('operator');
    void loadUsers();
  }, [props.user.role]);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedLogin = login.trim().toUpperCase();
    if (!LOGIN_REGEX.test(normalizedLogin)) {
      setMessage('Skrót musi mieć 3–5 liter A-Z, bez cyfr i znaków specjalnych.');
      return;
    }
    if (password.length < 4) {
      setMessage('Hasło musi mieć minimum 4 znaki.');
      return;
    }

    const response = await fetch('/api/users', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: normalizedLogin, password, role, cardUid: cardUid.trim() || undefined }),
    });
    const payload = (await response.json()) as { ok: boolean; message?: string };
    setMessage(response.ok ? 'Użytkownik został dodany.' : payload.message ?? 'Nie udało się dodać użytkownika.');
    if (response.ok) {
      setLogin('');
      setPassword('');
      setRole('operator');
      setCardUid('');
      await loadUsers();
    }
  }

  async function deleteUser(id: string) {
    if (!window.confirm('Usunąć użytkownika?')) return;
    const response = await fetch(`/api/users/${id}`, { method: 'DELETE', credentials: 'include' });
    const payload = (await response.json()) as { ok: boolean; deletedUserId?: string; message?: string };
    setMessage(response.ok ? 'Użytkownik został usunięty.' : payload.message ?? 'Brak uprawnień do tej operacji.');
    if (response.ok) setUsers((current) => current.filter((user) => user.id !== (payload.deletedUserId ?? id)));
    else await loadUsers();
  }

  async function userAction(id: string, action: 'enable' | 'disable') {
    await fetch(`/api/users/${id}/${action}`, { method: 'PATCH', credentials: 'include' });
    await loadUsers();
  }

  async function changeCard(id: string) {
    const uid = window.prompt('Przyłóż kartę albo wpisz UID (np. 05389148)');
    if (!uid) return;
    const response = await fetch(`/api/users/${id}/card`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardUid: uid }) });
    const payload = (await response.json()) as { ok: boolean; message?: string };
    setMessage(response.ok ? `Karta odczytana: ${maskCardUid(normalizeCardScanInput(uid))}` : payload.message ?? 'Nie udało się przypisać karty.');
    await loadUsers();
  }

  async function removeCard(id: string) {
    if (!window.confirm('Usunąć kartę użytkownika?')) return;
    await fetch(`/api/users/${id}/card`, { method: 'DELETE', credentials: 'include' });
    await loadUsers();
  }

  async function resetPassword(id: string) {
    const newPassword = window.prompt('Nowe hasło (min. 4 znaki)');
    if (!newPassword) return;
    await fetch(`/api/users/${id}/reset-password`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword }),
    });
    await loadUsers();
  }

  return (
    <main className="users-shell">
      <header className="users-header">
        <div>
          <span className="eyebrow">Administracja</span>
          <h1>Użytkownicy</h1>
        </div>
        <button type="button" onClick={props.onBack}>Wróć do panelu</button>
      </header>
      <form className="user-form" onSubmit={createUser}>
        <input value={login} onChange={(event) => setLogin(event.target.value.toUpperCase())} placeholder="Login" />
        <input className="auth-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Hasło tymczasowe" />
        <select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
          <option value="operator">Operator</option>
          <option value="line_leader">Line Leader</option>
          {props.user.role === 'admin' && <option value="admin">Admin</option>}
        </select>
        <input value={cardUid} onChange={(event) => setCardUid(normalizeCardScanInput(event.target.value))} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} placeholder="Przyłóż kartę (opcjonalnie)" inputMode="numeric" />
        {cardUid && <span className="settings-save-status ok-text">Karta odczytana: {maskCardUid(cardUid)}</span>}
        <button type="submit">Dodaj użytkownika</button>
      </form>
      {message && <p className="login-error">{message}</p>}
      <section className="users-table-wrap">
        <table>
          <thead><tr><th>Login</th><th>Rola</th><th>Status</th><th>Karta</th><th>Utworzono</th><th>Ostatnie logowanie</th><th>Akcje</th></tr></thead>
          <tbody>
            {users.map((item) => {
              const activeAdminCount = users.filter((user) => user.role === 'admin' && user.isActive).length;
              const deleteAllowed = canDeleteUserInUi(props.user, item, activeAdminCount);
              return (
              <tr key={item.id}>
                <td>{item.login}</td>
                <td>{userRoleLabel(item.role)}</td>
                <td>{item.isActive ? 'aktywny' : 'nieaktywny'}</td>
                <td>{item.cardMask ?? '-'}</td>
                <td>{formatDateTime(item.createdAt)}</td>
                <td>{formatDateTime(item.lastLoginAt)}</td>
                <td>
                  <button type="button" onClick={() => void resetPassword(item.id)}>Resetuj hasło</button>
                  <button type="button" onClick={() => void changeCard(item.id)}>Zmień kartę</button>
                  {item.cardMask && <button type="button" onClick={() => void removeCard(item.id)}>Usuń kartę</button>}
                  <button type="button" onClick={() => void userAction(item.id, item.isActive ? 'disable' : 'enable')}>{item.isActive ? 'Dezaktywuj' : 'Aktywuj'}</button>
                  {deleteAllowed ? (
                    <button type="button" onClick={() => void deleteUser(item.id)}>Usuń</button>
                  ) : (
                    <button type="button" disabled title={props.user.id === item.id ? 'Nie możesz usunąć własnego konta.' : 'Brak uprawnień'}>Usuń</button>
                  )}
                </td>
              </tr>
            );})}
          </tbody>
        </table>
      </section>
    </main>
  );
}


function ProgramsPage(props: { user: AuthUser; onBack: () => void }) {
  const [mappings, setMappings] = useState<ProgramMappingRecord[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [barcodePattern, setBarcodePattern] = useState('');
  const [matchType, setMatchType] = useState<'exact' | 'contains'>('exact');
  const [programNumber, setProgramNumber] = useState(1);
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [labelPrintMode, setLabelPrintMode] = useState<'ok_only' | 'ok_and_nok'>('ok_only');
  const [autoPrintEnabled, setAutoPrintEnabled] = useState(true);
  const [zebraSaveStatus, setZebraSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [splunkStatus, setSplunkStatus] = useState<SplunkStatusPayload | null>(null);
  const [splunkRetrying, setSplunkRetrying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadMappings() {
    const payload = await fetchJson<{ ok: true; mappings: ProgramMappingRecord[] }>('/api/program-mappings');
    if (payload?.mappings) {
      setMappings(payload.mappings.map((mapping) => ({
        ...mapping,
        instructionPdf: mapping.instructionPdf ?? {
          exists: Boolean((mapping as unknown as { instructionPdfStoredName?: string | null }).instructionPdfStoredName),
          originalName: (mapping as unknown as { instructionPdfOriginalName?: string | null }).instructionPdfOriginalName ?? null,
          uploadedAt: (mapping as unknown as { instructionPdfUploadedAt?: string | null }).instructionPdfUploadedAt ?? null,
          uploadedBy: (mapping as unknown as { instructionPdfUploadedBy?: string | null }).instructionPdfUploadedBy ?? null,
          sizeBytes: (mapping as unknown as { instructionPdfSizeBytes?: number | null }).instructionPdfSizeBytes ?? null,
        },
      })));
    }
  }

  async function loadZebraSettings() {
    const payload = await fetchJson<{ ok: true; autoPrintEnabled: boolean }>('/api/zebra/settings');
    if (payload) setAutoPrintEnabled(payload.autoPrintEnabled);
  }

  async function loadSplunkStatus() {
    const payload = await fetchJson<SplunkStatusPayload>('/api/splunk/status');
    if (payload) setSplunkStatus(payload);
  }

  useEffect(() => {
    void loadMappings();
    void loadZebraSettings();
    void loadSplunkStatus();
  }, []);

  function resetForm() {
    setEditingId(null);
    setBarcodePattern('');
    setMatchType('exact');
    setProgramNumber(1);
    setDescription('');
    setIsActive(true);
    setLabelPrintMode('ok_only');
  }

  function editMapping(mapping: ProgramMappingRecord) {
    setEditingId(mapping.id);
    setBarcodePattern(mapping.barcodePattern);
    setMatchType(mapping.matchType);
    setProgramNumber(mapping.programNumber);
    setDescription(mapping.description ?? '');
    setIsActive(mapping.isActive);
    setLabelPrintMode(mapping.labelPrintMode ?? 'ok_only');
  }

  async function saveMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedPattern = barcodePattern.trim();
    if (!trimmedPattern) {
      setMessage('Barcode jest wymagany');
      return;
    }
    if (trimmedPattern.length < 3 || trimmedPattern.length > 100) {
      setMessage('Barcode musi mieć od 3 do 100 znaków');
      return;
    }
    if (!Number.isInteger(programNumber) || programNumber < 1 || programNumber > 31) {
      setMessage('Program musi być w zakresie 1–31');
      return;
    }

    const response = await fetch(editingId ? `/api/program-mappings/${editingId}` : '/api/program-mappings', {
      method: editingId ? 'PATCH' : 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barcodePattern: trimmedPattern, matchType, programNumber, description, isActive, labelPrintMode }),
    });
    const payload = (await response.json()) as { ok: boolean; message?: string };
    setMessage(response.ok ? 'Mapowanie zapisane' : payload.message ?? 'Nie udało się zapisać mapowania');
    if (response.ok) {
      resetForm();
      await loadMappings();
    }
  }

  async function saveZebraSetting(nextValue: boolean) {
    const previousValue = autoPrintEnabled;
    setAutoPrintEnabled(nextValue);
    setZebraSaveStatus('saving');
    const response = await fetch('/api/zebra/settings', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoPrintEnabled: nextValue }) });
    if (response.ok) {
      setZebraSaveStatus('saved');
    } else {
      setAutoPrintEnabled(previousValue);
      setZebraSaveStatus('error');
    }
  }

  async function retrySplunkBuffer() {
    setSplunkRetrying(true);
    try {
      await fetch('/api/splunk/retry-buffer', { method: 'POST', credentials: 'include' });
      await loadSplunkStatus();
    } finally {
      setSplunkRetrying(false);
    }
  }

  async function uploadInstruction(mapping: ProgramMappingRecord, file: File | null) {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`/api/programs/${encodeURIComponent(mapping.id)}/instruction`, { method: 'POST', credentials: 'include', body: formData });
    const payload = (await response.json()) as { ok: boolean; message?: string };
    setMessage(response.ok ? 'Instrukcja PDF zapisana' : payload.message ?? 'Nie udało się zapisać PDF');
    await loadMappings();
  }

  async function removeInstruction(mapping: ProgramMappingRecord) {
    if (!window.confirm('Czy usunąć instrukcję PDF z programu?')) return;
    await fetch(`/api/programs/${encodeURIComponent(mapping.id)}/instruction`, { method: 'DELETE', credentials: 'include' });
    setMessage('Instrukcja PDF usunięta');
    await loadMappings();
  }

  async function toggleMapping(mapping: ProgramMappingRecord) {
    if (mapping.isActive && !window.confirm('Czy dezaktywować to mapowanie?')) return;
    await fetch(`/api/program-mappings/${mapping.id}/${mapping.isActive ? 'disable' : 'enable'}`, { method: 'PATCH', credentials: 'include' });
    await loadMappings();
  }

  return (
    <main className="users-shell programs-shell">
      <header className="users-header">
        <div>
          <span className="eyebrow">Programy</span>
          <h1>Programy / Mapowanie barcode</h1>
          <p>Zarządzanie przypisaniem barcode do programu LPC.</p>
        </div>
        <button type="button" onClick={props.onBack}>Wróć do panelu</button>
      </header>
      <form className="user-form mapping-form" onSubmit={saveMapping}>
        <input value={barcodePattern} onChange={(event) => setBarcodePattern(event.target.value)} placeholder="Barcode / pattern" />
        <select value={matchType} onChange={(event) => setMatchType(event.target.value as 'exact' | 'contains')}>
          <option value="exact">Dokładne</option>
          <option value="contains">Zawiera</option>
        </select>
        <select value={programNumber} onChange={(event) => setProgramNumber(Number(event.target.value))}>
          {Array.from({ length: 31 }, (_, index) => index + 1).map((program) => <option key={program} value={program}>P{String(program).padStart(2, '0')}</option>)}
        </select>
        <select value={labelPrintMode} onChange={(event) => setLabelPrintMode(event.target.value as 'ok_only' | 'ok_and_nok')}>
          <option value="ok_only">Tylko OK</option>
          <option value="ok_and_nok">OK i NOK</option>
        </select>
        <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Opis" />
        <label className="inline-check"><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} /> Aktywny</label>
        <button type="submit">{editingId ? 'Zapisz zmiany' : 'Dodaj mapowanie'}</button>
        {editingId && <button type="button" onClick={resetForm}>Anuluj</button>}
      </form>
      {message && <p className="login-error">{message}</p>}
      <section className="settings-card">
        <div className="settings-row zebra-print-toggle">
          <div>
            <div className="settings-row-title">Drukowanie etykiet</div>
            <div className="settings-row-subtitle">Automatyczny wydruk po wyniku testu</div>
          </div>
          <div className="toggle-switch-wrap">
            <button
              type="button"
              className={`toggle-switch ${autoPrintEnabled ? 'is-on' : 'is-off'}`}
              role="switch"
              aria-checked={autoPrintEnabled}
              disabled={zebraSaveStatus === 'saving'}
              onClick={() => void saveZebraSetting(!autoPrintEnabled)}
            >
              <span className="toggle-switch-thumb" />
            </button>
            <small>{autoPrintEnabled ? 'Włączone' : 'Wyłączone'}</small>
          </div>
        </div>
        {zebraSaveStatus === 'saving' && <p className="settings-save-status">Zapisywanie...</p>}
        {zebraSaveStatus === 'saved' && <p className="settings-save-status ok-text">Zapisano</p>}
        {zebraSaveStatus === 'error' && <p className="settings-save-status error-text">Nie udało się zmienić ustawienia</p>}
      </section>
      <section className="settings-card">
        <div className="settings-row">
          <div>
            <div className="settings-row-title">Splunk</div>
            <div className="settings-row-subtitle">Status: {splunkStatus?.enabled ? 'Włączony' : 'Wyłączony'} · Konfiguracja: {splunkStatus?.configured ? 'OK' : splunkStatus?.urlConfigured ? 'Brak tokena' : 'Brak URL'} · Bufor: {splunkStatus?.pending ?? 0} oczekujących · Retry co {Math.round((splunkStatus?.retryIntervalMs ?? 0) / 1000)} s</div>
            <small>Index: {splunkStatus?.index ?? '-'} · Source: {splunkStatus?.source ?? '-'} · Sourcetype: {splunkStatus?.sourcetype ?? '-'} · TLS verify: {String(splunkStatus?.verifyTls ?? '-')}</small>
            <small>Worker: {splunkStatus?.bufferWorkerEnabled ? 'aktywny' : 'wyłączony'} · Sending: {splunkStatus?.sending ?? 0} · Sent: {splunkStatus?.sent ?? 0} · Failed: {splunkStatus?.failed ?? 0} · Last retry: {splunkStatus?.lastRetryAt ? formatDateTime(splunkStatus.lastRetryAt) : '-'}</small>
            <small>Zakład: {splunkStatus?.site ?? '-'} · Linia: {splunkStatus?.line ?? '-'} · Stanowisko: {splunkStatus?.workplace ?? '-'}</small>
            {splunkStatus?.lastError && <p className="settings-save-status error-text">Ostatni błąd: {splunkStatus.lastError}</p>}
          </div>
          <button type="button" disabled={splunkRetrying} onClick={() => void retrySplunkBuffer()}>{splunkRetrying ? 'Wysyłanie...' : 'Wyślij bufor ponownie'}</button>
        </div>
      </section>
      <section className="users-table-wrap">
        <table>
          <thead><tr><th>Barcode / pattern</th><th>Typ</th><th>Program</th><th>Druk</th><th>Opis</th><th>Instrukcja PDF</th><th>Status</th><th>UpdatedAt</th><th>Akcje</th></tr></thead>
          <tbody>
            {mappings.map((mapping) => (
              <tr key={mapping.id}>
                <td title={mapping.barcodePattern}>{mapping.barcodePattern}</td>
                <td>{mapping.matchType === 'exact' ? 'Dokładne' : 'Zawiera'}</td>
                <td>{mapping.programText}</td>
                <td>{mapping.labelPrintMode === 'ok_and_nok' ? 'OK i NOK' : 'Tylko OK'}</td>
                <td title={mapping.description ?? ''}>{mapping.description ?? '-'}</td>
                <td>
                  <div className="program-instruction-cell">
                    <span>{mapping.instructionPdf?.exists ? mapping.instructionPdf.originalName : 'Brak PDF'}</span>
                    {mapping.instructionPdf?.uploadedAt && <small>{formatDateTime(mapping.instructionPdf.uploadedAt)} · {mapping.instructionPdf.uploadedBy ?? '-'}</small>}
                    <label className="table-file-action">
                      {mapping.instructionPdf?.exists ? 'Zmień PDF' : 'Dodaj PDF'}
                      <input type="file" accept="application/pdf,.pdf" onChange={(event) => void uploadInstruction(mapping, event.target.files?.[0] ?? null)} />
                    </label>
                    {mapping.instructionPdf?.exists && <button type="button" onClick={() => void removeInstruction(mapping)}>Usuń PDF</button>}
                  </div>
                </td>
                <td>{mapping.isActive ? 'aktywny' : 'nieaktywny'}</td>
                <td>{formatDateTime(mapping.updatedAt)}</td>
                <td>
                  <button type="button" onClick={() => editMapping(mapping)}>Edytuj</button>
                  <button type="button" onClick={() => void toggleMapping(mapping)}>{mapping.isActive ? 'Dezaktywuj' : 'Aktywuj'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function App() {
  const [route, setRoute] = useState(getInitialRoute);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [theme, setTheme] = useState<ThemeMode>(() => readStoredTheme());
  const [barcode, setBarcode] = useState('');
  const [status, setStatus] = useState<OperatorStatus>('ready');
  const [lastAccepted, setLastAccepted] = useState<ScanAcceptedPayload | null>(null);
  const [lastRejected, setLastRejected] = useState<ScanRejectedPayload | null>(null);
  const [testSession, setTestSession] = useState<TestSessionState | null>(null);
  const [lpcStatus, setLpcStatus] = useState<LpcStatusPayload | null>(null);
  const [lastStream, setLastStream] = useState<LpcStreamPayload | null>(null);
  const [lastResult, setLastResult] = useState<EnrichedLpcResult | null>(null);
  const [resultHistory, setResultHistory] = useState<EnrichedLpcResult[]>([]);
  const [curvePoints, setCurvePoints] = useState<LpcCurvePoint[]>([]);
  const [completedCurvePoints, setCompletedCurvePoints] = useState<LpcCurvePoint[]>([]);
  const [chartFinalResult, setChartFinalResult] = useState<EnrichedLpcResult | null>(null);
  const [finalMarkerResult, setFinalMarkerResult] = useState<FinalMarkerResult | null>(null);
  const [chartStatus, setChartStatus] = useState<ChartStatus>('waiting');
  const [ignoreCompletedCurveUntilNewStream, setIgnoreCompletedCurveUntilNewStream] = useState(false);
  const [carrierLogoAvailable, setCarrierLogoAvailable] = useState(true);
  const [lpcActionMessage, setLpcActionMessage] = useState<string | null>(null);
  const [portCheck, setPortCheck] = useState<LpcPortCheckPayload | null>(null);
  const [mockLine, setMockLine] = useState('');
  const [mockLineResponse, setMockLineResponse] = useState<string | null>(null);
  const [heartbeatResponse, setHeartbeatResponse] = useState<string | null>(null);
  const [forceRefreshResponse, setForceRefreshResponse] = useState<string | null>(null);
  const [diagnosticProgram, setDiagnosticProgram] = useState('1');
  const [programStartTestResponse, setProgramStartTestResponse] = useState<string | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [instructionOpen, setInstructionOpen] = useState(false);
  const [currentInstruction, setCurrentInstruction] = useState<ProgramInstructionMeta | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [splunkStatus, setSplunkStatus] = useState<SplunkStatusPayload | null>(null);
  const [idleLogoutMessage, setIdleLogoutMessage] = useState<string | null>(null);
  const [idleTimeoutMs, setIdleTimeoutMs] = useState(15 * 60 * 1000);
  const [eventCounters, setEventCounters] = useState({
    streamEvents: 0,
    resultEvents: 0,
    resultsUpdatedEvents: 0,
    curveUpdatedEvents: 0,
    curveCompletedEvents: 0,
  });
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const scanBufferRef = useRef('');
  const routeRef = useRef(route);
  const diagnosticsOpenRef = useRef(diagnosticsOpen);
  const resultsOpenRef = useRef(resultsOpen);
  const instructionOpenRef = useRef(instructionOpen);
  const userMenuOpenRef = useRef(userMenuOpen);
  const ignoreCompletedCurveUntilNewStreamRef = useRef(ignoreCompletedCurveUntilNewStream);
  const hasLiveCurveRef = useRef(false);
  const ignoredCurveSignatureRef = useRef<string | null>(null);
  const chartStatusRef = useRef<ChartStatus>(chartStatus);
  const curvePointsRef = useRef<LpcCurvePoint[]>([]);
  const completedCurvePointsRef = useRef<LpcCurvePoint[]>([]);
  const idleTimerRef = useRef<number | null>(null);
  const lastActivitySyncRef = useRef(0);

  function getLastKnownCurvePoint() {
    const points = curvePointsRef.current.length > 0 ? curvePointsRef.current : completedCurvePointsRef.current;
    return points.at(-1) ?? null;
  }

  function buildFinalMarker(result: EnrichedLpcResult, point: LpcCurvePoint | null): FinalMarkerResult {
    return {
      result,
      displayLabel: formatResultLabel(result.result),
      leakType: result.leakType,
      leakValue: result.leakValue,
      leakUnit: result.leakUnit,
      point,
      receivedAt: result.receivedAt,
    };
  }

  function focusBarcodeInput(delayMs = 0) {
    window.setTimeout(() => {
      const input = barcodeInputRef.current;
      if (!input || routeRef.current !== '/operator' || diagnosticsOpenRef.current || resultsOpenRef.current || instructionOpenRef.current || userMenuOpenRef.current) return;

      const activeElement = document.activeElement as HTMLElement | null;
      const activeTag = activeElement?.tagName.toLowerCase();
      const isEditingAnotherField = Boolean(
        activeElement
        && activeElement !== input
        && (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select' || activeElement.isContentEditable),
      );
      if (isEditingAnotherField) return;

      input.focus({ preventScroll: true });
    }, delayMs);
  }

  async function idleLogout() {
    if (testSession?.locked) {
      scheduleIdleTimer(60_000);
      return;
    }
    console.info(`[AUTH_IDLE] logout reason=idle_timeout minutes=${Math.round(idleTimeoutMs / 60000)}`);
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined);
    setAuthUser(null);
    setBarcode('');
    setLastRejected(null);
    setUserMenuOpen(false);
    setDiagnosticsOpen(false);
    setResultsOpen(false);
    setInstructionOpen(false);
    setIdleLogoutMessage('Wylogowano z powodu bezczynności.');
    navigateTo('/login', setRoute);
  }

  function scheduleIdleTimer(delayMs = idleTimeoutMs) {
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    if (!authUser || route === '/login') return;
    idleTimerRef.current = window.setTimeout(() => void idleLogout(), Math.max(delayMs, 1000));
  }

  function recordOperatorActivity(syncBackend = true) {
    if (!authUser || route === '/login') return;
    scheduleIdleTimer();
    if (!syncBackend || testSession?.locked) return;
    const now = Date.now();
    if (now - lastActivitySyncRef.current < 30_000) return;
    lastActivitySyncRef.current = now;
    void fetch('/api/auth/activity', { method: 'POST', credentials: 'include' }).then((response) => {
      if (response.status === 401) void idleLogout();
    }).catch(() => undefined);
  }


  function resetChartForNewTest() {
    const displayedBeforeReset = curvePoints.length > 0 ? curvePoints : completedCurvePoints;
    ignoredCurveSignatureRef.current = buildCurveSignature(displayedBeforeReset);
    hasLiveCurveRef.current = false;
    setCurvePoints([]);
    setCompletedCurvePoints([]);
    setChartFinalResult(null);
    setFinalMarkerResult(null);
    setLastStream(null);
    chartStatusRef.current = 'waiting';
    setChartStatus('waiting');
    ignoreCompletedCurveUntilNewStreamRef.current = true;
    setIgnoreCompletedCurveUntilNewStream(true);
  }

  async function refreshMe() {
    const payload = await fetchJson<{ ok: true; user: AuthUser | null; idleLogoutMinutes?: number }>('/api/auth/me');
    if (typeof payload?.idleLogoutMinutes === 'number') setIdleTimeoutMs(Math.max(payload.idleLogoutMinutes, 0) * 60 * 1000);
    setAuthUser(payload?.user ?? null);
    setAuthLoading(false);
    return payload?.user ?? null;
  }

  useEffect(() => {
    const onPopState = () => setRoute(getInitialRoute());
    window.addEventListener('popstate', onPopState);
    void refreshMe().then((user) => {
      if (!user && route !== '/login') navigateTo('/login', setRoute);
      if (user && route === '/login') navigateTo('/operator', setRoute);
    });
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  async function refreshLpcStatus() {
    const nextStatus = await fetchLpcStatus();
    if (nextStatus) setLpcStatus(nextStatus);
  }

  async function refreshSplunkStatus() {
    const nextStatus = await fetchSplunkStatus();
    if (nextStatus) setSplunkStatus(nextStatus);
  }

  async function loadInstructionForMapping(mappingId?: string | null) {
    if (!mappingId) {
      setCurrentInstruction(null);
      return;
    }
    const payload = await fetchJson<ProgramInstructionMeta & { ok: true }>(`/api/programs/${encodeURIComponent(mappingId)}/instruction`);
    setCurrentInstruction(payload ? {
      exists: payload.exists,
      originalName: payload.originalName,
      uploadedAt: payload.uploadedAt,
      uploadedBy: payload.uploadedBy,
      sizeBytes: payload.sizeBytes,
    } : null);
  }

  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  useEffect(() => {
    diagnosticsOpenRef.current = diagnosticsOpen;
  }, [diagnosticsOpen]);

  useEffect(() => {
    resultsOpenRef.current = resultsOpen;
  }, [resultsOpen]);

  useEffect(() => {
    instructionOpenRef.current = instructionOpen;
  }, [instructionOpen]);

  useEffect(() => {
    persistTheme(theme);
    document.body.classList.remove('theme-light', 'theme-dark');
    document.body.classList.add(`theme-${theme}`);
  }, [theme]);

  useEffect(() => {
    userMenuOpenRef.current = userMenuOpen;
  }, [userMenuOpen]);

  useEffect(() => {
    ignoreCompletedCurveUntilNewStreamRef.current = ignoreCompletedCurveUntilNewStream;
  }, [ignoreCompletedCurveUntilNewStream]);

  useEffect(() => {
    chartStatusRef.current = chartStatus;
  }, [chartStatus]);

  useEffect(() => {
    curvePointsRef.current = curvePoints;
  }, [curvePoints]);

  useEffect(() => {
    completedCurvePointsRef.current = completedCurvePoints;
  }, [completedCurvePoints]);

  useEffect(() => {
    if (authUser && route === '/operator') focusBarcodeInput(120);
  }, [authUser, route]);

  useEffect(() => {
    if (!authUser || route === '/login') {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      return;
    }
    scheduleIdleTimer();
    const onActivity = () => recordOperatorActivity(true);
    window.addEventListener('click', onActivity);
    window.addEventListener('keydown', onActivity);
    return () => {
      window.removeEventListener('click', onActivity);
      window.removeEventListener('keydown', onActivity);
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
  }, [authUser, route, idleTimeoutMs, testSession?.locked]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && resultsOpen) {
        setResultsOpen(false);
        focusBarcodeInput(120);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [resultsOpen]);

  useEffect(() => {
    void refreshLpcStatus();
    void refreshSplunkStatus();
    void fetchTestSessionStatus().then((payload) => {
      if (payload) setTestSession(payload);
    });
    const refreshRuntimeState = () => {
      void fetchLpcRuntimeState().then((payload) => {
        if (payload.lastResult) setLastResult(payload.lastResult);
        if (payload.results.length > 0) setResultHistory(replaceHistoryFromResultsUpdated(payload.results, 50));
        if (payload.points.length > 0) {
          const nextPoints = payload.points.slice(-150);
          const nextSignature = buildCurveSignature(nextPoints);
          const shouldIgnoreOldCompletedCurve = ignoreCompletedCurveUntilNewStreamRef.current && nextSignature === ignoredCurveSignatureRef.current;
          if (!shouldIgnoreOldCompletedCurve) {
            hasLiveCurveRef.current = true;
            chartStatusRef.current = 'live';
            ignoreCompletedCurveUntilNewStreamRef.current = false;
            setIgnoreCompletedCurveUntilNewStream(false);
            setChartStatus('live');
            setCurvePoints(nextPoints);
          }
        }
      });
    };
    refreshRuntimeState();
    const runtimePoll = window.setInterval(refreshRuntimeState, 1000);
    const splunkPoll = window.setInterval(() => void refreshSplunkStatus(), 5000);
    return () => {
      window.clearInterval(runtimePoll);
      window.clearInterval(splunkPoll);
    };
  }, []);

  useEffect(() => {
    let activeSocket: SocketLike | null = null;
    let isMounted = true;

    void loadSocketIoClient().then((socket) => {
      if (!isMounted || !socket) return;
      activeSocket = socket;

      socket.on('scan:accepted', (payload: ScanAcceptedPayload) => {
        setLastAccepted(payload);
        setLastRejected(null);
        setStatus(payload.programStart.success ? 'program-selected' : 'start-error');
        if (payload.activeTest) setTestSession(payload.activeTest);
        void loadInstructionForMapping(payload.currentTest.mappingId);
        if (payload.programStart.success && !hasLiveCurveRef.current) resetChartForNewTest();
      });

      socket.on('scan:rejected', (payload: ScanRejectedPayload) => {
        setLastRejected(payload);
        setStatus('no-mapping');
      });

      socket.on('lpc:status', setLpcStatus);
      socket.on('lpc:connected', setLpcStatus);
      socket.on('lpc:disconnected', setLpcStatus);
      socket.on('lpc:reconnecting', setLpcStatus);

      socket.on('lpc:error', (payload) => {
        setLpcActionMessage(payload.message);
        if (payload.state) setLpcStatus(payload.state);
        void refreshLpcStatus();
      });

      socket.on('lpc:stream', (payload) => {
        setEventCounters((counters) => ({ ...counters, streamEvents: counters.streamEvents + 1 }));
        setLastStream(payload);
        chartStatusRef.current = 'live';
        setChartStatus('live');
        hasLiveCurveRef.current = true;
        ignoredCurveSignatureRef.current = null;
        ignoreCompletedCurveUntilNewStreamRef.current = false;
        setIgnoreCompletedCurveUntilNewStream(false);
        setCompletedCurvePoints([]);
        const nextPoint: LpcCurvePoint = {
          elapsedTimeSec: payload.elapsedTimeSec ?? 0,
          remainingTimeSec: payload.remainingTimeSec,
          pressureBar: payload.pressureValue,
          pressureMbar: payload.pressureMbar,
          segment: payload.segment,
          liveLeakValue: payload.liveLeakValue ?? null,
          liveLeakUnit: payload.liveLeakUnit ?? null,
          RL: payload.RL ?? payload.liveLeakValue ?? null,
          RL_unit: payload.RL_unit ?? payload.liveLeakUnit ?? null,
        };
        if (isValidCurvePoint(nextPoint)) setCurvePoints((points) => [...points, nextPoint]);
      });

      socket.on('lpc:curve-updated', (payload) => {
        setEventCounters((counters) => ({ ...counters, curveUpdatedEvents: counters.curveUpdatedEvents + 1 }));
        if (payload.points.length > 0) {
          hasLiveCurveRef.current = true;
          ignoredCurveSignatureRef.current = null;
          chartStatusRef.current = 'live';
          setChartStatus('live');
          ignoreCompletedCurveUntilNewStreamRef.current = false;
          setIgnoreCompletedCurveUntilNewStream(false);
          setCompletedCurvePoints([]);
          setCurvePoints(payload.points.filter(isValidCurvePoint));
        }
      });

      socket.on('lpc:result', (payload) => {
        setEventCounters((counters) => ({ ...counters, resultEvents: counters.resultEvents + 1 }));
        setLastResult(payload);
        // Final result marker is intentionally kept until the next accepted scan.
        setChartFinalResult(payload);
        setFinalMarkerResult(buildFinalMarker(payload, getLastKnownCurvePoint()));
        setResultHistory((results) => mergeResultIntoHistory(results, payload, 50));
        void refreshSplunkStatus();
        focusBarcodeInput(180);
      });

      socket.on('lpc:results-updated', (payload) => {
        setEventCounters((counters) => ({ ...counters, resultsUpdatedEvents: counters.resultsUpdatedEvents + 1 }));
        setResultHistory(replaceHistoryFromResultsUpdated(payload.results, 50));
      });

      socket.on('lpc:curve-completed', (payload) => {
        const completedPoints = payload.points.slice(-150);
        setEventCounters((counters) => ({ ...counters, curveCompletedEvents: counters.curveCompletedEvents + 1 }));
        hasLiveCurveRef.current = completedPoints.length > 0;
        ignoredCurveSignatureRef.current = null;
        chartStatusRef.current = 'completed';
        setChartStatus('completed');
        setCompletedCurvePoints(completedPoints);
        setCurvePoints(completedPoints);
        setFinalMarkerResult((marker) => marker ? { ...marker, point: completedPoints.at(-1) ?? marker.point } : marker);
        ignoreCompletedCurveUntilNewStreamRef.current = false;
        setIgnoreCompletedCurveUntilNewStream(false);
      });

      socket.on('test:completed', (payload) => {
        setLastResult(payload);
        // Final result marker is intentionally kept until the next accepted scan.
        setChartFinalResult(payload);
        setFinalMarkerResult(buildFinalMarker(payload, getLastKnownCurvePoint()));
        setResultHistory((results) => mergeResultIntoHistory(results, payload, 50));
        void refreshSplunkStatus();
        focusBarcodeInput(220);
      });

      socket.on('test-session:updated', (payload) => {
        setTestSession(payload);
        if (!payload.locked) focusBarcodeInput(180);
      });
    });

    return () => {
      isMounted = false;
      activeSocket?.off('scan:accepted');
      activeSocket?.off('scan:rejected');
      activeSocket?.off('lpc:status');
      activeSocket?.off('lpc:connected');
      activeSocket?.off('lpc:disconnected');
      activeSocket?.off('lpc:reconnecting');
      activeSocket?.off('lpc:error');
      activeSocket?.off('lpc:stream');
      activeSocket?.off('lpc:result');
      activeSocket?.off('lpc:results-updated');
      activeSocket?.off('lpc:curve-updated');
      activeSocket?.off('lpc:curve-completed');
      activeSocket?.off('test:completed');
      activeSocket?.off('test-session:updated');
      activeSocket?.disconnect();
    };
  }, []);

  async function handleCardAction(cardUid: string): Promise<boolean> {
    setBarcode('');
    scanBufferRef.current = '';
    const response = await fetch('/api/auth/card-action', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardUid }) });
    const payload = (await response.json()) as { ok: boolean; action?: 'LOGIN' | 'LOGGED_OUT' | 'SWITCHED_USER' | 'UNKNOWN_CARD' | 'TEST_IN_PROGRESS'; message?: string; user?: AuthUser | null };
    if (payload.action === 'UNKNOWN_CARD') {
      setLastRejected({ barcode: '', error: 'NO_MAPPING', message: 'Nieznana karta operatora.' });
      focusBarcodeInput(0);
      return true;
    }
    if (payload.action === 'LOGGED_OUT') {
      setAuthUser(null);
      setBarcode('');
      navigateTo('/login', setRoute);
      return true;
    }
    if (payload.user) {
      setAuthUser(payload.user);
      setBarcode('');
      setLastRejected({ barcode: '', error: 'NO_MAPPING', message: `Zalogowano operatora: ${payload.user.login}` });
      focusBarcodeInput(100);
      return true;
    }
    if (payload.message) {
      setLastRejected({ barcode: '', error: 'TEST_IN_PROGRESS', errorCode: 'TEST_IN_PROGRESS', message: testSession?.locked ? 'Test w toku. Zmiana operatora możliwa po zakończeniu testu.' : payload.message, activeTest: testSession ?? undefined });
      setBarcode('');
      focusBarcodeInput(0);
      return true;
    }
    return false;
  }

  async function submitBarcodeScan(rawScan: string) {
    if (!authUser) {
      navigateTo('/login', setRoute);
      return;
    }
    const classified = classifyScan(rawScan);
    if (classified.type === 'invalid') {
      setBarcode('');
      setLastRejected({ barcode: '', error: 'NO_MAPPING', message: 'Nieprawidłowy skan.' });
      focusBarcodeInput(0);
      return;
    }
    if (classified.type === 'card') {
      await handleCardAction(classified.value);
      return;
    }
    const trimmedBarcode = classified.value;
    setBarcode(trimmedBarcode);
    if (testSession?.locked) {
      setLastRejected({
        barcode: '',
        error: 'TEST_IN_PROGRESS',
        errorCode: 'TEST_IN_PROGRESS',
        message: testSession.message ?? 'Test w toku — poczekaj na wynik',
        activeTest: testSession,
      });
      return;
    }

    setStatus('scanning');
    setLastRejected(null);

    const response = await fetch('/api/scan', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barcode: trimmedBarcode }),
    });

    const payload = (await response.json()) as ScanAcceptedResponse | ScanRejectedPayload;

    if (response.status === 401) {
      setAuthUser(null);
      navigateTo('/login', setRoute);
      return;
    }

    if (!response.ok || !('programStart' in payload)) {
      const rejectedPayload = payload as ScanRejectedPayload;
      if (rejectedPayload.errorCode === 'TEST_IN_PROGRESS' || rejectedPayload.code === 'TEST_IN_PROGRESS') {
        setLastRejected(rejectedPayload);
        if (rejectedPayload.activeTest) setTestSession(rejectedPayload.activeTest);
      } else {
        setLastRejected({ barcode: rejectedPayload.barcode, error: 'NO_MAPPING', message: rejectedPayload.message });
        setStatus('no-mapping');
      }
      focusBarcodeInput(0);
      return;
    }

    resetChartForNewTest();
    setLastAccepted(payload);
    setLastRejected(null);
    setBarcode('');
    setStatus(payload.programStart.success ? 'program-selected' : 'start-error');
    if (payload.activeTest) setTestSession(payload.activeTest);
    await loadInstructionForMapping(payload.currentTest.mappingId);
    if (!payload.programStart.success) focusBarcodeInput(0);
  }

  async function submitScan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitBarcodeScan(barcode || scanBufferRef.current);
  }

  async function completeBufferedScan(rawScan: string) {
    scanBufferRef.current = '';
    const classified = classifyScan(rawScan);
    if (classified.type === 'card') {
      setBarcode('');
      await handleCardAction(classified.value);
      return;
    }
    if (classified.type === 'barcode') {
      setBarcode(classified.value);
      await submitBarcodeScan(classified.value);
      return;
    }
    setBarcode('');
    setLastRejected({ barcode: '', error: 'NO_MAPPING', message: 'Nieprawidłowy skan.' });
    focusBarcodeInput(0);
  }

  async function lpcAction(action: 'connect' | 'disconnect') {
    setLpcActionMessage(null);
    const response = await fetch(`/api/lpc/${action}`, { method: 'POST', credentials: 'include' });
    const payload = (await response.json()) as { message?: string; state?: LpcStatusPayload };
    setLpcActionMessage(payload.message ?? (response.ok ? `LPC ${action} wysłane` : `LPC ${action} błąd`));
    if (payload.state) setLpcStatus(payload.state);
    await refreshLpcStatus();
  }

  async function checkLpcPort() {
    setPortCheck(null);
    const response = await fetch('/api/lpc/check-port', { method: 'POST', credentials: 'include' });
    if (response.ok) setPortCheck((await response.json()) as LpcPortCheckPayload);
  }

  async function heartbeatTest() {
    const response = await fetch('/api/lpc/heartbeat-test', { method: 'POST', credentials: 'include' });
    setHeartbeatResponse(JSON.stringify(await response.json(), null, 2));
    await refreshLpcStatus();
  }

  async function forceRefreshStatus() {
    const response = await fetch('/api/lpc/force-refresh-status', { method: 'POST', credentials: 'include' });
    setForceRefreshResponse(JSON.stringify(await response.json(), null, 2));
    await refreshLpcStatus();
  }

  async function testProgramStart() {
    const response = await fetch('/api/programs/start', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ program: Number(diagnosticProgram), barcode: 'diagnostic_program_start' }),
    });
    setProgramStartTestResponse(JSON.stringify(await response.json(), null, 2));
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setAuthUser(null);
    navigateTo('/login', setRoute);
  }

  async function sendMockLine() {
    const response = await fetch('/api/lpc/mock-line', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line: mockLine }),
    });
    setMockLineResponse(JSON.stringify(await response.json(), null, 2));
  }

  const lastBarcode = lastAccepted?.currentTest.barcode ?? lastResult?.barcode ?? '-';
  const currentProgram = lastAccepted?.currentTest.programText ?? lastResult?.programText ?? '-';
  const startMessage = lastAccepted ? getProgramStartOperatorMessage(lastAccepted.programStart, lastAccepted.currentTest.programText) : statusLabels[status];
  const startOk = lastAccepted?.programStart.success ?? false;
  const compactLpcStatus = getCompactLpcStatus(lpcStatus);
  const splunkCompactLabel = getCompactSplunkLabel(splunkStatus);
  const connectionClass = `connection-${compactLpcStatus.state}`;
  const activeInstructionMappingId = lastAccepted?.currentTest.mappingId ?? null;
  const instructionAvailable = Boolean(currentInstruction?.exists && activeInstructionMappingId);
  const displayedCurvePoints = (curvePoints.length > 0 ? curvePoints : completedCurvePoints).filter(isValidCurvePoint);
  const estimatedLeakTrendPaPerSec = estimatedLeakRateEnabled
    ? getLatestEstimatedLeakTrend(displayedCurvePoints, estimatedLeakWindowPoints)
    : null;
  const liveSegment = getSegmentDisplay(lastStream?.segment);
  const isProperMeasurement = isMeasurementSegment(lastStream?.segment);
  const finalRlValue = finalMarkerResult?.leakValue ?? chartFinalResult?.leakValue ?? null;
  const finalRlUnit = finalMarkerResult?.leakUnit ?? chartFinalResult?.leakUnit ?? null;
  const liveRlValue = lastStream?.liveLeakValue ?? null;
  const liveRlUnit = lastStream?.liveLeakUnit ?? null;
  const rlMetricLabel = finalRlValue !== null ? 'Finalny RL' : liveRlValue !== null ? 'RL live' : 'Pomiar RL';
  const rlMetricValue = finalRlValue !== null ? finalRlValue : liveRlValue;
  const rlMetricUnit = finalRlValue !== null ? finalRlUnit : liveRlUnit;
  const rlMetricHint = finalRlValue !== null ? 'Finalny wynik z ramki R' : liveRlValue !== null ? 'Live z ramki S / DPT' : 'Oczekiwanie na DPT';
  const scanLocked = Boolean(testSession?.locked);
  const scanStatusText = scanLocked ? 'Trwa test — poczekaj na wynik' : (status === 'program-selected' && lastAccepted ? `${lastAccepted.currentTest.programText} wybrany` : statusLabels[status]);
  const activeTestHelper = scanLocked ? [testSession?.programText, testSession?.barcode].filter(Boolean).join(' / ') : '';
  const resultsTable = resultHistory.length > 0 ? (
    <table className="results-table">
      <thead>
        <tr><th>Czas</th><th>Wynik</th><th>Operator</th><th>Program</th><th>Barcode</th><th>ID</th><th>Pomiar</th><th>RL</th><th>Pt</th><th>EDC</th><th>PL</th><th className="hide-on-medium">LLR</th><th className="hide-on-medium">HLR</th><th className="hide-on-medium">FPR</th></tr>
      </thead>
      <tbody>
        {resultHistory.map((result) => (
          <tr key={`${result.receivedAt}-${result.uniqueId}`}>
            <td title={formatDateTime(result.receivedAt)}>{formatDateTime(result.receivedAt)}</td>
            <td><span className={`result-badge ${getResultClass(result.result)}`}>{formatResultLabel(result.result)}</span></td>
            <td title={result.operatorLogin ?? '-'}>{result.operatorLogin ?? '-'}</td>
            <td title={result.programText ?? '-'}>{result.programText}</td>
            <td title={result.barcode}>{result.barcode}</td>
            <td title={String(result.uniqueId ?? result.totalAbs)}>{result.uniqueId ?? result.totalAbs}</td>
            <td title={`${result.leakType} ${formatMeasurement(result.leakValue, result.leakUnit)}`}>{result.leakType} {formatMeasurement(result.leakValue, result.leakUnit)}</td>
            <td>{formatNumber(result.RL, 2)}</td>
            <td>{formatNumber(result.Pt, 2)}</td>
            <td>{formatNumber(result.EDC, 2)}</td>
            <td>{formatNumber(result.PL, 2)}</td>
            <td className="hide-on-medium">{formatNumber(result.LLR, 2)}</td>
            <td className="hide-on-medium">{formatNumber(result.HLR, 2)}</td>
            <td className="hide-on-medium">{formatNumber(result.FPR, 2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : <p className="empty-state">Brak historii</p>;
  const resultsPreview = resultHistory.length > 0 ? (
    <div className="results-preview-table-wrap">
      <table className="results-preview-table">
        <thead>
          <tr><th>Czas</th><th>Wynik</th><th>Program</th><th>Barcode</th><th>Pomiar</th></tr>
        </thead>
        <tbody>
          {resultHistory.slice(0, 4).map((result) => (
            <tr key={`preview-${result.receivedAt}-${result.uniqueId}`}>
              <td title={formatDateTime(result.receivedAt)}>{formatDateTime(result.receivedAt)}</td>
              <td><span className={`result-badge ${getResultClass(result.result)}`}>{formatResultLabel(result.result)}</span></td>
              <td title={result.programText ?? '-'}>{result.programText}</td>
              <td title={result.barcode}>{result.barcode}</td>
              <td title={`${result.leakType} ${formatMeasurement(result.leakValue, result.leakUnit)}`}>
                {result.leakType} {formatMeasurement(result.leakValue, result.leakUnit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : <p className="empty-state results-preview-empty">Brak historii</p>;

  if (authLoading) {
    return <main className="login-shell"><div className="login-card"><h1>Ładowanie...</h1></div></main>;
  }

  if (!authUser || route === '/login') {
    return <LoginPage onLoggedIn={(user) => {
      setIdleLogoutMessage(null);
      setAuthUser(user);
      navigateTo('/operator', setRoute);
    }} idleMessage={idleLogoutMessage} />;
  }

  if (route === '/admin/users') {
    if (!isManager(authUser)) return <main className="login-shell"><div className="login-card"><h1>Brak uprawnień</h1><button type="button" onClick={() => navigateTo('/operator', setRoute)}>Wróć</button></div></main>;
    return <UsersPage user={authUser} onBack={() => navigateTo('/operator', setRoute)} />;
  }

  if (route === '/admin/programs') {
    if (!canManagePrograms(authUser)) return <main className="login-shell"><div className="login-card"><h1>Brak uprawnień</h1><button type="button" onClick={() => navigateTo('/operator', setRoute)}>Wróć</button></div></main>;
    return <ProgramsPage user={authUser} onBack={() => navigateTo('/operator', setRoute)} />;
  }

  return (
    <main className={`app-shell theme-${theme}`}>
      <header className="top-bar">
        <div className="brand-block">
          {carrierLogoAvailable ? (
            <img className="carrier-logo" src={carrierLogo} alt="Carrier" onError={() => setCarrierLogoAvailable(false)} />
          ) : (
            <span className="carrier-logo-fallback">Carrier</span>
          )}
          <div>
            <span className="eyebrow">LPC-528</span>
            <strong>Panel operatorski</strong>
          </div>
        </div>
        <div className="top-bar-center">
          <div className="top-metric"><span>Program</span><strong>{currentProgram}</strong></div>
          <div className="top-metric"><span>Barcode</span><strong>{lastBarcode}</strong></div>
          <button
            type="button"
            className="instruction-top-button"
            disabled={!instructionAvailable}
            onClick={() => { if (instructionAvailable) setInstructionOpen(true); }}
            title={instructionAvailable ? currentInstruction?.originalName ?? 'Instrukcja PDF' : 'Brak instrukcji PDF dla programu'}
          >
            <span aria-hidden="true">PDF</span>
            <strong>{instructionAvailable ? 'Instrukcja' : 'Brak PDF'}</strong>
          </button>
        </div>
        <div className="top-bar-actions">
          <div className={`connection-badge ${connectionClass}`}>
            <span className="connection-dot" />
            <div>
              <strong>{compactLpcStatus.label}</strong>
              <small>{splunkCompactLabel}</small>
              {lpcStatus?.nextReconnectAt && <small>Ponowna próba: {formatDateTime(lpcStatus.nextReconnectAt)}</small>}
              {lpcStatus?.lastError && <small className="connection-error-text">{lpcStatus.lastError}</small>}
            </div>
          </div>
          <UserMenu
            login={authUser.login}
            role={authUser.role}
            theme={theme}
            canManageUsers={isManager(authUser)}
            canManagePrograms={canManagePrograms(authUser)}
            canOpenDiagnostics={canOpenDiagnostics(authUser)}
            open={userMenuOpen}
            onToggle={() => setUserMenuOpen((open) => {
              const nextOpen = !open;
              if (open) focusBarcodeInput(120);
              return nextOpen;
            })}
            onClose={() => {
              setUserMenuOpen(false);
              focusBarcodeInput(120);
            }}
            onResults={() => {
              setUserMenuOpen(false);
              setResultsOpen(true);
            }}
            onUsers={() => {
              setUserMenuOpen(false);
              navigateTo('/admin/users', setRoute);
            }}
            onPrograms={() => {
              setUserMenuOpen(false);
              navigateTo('/admin/programs', setRoute);
            }}
            onDiagnostics={() => {
              setUserMenuOpen(false);
              setDiagnosticsOpen(true);
            }}
            onThemeChange={(nextTheme) => setTheme(nextTheme)}
            onLogout={() => {
              setUserMenuOpen(false);
              void logout();
            }}
          />
        </div>
      </header>

      <section className="operator-grid">
        <aside className={`panel scan-panel status-${status}`}>
          <div className="panel-header scan-header">
            <span>Skanowanie</span>
            <strong className="scan-status">{scanStatusText}</strong>
          </div>
          <form className="scan-form" onSubmit={submitScan}>
            <label htmlFor="barcode-input">Barcode</label>
            <input
              id="barcode-input"
              className={`scan-input${scanLocked ? ' is-disabled' : ''}`}
              ref={barcodeInputRef}
              autoFocus
              disabled={scanLocked}
              value={scanLocked ? 'Trwa test — poczekaj na wynik' : barcode}
              onChange={(event) => {
                if (scanLocked) return;
                const classified = classifyScan(event.target.value);
                if (classified.type === 'card') {
                  setBarcode('');
                  return;
                }
                if (classified.type === 'barcode') setBarcode(event.target.value);
              }}
              onKeyDown={(event) => {
                if (scanLocked) return;
                if (event.key === 'Enter') {
                  event.preventDefault();
                  const pendingScan = scanBufferRef.current || event.currentTarget.value;
                  void completeBufferedScan(pendingScan);
                  return;
                }
                if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
                  event.preventDefault();
                  scanBufferRef.current += event.key;
                }
              }}
              onPaste={(event) => {
                event.preventDefault();
                if (scanLocked) return;
                const pasted = event.clipboardData.getData('text');
                scanBufferRef.current = pasted;
                void completeBufferedScan(pasted);
              }}
              placeholder={scanLocked ? 'Trwa test — poczekaj na wynik' : 'Zeskanuj barcode'}
            />
            {scanLocked && (
              <p className="scan-helper">
                Trwa test — poczekaj na wynik{activeTestHelper ? <>: <strong>{activeTestHelper}</strong></> : '.'}
              </p>
            )}
            <button className="scan-submit" type="submit" disabled={status === 'scanning' || scanLocked}>Wyślij skan</button>
          </form>

          {lastAccepted && (
            <div className="scan-summary">
              <div><span>Barcode</span><strong>{lastAccepted.currentTest.barcode}</strong></div>
              <div><span>Matched key</span><strong>{lastAccepted.currentTest.matchedKey}</strong></div>
              <div><span>Program</span><strong>{lastAccepted.currentTest.programText}</strong></div>
              <div><span>Start LPC</span><strong className={startOk ? 'ok-text' : 'error-text'}>{startOk ? 'OK' : 'FAIL'}</strong></div>
              <p className={startOk ? 'operator-message ok-text' : 'operator-message error-text'}>{startMessage}</p>
              <span className="mode-badge">{lastAccepted.programStart.mode}</span>
              {lastAccepted.programStart.dryRun && <span className="dry-run-badge">SUCHY TEST — brak realnego startu LPC</span>}
            </div>
          )}

          {lastRejected && (
            <div className={lastRejected.error === 'TEST_IN_PROGRESS' ? 'scan-helper' : 'scan-error'}>
              <strong>{lastRejected.error}</strong>
              <span>{lastRejected.error === 'TEST_IN_PROGRESS' ? lastRejected.message : `${lastRejected.message}: ${lastRejected.barcode}`}</span>
            </div>
          )}
        </aside>

        <section className="panel live-panel">
          <div className="panel-header">
            <span>Live test</span>
            <strong>{lastStream ? liveSegment : 'Oczekiwanie na dane LPC'}</strong>
            {isProperMeasurement && <span className="phase-badge">Pomiar właściwy</span>}
          </div>
          <div className="metrics-grid">
            <div className="metric-card"><span>Program</span><strong>{currentProgram}</strong></div>
            <div className="metric-card"><span>Barcode</span><strong>{lastBarcode}</strong></div>
            <div className="metric-card"><span>Segment</span><strong>{liveSegment}</strong>{isProperMeasurement && <small className="metric-hint">Pomiar właściwy</small>}</div>
            <div className="metric-card"><span>Elapsed</span><strong>{formatNumber(lastStream?.elapsedTimeSec, 2)} s</strong></div>
            <div className="metric-card"><span>Czas do końca fazy</span><strong>{formatNumber(lastStream?.remainingTimeSec, 2)} s</strong></div>
            <div className="metric-card emphasis"><span>Ciśnienie [mbar]</span><strong>{formatNumber(lastStream?.pressureMbar, 2)}</strong></div>
            <div className="metric-card leak-live"><span>{rlMetricLabel}</span><strong>{formatMeasurement(rlMetricValue, rlMetricUnit, 3)}</strong><small className="metric-hint">{rlMetricHint}</small></div>
            {estimatedLeakRateEnabled && (
              <div className="metric-card estimated"><span>Szacowany trend [Pa/s]</span><strong>{formatNumber(estimatedLeakTrendPaPerSec, 3)}</strong><small className="metric-hint">Trend ciśnienia, nie wynik RL</small></div>
            )}
          </div>

          <PressureChart points={displayedCurvePoints} lastResult={finalMarkerResult?.result ?? chartFinalResult} />
        </section>

        <aside className="panel result-column">
          <LastResultPanel result={lastResult} />
          <section className="results-preview" aria-label="Wyniki testów">
            <div className="results-preview-header">
              <span>Wyniki testów</span>
              <button type="button" className="results-cta" onClick={() => setResultsOpen(true)}>
                <strong>Wyniki testów</strong>
                <span>Otwórz pełną historię pomiarów</span>
              </button>
            </div>
            <small className="results-preview-hint">Przesuń tabelę w bok, aby zobaczyć więcej.</small>
            {resultsPreview}
          </section>
        </aside>
      </section>

      {resultsOpen && (
        <div className="app-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setResultsOpen(false);
            focusBarcodeInput(120);
          }
        }}>
          <section className="app-modal results-modal" role="dialog" aria-modal="true" aria-label="Wyniki testów">
            <header className="modal-header">
              <div>
                <span className="eyebrow">Historia</span>
                <h2>Wyniki testów</h2>
              </div>
              <button type="button" className="modal-close" onClick={() => {
                setResultsOpen(false);
                focusBarcodeInput(120);
              }}>×</button>
            </header>
            <div className="results-modal-table">
              {resultsTable}
            </div>
          </section>
        </div>
      )}

      {instructionOpen && activeInstructionMappingId && currentInstruction?.exists && (
        <div className="app-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setInstructionOpen(false);
            focusBarcodeInput(120);
          }
        }}>
          <section className="app-modal instruction-modal" role="dialog" aria-modal="true" aria-label="Instrukcja programu">
            <header className="modal-header">
              <div>
                <span className="eyebrow">Instrukcja PDF</span>
                <h2>Instrukcja programu {currentProgram}</h2>
                <p>{currentInstruction.originalName ?? 'instruction.pdf'}</p>
              </div>
              <button type="button" className="modal-close" onClick={() => {
                setInstructionOpen(false);
                focusBarcodeInput(120);
              }}>×</button>
            </header>
            <div className="pdf-viewer-body">
              <iframe className="pdf-viewer-frame" src={`/api/programs/${encodeURIComponent(activeInstructionMappingId)}/instruction/file`} title={`Instrukcja programu ${currentProgram}`} />
            </div>
            <a className="instruction-fallback-link" href={`/api/programs/${encodeURIComponent(activeInstructionMappingId)}/instruction/file`} target="_blank" rel="noreferrer">Otwórz PDF</a>
          </section>
        </div>
      )}

      {showDiagnostics && diagnosticsOpen && (
        <div className="diagnostics-modal" role="dialog" aria-modal="true" aria-label="Diagnostyka">
          <div className="diagnostics-content">
            <header>
              <h2>Diagnostyka</h2>
              <button type="button" onClick={() => {
                setDiagnosticsOpen(false);
                focusBarcodeInput(120);
              }}>Zamknij</button>
            </header>
            <div className="diagnostics-grid">
              <section>
                <h3>LPC</h3>
                <div className="lpc-actions">
                  <button type="button" onClick={() => void lpcAction('connect')}>Połącz</button>
                  <button type="button" onClick={() => void lpcAction('disconnect')}>Rozłącz</button>
                  <button type="button" onClick={() => void checkLpcPort()}>Sprawdź port LPC</button>
                  <button type="button" onClick={() => void heartbeatTest()}>Heartbeat test</button>
                  <button type="button" onClick={() => void forceRefreshStatus()}>Force refresh status</button>
                  <button type="button" onClick={async () => {
                    const response = await fetch('/api/test-session/unlock', { method: 'POST', credentials: 'include' });
                    if (response.ok) setTestSession(await response.json() as TestSessionState);
                  }}>Odblokuj test</button>
                </div>
                <pre>{JSON.stringify({
                  ...eventCounters,
                  chartPointsCount: displayedCurvePoints.length,
                  currentCurvePoints: curvePoints.length,
                  completedCurvePoints: completedCurvePoints.length,
                  ignoreCompletedCurveUntilNewStream,
                  chartStatus,
                  chartFinalResult: chartFinalResult?.result ?? null,
                  finalMarkerResult: finalMarkerResult
                    ? {
                        result: finalMarkerResult.result.result,
                        displayLabel: finalMarkerResult.displayLabel,
                        leakType: finalMarkerResult.leakType,
                        leakValue: finalMarkerResult.leakValue,
                        leakUnit: finalMarkerResult.leakUnit,
                        point: finalMarkerResult.point,
                        receivedAt: finalMarkerResult.receivedAt,
                      }
                    : null,
                }, null, 2)}</pre>
                {lpcActionMessage && <pre>{lpcActionMessage}</pre>}
                {portCheck && <pre>{JSON.stringify(portCheck, null, 2)}</pre>}
                {heartbeatResponse && <pre>{heartbeatResponse}</pre>}
                {forceRefreshResponse && <pre>{forceRefreshResponse}</pre>}
                <textarea value={mockLine} onChange={(event) => setMockLine(event.target.value)} placeholder="Raw LPC line do testu UI" />
                <button type="button" onClick={() => void sendMockLine()}>Wyślij mock line</button>
                {mockLineResponse && <pre>{mockLineResponse}</pre>}
              </section>

              <section>
                <h3>ProgramStarter</h3>
                <div className="program-start-test">
                  <input value={diagnosticProgram} onChange={(event) => setDiagnosticProgram(event.target.value)} inputMode="numeric" />
                  <button type="button" onClick={() => void testProgramStart()}>Start P{String(Number(diagnosticProgram) || 0).padStart(2, '0')}</button>
                </div>
                {lastAccepted?.programStart && <pre>{JSON.stringify(lastAccepted.programStart, null, 2)}</pre>}
                {programStartTestResponse && <pre>{programStartTestResponse}</pre>}
              </section>

              <section>
                <h3>Ostatnie punkty krzywej</h3>
                <pre>{JSON.stringify(curvePoints.slice(-20), null, 2)}</pre>
              </section>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />);
