import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { BarcodeScan, CurrentTest, LpcResult, LpcStreamPoint, ProgramStartRequest, ProgramStartResult } from '../shared/types';
import { formatDateTime, formatNumber, formatResultLabel, getConnectionLabel, getResultClass } from './formatters';
import { getProgramStartOperatorMessage } from './programStartMessages';
import { mergeResultIntoHistory, replaceHistoryFromResultsUpdated } from './resultHistoryState';
import './styles.css';

interface ScanAcceptedPayload {
  scan: BarcodeScan;
  currentTest: CurrentTest;
  programStartRequest: ProgramStartRequest;
  programStart: ProgramStartResult;
}

interface ScanRejectedPayload {
  ok?: false;
  barcode: string;
  error: 'NO_MAPPING';
  message: string;
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
  off(event: string): void;
  disconnect(): void;
}

declare global {
  interface Window {
    io?: () => SocketLike;
  }
}

type OperatorStatus = 'ready' | 'scanning' | 'program-selected' | 'no-mapping' | 'start-error';

const statusLabels: Record<OperatorStatus, string> = {
  ready: 'Gotowy do skanu',
  scanning: 'Skanuję...',
  'program-selected': 'Program wysłany do LPC',
  'no-mapping': 'Brak mapowania',
  'start-error': 'Błąd startu programu',
};

const measurementKeys = ['RL', 'Pt', 'EDC', 'PL', 'LLR', 'HLR', 'FPR'] as const;
const showDiagnostics = ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SHOW_DIAGNOSTICS ?? 'false') === 'true';

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
  const response = await fetch(url);
  if (!response.ok) return null;
  return response.json() as Promise<T>;
}

async function fetchLpcStatus(): Promise<LpcStatusPayload | null> {
  return fetchJson<LpcStatusPayload>('/api/lpc/status');
}

async function fetchLpcRuntimeState(): Promise<{
  lastResult: EnrichedLpcResult | null;
  results: EnrichedLpcResult[];
  points: LpcCurvePoint[];
}> {
  const [lastResultPayload, resultsPayload, curvePayload] = await Promise.all([
    fetchJson<{ ok: true; result: EnrichedLpcResult | null }>('/api/lpc/last-result'),
    fetchJson<{ ok: true; results: EnrichedLpcResult[] }>('/api/lpc/results'),
    fetchJson<{ ok: true; points: LpcCurvePoint[] }>('/api/lpc/curve'),
  ]);

  return {
    lastResult: lastResultPayload?.result ?? null,
    results: resultsPayload?.results ?? [],
    points: curvePayload?.points ?? [],
  };
}

function buildChartPolyline(points: LpcCurvePoint[]): string {
  const validPoints = points.filter((point) => point.pressureMbar !== null);
  if (validPoints.length < 2) return '';

  const minX = Math.min(...validPoints.map((point) => point.elapsedTimeSec));
  const maxX = Math.max(...validPoints.map((point) => point.elapsedTimeSec));
  const minY = Math.min(...validPoints.map((point) => point.pressureMbar ?? 0));
  const maxY = Math.max(...validPoints.map((point) => point.pressureMbar ?? 0));
  const xRange = maxX - minX || 1;
  const yRange = maxY - minY || 1;

  return validPoints.map((point) => {
    const x = 52 + ((point.elapsedTimeSec - minX) / xRange) * 820;
    const y = 330 - (((point.pressureMbar ?? 0) - minY) / yRange) * 280;
    return `${x},${y}`;
  }).join(' ');
}

function getSafeLpcConnectionLabel(status: LpcStatusPayload | null): string {
  if (!status) return getConnectionLabel(null, false);
  const safeConnected = status.connected && !status.lastError && status.socketDestroyed !== true && status.socketWritable !== false;
  return getConnectionLabel(status.status, safeConnected);
}

