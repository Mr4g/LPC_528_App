import React, { FormEvent, useEffect, useState } from 'react';
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

interface LpcStatusPayload {
  ok: true;
  connected: boolean;
  state: string;
  host: string;
  port: number;
  autoConnect: boolean;
  reconnectEnabled: boolean;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastError: string | null;
  lastRawLinesCount: number;
  curvePointCount: number;
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
  on(event: 'lpc:connected', handler: SocketHandler<unknown>): void;
  on(event: 'lpc:disconnected', handler: SocketHandler<unknown>): void;
  on(event: 'lpc:error', handler: SocketHandler<{ message: string }>): void;
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
  ready: 'Gotowy do skanu',
  scanning: 'Skanuję...',
  'program-selected': 'Program wybrany',
  'no-mapping': 'Brak mapowania dla barcode',
  'start-error': 'Błąd startu programu',
};

const measurementKeys = ['RL', 'Pt', 'EDC', 'PL', 'LLR', 'HLR', 'FPR'] as const;

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
  const [curvePoints, setCurvePoints] = useState<LpcCurvePoint[]>([]);
  const [lpcActionMessage, setLpcActionMessage] = useState<string | null>(null);

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

      socket.on('lpc:connected', () => {
        void refreshLpcStatus();
      });

      socket.on('lpc:disconnected', () => {
        void refreshLpcStatus();
      });

      socket.on('lpc:error', (payload) => {
        setLpcActionMessage(payload.message);
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
      });

      socket.on('lpc:curve-completed', (payload) => {
        setCurvePoints(payload.points.slice(-20));
      });

      socket.on('test:completed', (payload) => {
        setLastResult(payload);
      });
    });

    return () => {
      isMounted = false;
      activeSocket?.off('scan:accepted');
      activeSocket?.off('scan:rejected');
      activeSocket?.off('lpc:connected');
      activeSocket?.off('lpc:disconnected');
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
  }

  async function lpcAction(action: 'connect' | 'disconnect') {
    setLpcActionMessage(null);
    const response = await fetch(`/api/lpc/${action}`, { method: 'POST' });
    setLpcActionMessage(response.ok ? `LPC ${action} wysłane` : `LPC ${action} błąd`);
    await refreshLpcStatus();
  }

  const lpcConnectionLabel = lpcStatus?.connected ? 'Połączony' : lpcStatus?.lastError ? 'Błąd' : 'Rozłączony';

  return (
    <main className="operator-panel">
      <section className={`card status-${status}`}>
        <p className="eyebrow">LPC-528 Operator Panel</p>
        <h1>{status === 'program-selected' && lastAccepted ? `${lastAccepted.currentTest.programText} wybrany` : statusLabels[status]}</h1>

        <section className="lpc-status-panel" aria-label="Status LPC">
          <div>
            <span className="label">LPC</span>
            <strong>{lpcConnectionLabel}</strong>
            <small>{lpcStatus ? `${lpcStatus.host}:${lpcStatus.port}` : 'status...'}</small>
          </div>
          <div className="lpc-actions">
            <button type="button" onClick={() => void lpcAction('connect')}>Połącz</button>
            <button type="button" onClick={() => void lpcAction('disconnect')}>Rozłącz</button>
          </div>
          {lpcActionMessage && <p>{lpcActionMessage}</p>}
        </section>

        <form className="scan-form" onSubmit={submitScan}>
          <label htmlFor="barcode-input">Barcode</label>
          <input
            id="barcode-input"
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

        {lastStream && (
          <section className="details live-details" aria-label="Live streaming LPC">
            <h2>Live pressure</h2>
            <dl>
              <div><dt>Elapsed</dt><dd>{lastStream.elapsedTimeSec?.toFixed(2)} s</dd></div>
              <div><dt>Remaining</dt><dd>{lastStream.remainingTimeSec?.toFixed(2)} s</dd></div>
              <div><dt>Pressure</dt><dd>{lastStream.pressureValue} {lastStream.pressureUnit}</dd></div>
              <div><dt>Pressure mbar</dt><dd>{lastStream.pressureMbar?.toFixed(3)} mbar</dd></div>
              <div><dt>Segment</dt><dd>{lastStream.segment}</dd></div>
            </dl>
          </section>
        )}

        {lastResult && (
          <section className={`details result-details result-${lastResult.result.toLowerCase()}`} aria-label="Ostatni wynik LPC">
            <h2>{lastResult.result}</h2>
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

        <section className="details curve-details" aria-label="Miejsce na wykres ciśnienia">
          <h2>Krzywa ciśnienia</h2>
          <p>Placeholder wykresu — ostatnie punkty:</p>
          <div className="curve-list">
            {curvePoints.slice(-8).map((point) => (
              <span key={`${point.elapsedTimeSec}-${point.segment}`}>{point.elapsedTimeSec.toFixed(2)}s / {point.pressureMbar?.toFixed(2)} mbar</span>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />);
