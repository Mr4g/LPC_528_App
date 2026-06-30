import React, { FormEvent, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
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
  operatorLogin: string | null;
  startedAt: string | null;
  lastStreamAt: string | null;
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
}

interface PublicUser extends AuthUser {
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  createdBy: string | null;
}

const statusLabels: Record<OperatorStatus, string> = {
  ready: 'Gotowy do skanu',
  scanning: 'Skanuję...',
  'program-selected': 'Program wysłany do LPC',
  'no-mapping': 'Brak mapowania',
  'start-error': 'Błąd startu programu',
};

const showDiagnostics = ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SHOW_DIAGNOSTICS ?? 'false') === 'true';
const LOGIN_REGEX = /^[A-Za-z]{3,5}$/;

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


function buildCurveSignature(points: LpcCurvePoint[]): string {
  const lastPoint = points.at(-1);
  if (!lastPoint) return 'empty';
  return `${points.length}:${lastPoint.elapsedTimeSec}:${lastPoint.pressureMbar ?? 'null'}:${lastPoint.segment}`;
}

function LoginPage(props: { onLoggedIn: (user: AuthUser) => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

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

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submitLogin}>
        <span className="eyebrow">LPC-528</span>
        <h1>Logowanie operatora</h1>
        <label>Login / skrót osobowy</label>
        <input className="auth-input" autoFocus value={login} onChange={(event) => setLogin(event.target.value.toUpperCase())} placeholder="Login" />
        <label>Hasło</label>
        <input className="auth-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Hasło" />
        {error && <p className="login-error">{error}</p>}
        <button type="submit">Zaloguj</button>
      </form>
    </main>
  );
}