function App() {
  const [barcode, setBarcode] = useState('');
  const [status, setStatus] = useState<OperatorStatus>('ready');
  const [lastAccepted, setLastAccepted] = useState<ScanAcceptedPayload | null>(null);
  const [lastRejected, setLastRejected] = useState<ScanRejectedPayload | null>(null);
  const [lpcStatus, setLpcStatus] = useState<LpcStatusPayload | null>(null);
  const [lastStream, setLastStream] = useState<LpcStreamPayload | null>(null);
  const [lastResult, setLastResult] = useState<EnrichedLpcResult | null>(null);
  const [resultHistory, setResultHistory] = useState<EnrichedLpcResult[]>([]);
  const [curvePoints, setCurvePoints] = useState<LpcCurvePoint[]>([]);
  const [lpcActionMessage, setLpcActionMessage] = useState<string | null>(null);
  const [portCheck, setPortCheck] = useState<LpcPortCheckPayload | null>(null);
  const [mockLine, setMockLine] = useState('');
  const [mockLineResponse, setMockLineResponse] = useState<string | null>(null);
  const [heartbeatResponse, setHeartbeatResponse] = useState<string | null>(null);
  const [forceRefreshResponse, setForceRefreshResponse] = useState<string | null>(null);
  const [diagnosticProgram, setDiagnosticProgram] = useState('1');
  const [programStartTestResponse, setProgramStartTestResponse] = useState<string | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [eventCounters, setEventCounters] = useState({
    streamEvents: 0,
    resultEvents: 0,
    resultsUpdatedEvents: 0,
    curveUpdatedEvents: 0,
    curveCompletedEvents: 0,
  });
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);

  async function refreshLpcStatus() {
    const nextStatus = await fetchLpcStatus();
    if (nextStatus) setLpcStatus(nextStatus);
  }

  useEffect(() => {
    void refreshLpcStatus();
    const refreshRuntimeState = () => {
      void fetchLpcRuntimeState().then((payload) => {
        if (payload.lastResult) setLastResult(payload.lastResult);
        if (payload.results.length > 0) setResultHistory(replaceHistoryFromResultsUpdated(payload.results, 10));
        if (payload.points.length > 0) setCurvePoints(payload.points.slice(-150));
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
        setCurvePoints(payload.points.slice(-150));
      });

      socket.on('lpc:result', (payload) => {
        setEventCounters((counters) => ({ ...counters, resultEvents: counters.resultEvents + 1 }));
        setLastResult(payload);
        setResultHistory((results) => mergeResultIntoHistory(results, payload, 10));
      });

      socket.on('lpc:results-updated', (payload) => {
        setEventCounters((counters) => ({ ...counters, resultsUpdatedEvents: counters.resultsUpdatedEvents + 1 }));
        setResultHistory(replaceHistoryFromResultsUpdated(payload.results, 10));
      });

      socket.on('lpc:curve-completed', (payload) => {
        setEventCounters((counters) => ({ ...counters, curveCompletedEvents: counters.curveCompletedEvents + 1 }));
        setCurvePoints(payload.points.slice(-150));
      });

      socket.on('test:completed', (payload) => {
        setLastResult(payload);
        setResultHistory((results) => mergeResultIntoHistory(results, payload, 10));
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
      activeSocket?.disconnect();
    };
  }, []);

  async function submitScan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedBarcode = barcode.trim();
    if (!trimmedBarcode) return;

    setStatus('scanning');
    setLastRejected(null);

    const response = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barcode: trimmedBarcode }),
    });

    const payload = (await response.json()) as ScanAcceptedResponse | ScanRejectedPayload;

    if (!response.ok || !('programStart' in payload)) {
      const rejectedPayload = payload as ScanRejectedPayload;
      setLastRejected({ barcode: rejectedPayload.barcode, error: 'NO_MAPPING', message: rejectedPayload.message });
      setStatus('no-mapping');
      window.setTimeout(() => barcodeInputRef.current?.focus(), 0);
      return;
    }

    setLastAccepted(payload);
    setLastRejected(null);
    setBarcode('');
    setStatus(payload.programStart.success ? 'program-selected' : 'start-error');
    window.setTimeout(() => barcodeInputRef.current?.focus(), 0);
  }

  async function lpcAction(action: 'connect' | 'disconnect') {
    setLpcActionMessage(null);
    const response = await fetch(`/api/lpc/${action}`, { method: 'POST' });
    const payload = (await response.json()) as { message?: string; state?: LpcStatusPayload };
    setLpcActionMessage(payload.message ?? (response.ok ? `LPC ${action} wysłane` : `LPC ${action} błąd`));
    if (payload.state) setLpcStatus(payload.state);
    await refreshLpcStatus();
  }

  async function checkLpcPort() {
    setPortCheck(null);
    const response = await fetch('/api/lpc/check-port', { method: 'POST' });
    if (response.ok) setPortCheck((await response.json()) as LpcPortCheckPayload);
  }

  async function heartbeatTest() {
    const response = await fetch('/api/lpc/heartbeat-test', { method: 'POST' });
    setHeartbeatResponse(JSON.stringify(await response.json(), null, 2));
    await refreshLpcStatus();
  }

  async function forceRefreshStatus() {
    const response = await fetch('/api/lpc/force-refresh-status', { method: 'POST' });
    setForceRefreshResponse(JSON.stringify(await response.json(), null, 2));
    await refreshLpcStatus();
  }

  async function testProgramStart() {
    const response = await fetch('/api/programs/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ program: Number(diagnosticProgram), barcode: 'diagnostic_program_start' }),
    });
    setProgramStartTestResponse(JSON.stringify(await response.json(), null, 2));
  }

  async function sendMockLine() {
    const response = await fetch('/api/lpc/mock-line', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line: mockLine }),
    });
    setMockLineResponse(JSON.stringify(await response.json(), null, 2));
  }

  const chartPoints = useMemo(() => buildChartPolyline(curvePoints), [curvePoints]);
  const lastBarcode = lastAccepted?.currentTest.barcode ?? lastResult?.barcode ?? '-';
  const currentProgram = lastAccepted?.currentTest.programText ?? lastResult?.programText ?? '-';
  const topResultLabel = lastResult ? formatResultLabel(lastResult.result) : '-';
  const startMessage = lastAccepted ? getProgramStartOperatorMessage(lastAccepted.programStart, lastAccepted.currentTest.programText) : statusLabels[status];
  const startOk = lastAccepted?.programStart.success ?? false;
  const connectionLabel = getSafeLpcConnectionLabel(lpcStatus);
  const connectionClass = lpcStatus?.lastError ? 'connection-error' : `connection-${lpcStatus?.status ?? 'idle'}`;

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div className="brand-block">
          <span className="eyebrow">LPC-528</span>
          <strong>Panel operatorski</strong>
        </div>
        <div className="top-metric"><span>Program</span><strong>{currentProgram}</strong></div>
        <div className="top-metric"><span>Barcode</span><strong>{lastBarcode}</strong></div>
        <div className={`top-result ${lastResult ? getResultClass(lastResult.result) : 'status-unknown'}`}><span>Wynik</span><strong>{topResultLabel}</strong></div>
        <div className={`connection-badge ${connectionClass}`}>
          <span className="connection-dot" />
          <div>
            <strong>{connectionLabel}</strong>
            <small>{lpcStatus ? `${lpcStatus.host}:${lpcStatus.port}` : 'LPC status...'}</small>
            {lpcStatus?.nextReconnectAt && <small>Ponowna próba: {formatDateTime(lpcStatus.nextReconnectAt)}</small>}
            {lpcStatus?.lastError && <small className="connection-error-text">{lpcStatus.lastError}</small>}
          </div>
        </div>
        {showDiagnostics && <button className="diagnostics-button" type="button" onClick={() => setDiagnosticsOpen(true)}>Diagnostyka</button>}
      </header>

      <section className="operator-grid">
        <aside className={`panel scan-panel status-${status}`}>
          <div className="panel-header">
            <span>Skanowanie</span>
            <strong>{status === 'program-selected' && lastAccepted ? `${lastAccepted.currentTest.programText} wybrany` : statusLabels[status]}</strong>
          </div>
          <form className="scan-form" onSubmit={submitScan}>
            <label htmlFor="barcode-input">Barcode</label>
            <input
              id="barcode-input"
              ref={barcodeInputRef}
              autoFocus
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              placeholder="Zeskanuj barcode"
            />
            <button type="submit" disabled={status === 'scanning'}>Wyślij skan</button>
          </form>

          {lastAccepted && (
            <div className="scan-summary">
              <div><span>Barcode</span><strong>{lastAccepted.currentTest.barcode}</strong></div>
              <div><span>Matched key</span><strong>{lastAccepted.currentTest.matchedKey}</strong></div>
              <div><span>Program</span><strong>{lastAccepted.currentTest.programText}</strong></div>
              <div><span>Start LPC</span><strong className={startOk ? 'ok-text' : 'error-text'}>{startOk ? 'OK' : 'FAIL'}</strong></div>
              <p className={startOk ? 'operator-message ok-text' : 'operator-message error-text'}>{startMessage}</p>
              <span className="mode-badge">{lastAccepted.programStart.mode}</span>
            </div>
          )}

          {lastRejected && (
            <div className="scan-error">
              <strong>{lastRejected.error}</strong>
              <span>{lastRejected.message}: {lastRejected.barcode}</span>
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

          <div className="chart-wrap">
            <svg className="pressure-chart" viewBox="0 0 930 380" role="img" aria-label="Ciśnienie w czasie">
              <line x1="52" y1="330" x2="890" y2="330" />
              <line x1="52" y1="40" x2="52" y2="330" />
              {chartPoints && <polyline points={chartPoints} />}
              <text x="415" y="366">Czas [s]</text>
              <text x="70" y="30">Ciśnienie [mbar]</text>
            </svg>
            {!chartPoints && <div className="chart-empty">Brak danych z testu</div>}
          </div>
        </section>

        <aside className="panel result-column">
          <section className="last-result-panel">
            <div className={`result-status ${lastResult ? getResultClass(lastResult.result) : 'status-unknown'}`}>
              <span>Ostatni wynik</span>
              <strong>{lastResult ? formatResultLabel(lastResult.result) : '-'}</strong>
            </div>
            {lastResult ? (
              <div className="result-data-grid">
                <div><span>Barcode</span><strong>{lastResult.barcode}</strong></div>
                <div><span>Program</span><strong>{lastResult.programText}</strong></div>
                <div><span>TotalAbs / ID</span><strong>{lastResult.totalAbs} / {lastResult.uniqueId}</strong></div>
                <div><span>Data / czas</span><strong>{lastResult.testerDate} {lastResult.testerTime}</strong></div>
                <div><span>Leak</span><strong>{lastResult.leakType} {formatNumber(lastResult.leakValue, 6)} {lastResult.leakUnit}</strong></div>
                {measurementKeys.map((key) => {
                  const value = lastResult[key];
                  const unit = lastResult[`${key}_unit` as keyof EnrichedLpcResult];
                  return value === null || value === undefined ? null : (
                    <div key={key}><span>{key}</span><strong>{formatNumber(Number(value), 6)} {String(unit ?? '')}</strong></div>
                  );
                })}
              </div>
            ) : (
              <p className="empty-state">Brak końcowego wyniku testu</p>
            )}
          </section>

          <section className="history-panel">
            <h2>Ostatnie wyniki</h2>
            {resultHistory.length > 0 ? (
              <table>
                <thead>
                  <tr><th>Czas</th><th>Wynik</th><th>Program</th><th>Barcode</th><th>ID</th><th>Pomiar</th><th>RL</th><th>Pt</th><th>EDC</th><th>PL</th><th>LLR</th><th>HLR</th><th>FPR</th></tr>
                </thead>
                <tbody>
                  {resultHistory.slice(0, 10).map((result) => (
                    <tr key={`${result.receivedAt}-${result.uniqueId}`}>
                      <td>{formatDateTime(result.receivedAt)}</td>
                      <td><span className={`result-badge ${getResultClass(result.result)}`}>{formatResultLabel(result.result)}</span></td>
                      <td>{result.programText}</td>
                      <td>{result.barcode}</td>
                      <td>{result.uniqueId ?? result.totalAbs}</td>
                      <td>{formatNumber(result.leakValue, 4)} {result.leakUnit}</td>
                      <td>{formatNumber(result.RL, 3)}</td>
                      <td>{formatNumber(result.Pt, 3)}</td>
                      <td>{formatNumber(result.EDC, 3)}</td>
                      <td>{formatNumber(result.PL, 3)}</td>
                      <td>{formatNumber(result.LLR, 3)}</td>
                      <td>{formatNumber(result.HLR, 3)}</td>
                      <td>{formatNumber(result.FPR, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="empty-state">Brak historii</p>}
          </section>
        </aside>
      </section>

      {showDiagnostics && diagnosticsOpen && (
        <div className="diagnostics-modal" role="dialog" aria-modal="true" aria-label="Diagnostyka">
          <div className="diagnostics-content">
            <header>
              <h2>Diagnostyka</h2>
              <button type="button" onClick={() => setDiagnosticsOpen(false)}>Zamknij</button>
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
                </div>
                <pre>{JSON.stringify(eventCounters, null, 2)}</pre>
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
