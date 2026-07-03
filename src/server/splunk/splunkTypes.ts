import type { AppConfig } from '../../config';
import type { EnrichedLpcResult } from '../../lpc/LpcLineProcessor';
import type { LpcCurvePoint } from '../../lpc/LpcTestCurveBuffer';
import type { TestSessionState } from '../test-session/testSessionManager';

export type SplunkBufferStatus = 'pending' | 'sending' | 'sent' | 'failed';

export interface SplunkEventBufferRecord {
  id: number;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: string | null;
  sentAt: string | null;
  attempts: number;
  lastError: string | null;
  status: SplunkBufferStatus;
  eventType: string;
  testId: string | null;
  payloadJson: string;
}

export interface SplunkHecEnvelope {
  time: number;
  index: string;
  source: string;
  sourcetype: string;
  event: Record<string, unknown>;
  fields?: Record<string, string>;
}

export interface SplunkSendResult {
  ok: boolean;
  status?: number;
  durationMs?: number;
  code?: number;
  error?: string;
  skipped?: boolean;
}

export type LastSplunkStatus = 'sent' | 'buffered' | 'failed' | 'disabled' | 'not_configured';

export interface SplunkRuntimeConfig {
  enabled: boolean;
  url: string;
  token: string;
  index: string;
  source: string;
  sourcetype: string;
  site: string | null;
  line: string | null;
  workplace: string;
  device: string;
  timeoutMs: number;
  verifyTls: boolean;
  sendResult: boolean;
  sendCurve: boolean;
  bufferEnabled: boolean;
  bufferRetryIntervalMs: number;
  bufferMaxAttempts: number;
}

export interface SplunkResultContext {
  result: EnrichedLpcResult;
  session: TestSessionState | null;
  curvePoints: LpcCurvePoint[];
  config: Pick<AppConfig, 'LPC_HOST' | 'LPC_PORT' | 'LPC_INTERFACE_SELECTION' | 'LPC_RESULT_FRAME_FORMAT' | 'LPC_RESULT_OK_CODES' | 'LPC_RESULT_NOK_CODES'>;
}

export interface SplunkErrorContext {
  session: TestSessionState;
  reason: string;
  message: string | null;
  curvePoints: LpcCurvePoint[];
  config: Pick<AppConfig, 'LPC_HOST' | 'LPC_PORT' | 'LPC_INTERFACE_SELECTION' | 'LPC_RESULT_FRAME_FORMAT' | 'LPC_RESULT_OK_CODES' | 'LPC_RESULT_NOK_CODES'>;
}
