import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { BarcodeScan, CurrentTest, LpcResult, LpcStreamPoint, ProgramStartRequest, ProgramStartResult } from '../shared/types';
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
  on(event: 'lpc:curve-completed', handler: SocketHandler<{ points: LpcCurvePoint[] }>): void;
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
  ready: 'Zeskanuj barcode',
  scanning: 'Skanuję...',
  'program-selected': 'Start testu OK',
  'no-mapping': 'Brak mapowania dla barcode',
  'start-error': 'Błąd startu testu',
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

async function fetchLpcStatus(): Promise<LpcStatusPayload | null> {
  const response = await fetch('/api/lpc/status');
  if (!response.ok) return null;
  return response.json() as Promise<LpcStatusPayload>;
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
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);

  async function refreshLpcStatus() {
    const nextStatus = await fetchLpcStatus();
    if (nextStatus) setLpcStatus(nextStatus);
  }

  useEffect(() => {
    void refreshLpcStatus();
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

      socket.on('lpc:status', (payload) => {
        setLpcStatus(payload);
      });

      socket.on('lpc:connected', (payload) => {
        setLpcStatus(payload);
      });

      socket.on('lpc:disconnected', (payload) => {
        setLpcStatus(payload);
      });

      socket.on('lpc:reconnecting', (payload) => {
        setLpcStatus(payload);
      });

      socket.on('lpc:error', (payload) => {
        setLpcActionMessage(payload.message);
        if (payload.state) setLpcStatus(payload.state);
        void refreshLpcStatus();
      });

      socket.on('lpc:stream', (payload) => {
        setLastStream(payload);
        setCurvePoints((points) => [...points.slice(-19), {
          elapsedTimeSec: payload.elapsedTimeSec ?? 0,
          remainingTimeSec: payload.remainingTimeSec,
          pressureBar: payload.pressureValue,
          pressureMbar: payload.pressureMbar,
          segment: payload.segment,
        }]);
      });

      socket.on('lpc:result', (payload) => {
        setLastResult(payload);
        setResultHistory((results) => [payload, ...results].slice(0, 10));
      });

      socket.on('lpc:curve-completed', (payload) => {
        setCurvePoints(payload.points.slice(-20));
      });

      socket.on('test:completed', (payload) => {
        setLastResult(payload);
        setResultHistory((results) => [payload, ...results.filter((item) => item.receivedAt !== payload.receivedAt)].slice(0, 10));
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
    if (response.ok) {
      setPortCheck((await response.json()) as LpcPortCheckPayload);
    }
  }

  async function sendMockLine() {
    const response = await fetch('/api/lpc/mock-line', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line: mockLine }),
    });
    setMockLineResponse(JSON.stringify(await response.json()));
  }

  const chartPoints = useMemo(() => {
    const validPoints = curvePoints.filter((point) => point.pressureMbar !== null);
    if (validPoints.length < 2) return '';
    const minX = Math.min(...validPoints.map((point) => point.elapsedTimeSec));
    const maxX = Math.max(...validPoints.map((point) => point.elapsedTimeSec));
    const minY = Math.min(...validPoints.map((point) => point.pressureMbar ?? 0));
    const maxY = Math.max(...validPoints.map((point) => point.pressureMbar ?? 0));
    const xRange = maxX - minX || 1;
    const yRange = maxY - minY || 1;
    return validPoints.map((point) => {
      const x = 30 + ((point.elapsedTimeSec - minX) / xRange) * 520;
      const y = 190 - (((point.pressureMbar ?? 0) - minY) / yRange) * 160;
      return `${x},${y}`;
    }).join(' ');
  }, [curvePoints]);

  const lpcConnectionLabel = (() => {
    if (!lpcStatus) return 'Niepołączony';
    if (lpcStatus.status === 'idle') return 'Niepołączony';
    if (lpcStatus.status === 'connecting') return 'Łączenie...';
    if (lpcStatus.status === 'connected' && lpcStatus.connected) return 'Połączony';
    if (lpcStatus.status === 'reconnecting') return 'Ponawianie połączenia...';
    if (lpcStatus.status === 'error') return 'Błąd połączenia';
    if (lpcStatus.status === 'disconnecting') return 'Rozłączanie...';
    return 'Rozłączony';
  })();

  return (
    <main className="operator-panel">
      <section className={`card status-${status}`}>
        <p className="eyebrow">LPC-528 Operator Panel</p>
        <h1>{status === 'program-selected' && lastAccepted ? `${lastAccepted.currentTest.programText} wybrany` : statusLabels[status]}</h1>

        <section className={`lpc-status-panel lpc-status-${lpcStatus?.status ?? 'idle'}`} aria-label="Status LPC">
          <div>
            <span className="label">LPC</span>
            <strong>{lpcConnectionLabel}</strong>
            <small>{lpcStatus ? `${lpcStatus.host}:${lpcStatus.port}` : 'status...'}</small>
            {lpcStatus?.lastError && <p className="lpc-error">{lpcStatus.lastError}</p>}
            {lpcStatus?.nextReconnectAt && <p className="lpc-meta">Ponowna próba: {lpcStatus.nextReconnectAt}</p>}
            {lpcStatus && <p className="lpc-meta">Reconnect: {lpcStatus.reconnectAttemptCount}</p>}
          </div>
        </section>

        <form className="scan-form" onSubmit={submitScan}>
          <label htmlFor="barcode-input">Barcode</label>
          <input
            id="barcode-input"
            ref={barcodeInputRef}
            autoFocus
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
            placeholder="Zeskanuj lub wpisz barcode"
          />
          <button type="submit" disabled={status === 'scanning'}>
            Wyślij skan
          </button>
        </form>

        {lastAccepted && (
          <section className="details success-details" aria-label="Ostatni zaakceptowany skan">
            <h2>Ostatni skan</h2>
            <dl>
              <div><dt>Barcode</dt><dd>{lastAccepted.currentTest.barcode}</dd></div>
              <div><dt>Matched key</dt><dd>{lastAccepted.currentTest.matchedKey}</dd></div>
              <div><dt>Program</dt><dd>{lastAccepted.currentTest.programText}</dd></div>
              <div><dt>Selected at</dt><dd>{lastAccepted.currentTest.selectedAt}</dd></div>
              <div><dt>Start programu</dt><dd>{lastAccepted.programStart.message}</dd></div>
            </dl>
          </section>
        )}

        {lastRejected && (
          <section className="details error-details" aria-label="Błąd skanu">
            <h2>{lastRejected.error}</h2>
            <p>{lastRejected.message}: {lastRejected.barcode}</p>
          </section>
        )}


        {showDiagnostics && (
        <section className="details diagnostics-details" aria-label="Diagnostyka LPC">
          <h2>Diagnostyka</h2>
          <div className="lpc-actions">
            <button type="button" onClick={() => void lpcAction('connect')}>Połącz</button>
            <button type="button" onClick={() => void lpcAction('disconnect')}>Rozłącz</button>
            <button type="button" onClick={() => void checkLpcPort()}>Sprawdź port LPC</button>
          </div>
          {lpcActionMessage && <p>{lpcActionMessage}</p>}
          {portCheck && (
            <p className={portCheck.reachable ? 'port-ok' : 'port-error'}>
              {portCheck.reachable ? 'Port dostępny' : 'Port niedostępny'} ({portCheck.latencyMs} ms) {portCheck.error ?? ''}
            </p>
          )}
          <textarea
            value={mockLine}
            onChange={(event) => setMockLine(event.target.value)}
            placeholder="Wklej raw LPC line do testu UI bez realnego LPC"
          />
          <button type="button" onClick={() => void sendMockLine()}>Wyślij mock line</button>
          {mockLineResponse && <p>{mockLineResponse}</p>}
        </section>
        )}

        {lastStream && (
          <section className="details live-details" aria-label="Live streaming LPC">
            <h2>Live test</h2>
            <dl>
              <div><dt>Program</dt><dd>{lastAccepted?.currentTest.programText ?? lastStream.program}</dd></div>
              <div><dt>Barcode</dt><dd>{lastAccepted?.currentTest.barcode ?? '-'}</dd></div>
              <div><dt>Elapsed</dt><dd>{lastStream.elapsedTimeSec?.toFixed(2)} s</dd></div>
              <div><dt>Remaining</dt><dd>{lastStream.remainingTimeSec?.toFixed(2)} s</dd></div>
              <div><dt>Pressure bar</dt><dd>{lastStream.pressureValue} {lastStream.pressureUnit}</dd></div>
              <div><dt>Pressure mbar</dt><dd>{lastStream.pressureMbar?.toFixed(3)} mbar</dd></div>
              <div><dt>Segment</dt><dd>{lastStream.segment}</dd></div>
            </dl>
          </section>
        )}

        {lastResult && (
          <section className={`details result-details result-${lastResult.result.toLowerCase()}`} aria-label="Ostatni wynik LPC">
            <h2>{lastResult.result === 'ACCEPT' ? 'OK' : lastResult.result === 'REJECT' ? 'NOK' : lastResult.result}</h2>
            <dl>
              <div><dt>Barcode</dt><dd>{lastResult.barcode}</dd></div>
              <div><dt>Program</dt><dd>{lastResult.programText}</dd></div>
              <div><dt>Current test</dt><dd>{lastResult.currentTestValid ? 'valid' : 'not linked'}</dd></div>
              <div><dt>TotalAbs / UID</dt><dd>{lastResult.totalAbs} / {lastResult.uniqueId}</dd></div>
              <div><dt>Date / Time</dt><dd>{lastResult.testerDate} {lastResult.testerTime}</dd></div>
              <div><dt>Main leak</dt><dd>{lastResult.leakType} {lastResult.leakValue} {lastResult.leakUnit}</dd></div>
              {measurementKeys.map((key) => {
                const value = lastResult[key];
                const unit = lastResult[`${key}_unit` as keyof EnrichedLpcResult];
                return value === null || value === undefined ? null : (
                  <div key={key}><dt>{key}</dt><dd>{String(value)} {String(unit ?? '')}</dd></div>
                );
              })}
            </dl>
          </section>
        )}

        <section className="details curve-details" aria-label="Wykres ciśnienia">
          <h2>Wykres ciśnienia</h2>
          <svg className="pressure-chart" viewBox="0 0 600 230" role="img" aria-label="Ciśnienie w czasie">
            <line x1="30" y1="195" x2="570" y2="195" />
            <line x1="30" y1="20" x2="30" y2="195" />
            {chartPoints && <polyline points={chartPoints} />}
            <text x="250" y="225">Czas [s]</text>
            <text x="40" y="18">Ciśnienie [mbar]</text>
          </svg>
          <div className="curve-list">
            {curvePoints.slice(-6).map((point) => (
              <span key={`${point.elapsedTimeSec}-${point.segment}`}>{point.elapsedTimeSec.toFixed(2)}s / {point.pressureMbar?.toFixed(2)} mbar</span>
            ))}
          </div>
        </section>

        {resultHistory.length > 0 && (
          <section className="details history-details" aria-label="Ostatnie wyniki">
            <h2>Ostatnie wyniki</h2>
            <table>
              <tbody>
                {resultHistory.slice(0, 10).map((result) => (
                  <tr key={`${result.receivedAt}-${result.uniqueId}`}>
                    <td>{result.receivedAt}</td>
                    <td>{result.barcode}</td>
                    <td>{result.programText}</td>
                    <td>{result.result}</td>
                    <td>{result.leakValue} {result.leakUnit}</td>
                    <td>{result.totalAbs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />);
