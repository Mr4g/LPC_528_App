import type { LpcResult } from '../../shared/types';
import { formatMeasurement, formatNumber, getResultClass, getResultDisplayLabel } from '../formatters';

function getResultLabel(result: LpcResult): string {
  if (result.result === 'UNKNOWN' && result.resultRawStatus) return `Wynik LPC: ${result.resultRawStatus}`;
  return getResultDisplayLabel(result.result);
}


const measurementKeys = ['RL', 'Pt', 'EDC', 'PL', 'LLR', 'HLR', 'FPR'] as const;

export function LastResultPanel({ result }: { result: LpcResult | null }) {
  return (
    <section className="last-result-panel">
      <div className={`result-status ${result ? getResultClass(result.result) : 'status-unknown'}`}>
        <span>Ostatni wynik</span>
        <strong>{result ? getResultLabel(result) : '-'}</strong>
      </div>
      {result ? (
        <div className="result-data-grid">
          <div className="main-measurement"><span>Główny pomiar</span><strong>{result.leakType} {formatMeasurement(result.leakValue, result.leakUnit)}</strong></div>
          <div><span>Barcode</span><strong>{result.barcode}</strong></div>
          <div><span>Program</span><strong>{result.programText}</strong></div>
          <div><span>TotalAbs / ID</span><strong>{result.totalAbs} / {result.uniqueId}</strong></div>
          <div><span>Data / czas</span><strong>{result.testerDate} {result.testerTime}</strong></div>
          {measurementKeys.map((key) => {
            const value = result[key];
            const unit = result[`${key}_unit` as keyof LpcResult];
            return value === null || value === undefined ? null : (
              <div key={key}><span>{key}</span><strong>{formatNumber(Number(value), 6)} {String(unit ?? '')}</strong></div>
            );
          })}
        </div>
      ) : (
        <p className="empty-state">Brak końcowego wyniku testu</p>
      )}
    </section>
  );
}
