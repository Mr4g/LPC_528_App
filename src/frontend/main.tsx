import React, { FormEvent, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { BarcodeScan, CurrentTest, ProgramStartRequest, ProgramStartResult } from '../shared/types';
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

type SocketHandler<TPayload> = (payload: TPayload) => void;

interface SocketLike {
  on(event: 'scan:accepted', handler: SocketHandler<ScanAcceptedPayload>): void;
  on(event: 'scan:rejected', handler: SocketHandler<ScanRejectedPayload>): void;
  off(event: 'scan:accepted'): void;
  off(event: 'scan:rejected'): void;
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

function App() {
  const [barcode, setBarcode] = useState('');
  const [status, setStatus] = useState<OperatorStatus>('ready');
  const [lastAccepted, setLastAccepted] = useState<ScanAcceptedPayload | null>(null);
  const [lastRejected, setLastRejected] = useState<ScanRejectedPayload | null>(null);

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
    });

    return () => {
      isMounted = false;
      activeSocket?.off('scan:accepted');
      activeSocket?.off('scan:rejected');
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

  return (
    <main className="operator-panel">
      <section className={`card status-${status}`}>
        <p className="eyebrow">LPC-528 Operator Panel</p>
        <h1>{status === 'program-selected' && lastAccepted ? `${lastAccepted.currentTest.programText} wybrany` : statusLabels[status]}</h1>

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
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />);
