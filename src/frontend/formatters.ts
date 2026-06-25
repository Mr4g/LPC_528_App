import type { LpcResultValue } from '../shared/types';

type LpcConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | 'reconnecting' | 'error';

export function formatResultLabel(result?: LpcResultValue | null): string {
  if (result === 'ACCEPT') return 'OK';
  if (result === 'REJECT') return 'NOK';
  if (result === 'ERROR') return 'ERROR';
  return 'UNKNOWN';
}

export const getResultDisplayLabel = formatResultLabel;

export function getResultClass(result?: LpcResultValue | null): string {
  if (result === 'ACCEPT') return 'status-ok';
  if (result === 'REJECT') return 'status-nok';
  if (result === 'ERROR') return 'status-error';
  return 'status-unknown';
}

export const getResultBadgeClass = getResultClass;

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return value.toFixed(digits);
}

export function formatMeasurement(value: number | null | undefined, unit: string | null | undefined, digits = 2): string {
  const formattedValue = formatNumber(value, digits);
  if (formattedValue === '-') return '-';
  return `${formattedValue} ${unit ?? ''}`.trim();
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function getConnectionLabel(status: LpcConnectionStatus | null | undefined, connected = false): string {
  if (status === 'connected' && connected) return 'Połączony';
  if (status === 'connecting') return 'Łączenie...';
  if (status === 'reconnecting') return 'Ponawianie połączenia...';
  if (status === 'error') return 'Błąd połączenia';
  if (status === 'disconnecting') return 'Rozłączanie...';
  if (status === 'disconnected') return 'Rozłączony';
  return 'Niepołączony';
}