function UsersPage(props: { user: AuthUser; onBack: () => void }) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('operator');
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
      body: JSON.stringify({ login: normalizedLogin, password, role }),
    });
    const payload = (await response.json()) as { ok: boolean; message?: string };
    setMessage(response.ok ? 'Użytkownik dodany.' : payload.message ?? 'Nie udało się dodać użytkownika.');
    if (response.ok) {
      setLogin('');
      setPassword('');
      setRole('operator');
      await loadUsers();
    }
  }

  async function userAction(id: string, action: 'enable' | 'disable') {
    await fetch(`/api/users/${id}/${action}`, { method: 'PATCH', credentials: 'include' });
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
        <select value={role} onChange={(event) => setRole(event.target.value as UserRole)} disabled={props.user.role !== 'admin'}>
          <option value="operator">operator</option>
          {props.user.role === 'admin' && <option value="line_leader">line_leader</option>}
        </select>
        <button type="submit">Dodaj użytkownika</button>
      </form>
      {message && <p className="login-error">{message}</p>}
      <section className="users-table-wrap">
        <table>
          <thead><tr><th>Login</th><th>Rola</th><th>Status</th><th>Utworzono</th><th>Ostatnie logowanie</th><th>Akcje</th></tr></thead>
          <tbody>
            {users.map((item) => (
              <tr key={item.id}>
                <td>{item.login}</td>
                <td>{item.role}</td>
                <td>{item.isActive ? 'aktywny' : 'nieaktywny'}</td>
                <td>{formatDateTime(item.createdAt)}</td>
                <td>{formatDateTime(item.lastLoginAt)}</td>
                <td>
                  <button type="button" onClick={() => void resetPassword(item.id)}>Resetuj hasło</button>
                  <button type="button" onClick={() => void userAction(item.id, item.isActive ? 'disable' : 'enable')}>{item.isActive ? 'Dezaktywuj' : 'Aktywuj'}</button>
                </td>
              </tr>
            ))}
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
  const [message, setMessage] = useState<string | null>(null);

  async function loadMappings() {
    const payload = await fetchJson<{ ok: true; mappings: ProgramMappingRecord[] }>('/api/program-mappings');
    if (payload?.mappings) setMappings(payload.mappings);
  }

  async function loadZebraSettings() {
    const payload = await fetchJson<{ ok: true; autoPrintEnabled: boolean }>('/api/zebra/settings');
    if (payload) setAutoPrintEnabled(payload.autoPrintEnabled);
  }

  useEffect(() => {
    void loadMappings();
    void loadZebraSettings();
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
      <section className="users-table-wrap">
        <table>
          <thead><tr><th>Barcode / pattern</th><th>Typ</th><th>Program</th><th>Druk</th><th>Opis</th><th>Status</th><th>UpdatedAt</th><th>Akcje</th></tr></thead>
          <tbody>
            {mappings.map((mapping) => (
              <tr key={mapping.id}>
                <td title={mapping.barcodePattern}>{mapping.barcodePattern}</td>
                <td>{mapping.matchType === 'exact' ? 'Dokładne' : 'Zawiera'}</td>
                <td>{mapping.programText}</td>
                <td>{mapping.labelPrintMode === 'ok_and_nok' ? 'OK i NOK' : 'Tylko OK'}</td>
                <td title={mapping.description ?? ''}>{mapping.description ?? '-'}</td>
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
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [eventCounters, setEventCounters] = useState({
    streamEvents: 0,
    resultEvents: 0,
    resultsUpdatedEvents: 0,
    curveUpdatedEvents: 0,
    curveCompletedEvents: 0,
  });
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const routeRef = useRef(route);
  const diagnosticsOpenRef = useRef(diagnosticsOpen);
  const resultsOpenRef = useRef(resultsOpen);
  const userMenuOpenRef = useRef(userMenuOpen);
  const ignoreCompletedCurveUntilNewStreamRef = useRef(ignoreCompletedCurveUntilNewStream);
  const hasLiveCurveRef = useRef(false);
  const ignoredCurveSignatureRef = useRef<string | null>(null);
  const chartStatusRef = useRef<ChartStatus>(chartStatus);
  const curvePointsRef = useRef<LpcCurvePoint[]>([]);
  const completedCurvePointsRef = useRef<LpcCurvePoint[]>([]);

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
      if (!input || routeRef.current !== '/operator' || diagnosticsOpenRef.current || resultsOpenRef.current || userMenuOpenRef.current) return;

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
    const payload = await fetchJson<{ ok: true; user: AuthUser | null }>('/api/auth/me');
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
    return () => window.clearInterval(runtimePoll);
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
        setCurvePoints((points) => [...points.slice(-149), {
          elapsedTimeSec: payload.elapsedTimeSec ?? 0,
          remainingTimeSec: payload.remainingTimeSec,
          pressureBar: payload.pressureValue,
          pressureMbar: payload.pressureMbar,
          segment: payload.segment,
        }]);
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
          setCurvePoints(payload.points.slice(-150));
        }
      });

      socket.on('lpc:result', (payload) => {
        setEventCounters((counters) => ({ ...counters, resultEvents: counters.resultEvents + 1 }));
        setLastResult(payload);
        // Final result marker is intentionally kept until the next accepted scan.
        setChartFinalResult(payload);
        setFinalMarkerResult(buildFinalMarker(payload, getLastKnownCurvePoint()));
        setResultHistory((results) => mergeResultIntoHistory(results, payload, 50));
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

  async function submitScan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authUser) {
      navigateTo('/login', setRoute);
      return;
    }
    const trimmedBarcode = barcode.trim();
    if (testSession?.locked) {
      setLastRejected({
        barcode: trimmedBarcode,
        error: 'TEST_IN_PROGRESS',
        errorCode: 'TEST_IN_PROGRESS',
        message: testSession.message ?? 'Test w toku — poczekaj na wynik',
        activeTest: testSession,
      });
      return;
    }
    if (!trimmedBarcode) {
      focusBarcodeInput(0);
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
    if (!payload.programStart.success) focusBarcodeInput(0);
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
  const topResultLabel = lastResult ? formatResultLabel(lastResult.result) : '-';
  const startMessage = lastAccepted ? getProgramStartOperatorMessage(lastAccepted.programStart, lastAccepted.currentTest.programText) : statusLabels[status];
  const startOk = lastAccepted?.programStart.success ?? false;
  const connectionLabel = getSafeLpcConnectionLabel(lpcStatus);
  const connectionClass = lpcStatus?.lastError ? 'connection-error' : `connection-${lpcStatus?.status ?? 'idle'}`;
  const displayedCurvePoints = curvePoints.length > 0 ? curvePoints : completedCurvePoints;
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
      setAuthUser(user);
      navigateTo('/operator', setRoute);
    }} />;
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
          <div className={`top-result ${lastResult ? getResultClass(lastResult.result) : 'status-unknown'}`}><span>Wynik</span><strong>{topResultLabel}</strong></div>
        </div>
        <div className="top-bar-actions">
          <div className={`connection-badge ${connectionClass}`}>
            <span className="connection-dot" />
            <div>
              <strong>{connectionLabel}</strong>
              <small>{lpcStatus ? `${lpcStatus.host}:${lpcStatus.port}` : 'LPC status...'}</small>
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
              onChange={(event) => setBarcode(event.target.value)}
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
            <strong>{lastStream ? lastStream.segment : 'Oczekiwanie na dane LPC'}</strong>
          </div>
          <div className="metrics-grid">
            <div className="metric-card"><span>Program</span><strong>{currentProgram}</strong></div>
            <div className="metric-card"><span>Barcode</span><strong>{lastBarcode}</strong></div>
            <div className="metric-card"><span>Segment</span><strong>{lastStream?.segment ?? '-'}</strong></div>
            <div className="metric-card"><span>Elapsed</span><strong>{formatNumber(lastStream?.elapsedTimeSec, 2)} s</strong></div>
            <div className="metric-card"><span>Remaining</span><strong>{formatNumber(lastStream?.remainingTimeSec, 2)} s</strong></div>
            <div className="metric-card"><span>Pressure [bar]</span><strong>{formatNumber(lastStream?.pressureValue, 5)}</strong></div>
            <div className="metric-card emphasis"><span>Pressure [mbar]</span><strong>{formatNumber(lastStream?.pressureMbar, 2)}</strong></div>
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
