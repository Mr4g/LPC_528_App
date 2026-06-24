import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { io } from 'socket.io-client';
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

type OperatorStatus = 'ready' | 'scanning' | 'program-selected' | 'no-mapping' | 'start-error';

const statusLabels: Record<OperatorStatus, string> = {
  ready: 'Gotowy do skanu',
  scanning: 'Skanuję...',
  'program-selected': 'Program wybrany',
  'no-mapping': 'Brak mapowania dla barcode',
  'start-error': 'Błąd startu programu',
};

function App() {
  const [barcode, setBarcode] = useState('');
  const [status, setStatus] = useState<OperatorStatus>('ready');
  const [lastAccepted, setLastAccepted] = useState<ScanAcceptedPayload | null>(null);
  const [lastRejected, setLastRejected] = useState<ScanRejectedPayload | null>(null);

  const socket = useMemo(() => io(), []);

  useEffect(() => {
    socket.on('scan:accepted', (payload: ScanAcceptedPayload) => {
      setLastAccepted(payload);
      setLastRejected(null);
      setStatus(payload.programStart.success ? 'program-selected' : 'start-error');
    });

    socket.on('scan:rejected', (payload: ScanRejectedPayload) => {
      setLastRejected(payload);
      setStatus('no-mapping');
    });

    return () => {
      socket.off('scan:accepted');
      socket.off('scan:rejected');
      socket.disconnect();
    };
  }, [socket]);

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
