import type { LpcResult } from '../../shared/types';
import { formatMeasurement, getResultClass, getResultDisplayLabel } from '../formatters';

function getResultLabel(result: LpcResult): string {
  if (result.result === 'UNKNOWN' && result.resultRawStatus) return `Nieznany wynik LPC: ${result.resultRawStatus}`;
  return getResultDisplayLabel(result.result);
}

function getMainMeasurement(result: LpcResult): string {
  const measurementName = result.leakType ?? (result.RL !== null && result.RL !== undefined ? 'RL' : '');
  const value = result.leakValue ?? result.RL;
  const unit = result.leakUnit ?? result.RL_unit;
  return `${measurementName} ${formatMeasurement(value, unit, 3)}`.trim();
}

function getTotalAbsId(result: LpcResult): string {
  if (result.totalAbs && result.uniqueId) return `${result.totalAbs} / ${result.uniqueId}`;
  return result.uniqueId ?? result.totalAbs ?? '-';
}

export function LastResultPanel({ result }: { result: LpcResult | null }) {
  return (
    <section className="last-result-panel">
      <div className={`result-status ${result ? getResultClass(result.result) : 'status-unknown'}`}>
        <span>Ostatni wynik</span>
        <strong>{result ? getResultLabel(result) : '-'}</strong>
      </div>
      {result ? (
        <div className="result-data-grid compact-result-data">
          <div className="main-measurement"><span>Główny pomiar</span><strong>{getMainMeasurement(result)}</strong></div>
          <div><span>Barcode</span><strong>{result.barcode || '-'}</strong></div>
          <div><span>Program</span><strong>{result.programText ?? result.program ?? '-'}</strong></div>
          <div><span>TotalAbs / ID</span><strong>{getTotalAbsId(result)}</strong></div>
          <div><span>Data / czas</span><strong>{result.testerDate ?? '-'} {result.testerTime ?? ''}</strong></div>
        </div>
      ) : (
        <p className="empty-state">Brak końcowego wyniku testu</p>
      )}
    </section>
  );
}
