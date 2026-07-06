import type { AppDatabase } from '../db/database';
import { isSplunkConfigured } from './splunkConfig';
import type { SplunkClient } from './splunkClient';
import type { SplunkHecEnvelope, SplunkRuntimeConfig } from './splunkTypes';

export class SplunkBuffer {
  private retryHandle: NodeJS.Timeout | null = null;
  private retryRunning = false;
  private workerEnabled = false;
  private lastRetryAt: string | null = null;
  private nextRetryAt: string | null = null;

  constructor(
    private readonly database: AppDatabase,
    private readonly client: SplunkClient,
    private readonly config: SplunkRuntimeConfig,
  ) {}

  async sendOrQueue(envelope: SplunkHecEnvelope): Promise<void> {
    if (!this.config.enabled) return;
    const event = envelope.event;
    const testId = typeof event.testId === 'string' ? event.testId : null;
    const pointCount = typeof event.curve === 'object' && event.curve !== null && 'pointCount' in event.curve ? String((event.curve as { pointCount?: unknown }).pointCount) : String(event.curvePointCount ?? 0);
    const dptPointCount = typeof event.curve === 'object' && event.curve !== null && 'dptPointCount' in event.curve ? String((event.curve as { dptPointCount?: unknown }).dptPointCount) : '0';
    console.log(`[SPLUNK] sending nested payload testId=${testId ?? ''} pointCount=${pointCount} dptPointCount=${dptPointCount}`);

    const result = await this.client.send(envelope);
    if (result.ok) return;
    if (!this.config.bufferEnabled) return;
    const id = this.database.enqueueSplunkEvent({
      eventType: String(event.eventType ?? 'lpc_test_result'),
      testId,
      payloadJson: JSON.stringify(envelope),
      lastError: result.error ?? 'Splunk send failed',
      nextAttemptAt: this.nextAttemptAt(),
    });
    this.client.setLastStatus?.('buffered', result.code ?? null, result.error ?? 'Splunk send queued');
    console.warn(`[SPLUNK_BUFFER] queued id=${id} testId=${testId ?? ''}`);
  }

  start(): void {
    if (!this.config.enabled || !this.config.bufferEnabled) {
      this.workerEnabled = false;
      console.info('[SPLUNK_BUFFER] worker disabled');
      return;
    }
    this.workerEnabled = true;
    this.nextRetryAt = new Date(Date.now() + this.config.bufferRetryIntervalMs).toISOString();
    console.info(`[SPLUNK_BUFFER] worker enabled intervalMs=${this.config.bufferRetryIntervalMs} maxAttempts=${this.config.bufferMaxAttempts}`);
    void this.retryPending();
    this.retryHandle = setInterval(() => void this.retryPending(), this.config.bufferRetryIntervalMs);
  }

  stop(): void {
    if (this.retryHandle) clearInterval(this.retryHandle);
    this.retryHandle = null;
    this.workerEnabled = false;
  }

  async retryPending(): Promise<{ attempted: number; sent: number; failed: number }> {
    if (this.retryRunning || !this.config.enabled || !this.config.bufferEnabled) return { attempted: 0, sent: 0, failed: 0 };
    this.lastRetryAt = new Date().toISOString();
    this.nextRetryAt = new Date(Date.now() + this.config.bufferRetryIntervalMs).toISOString();
    if (!isSplunkConfigured(this.config)) {
      const pending = this.database.getSplunkBufferStats().pending;
      console.warn(`[SPLUNK_BUFFER] retry tick pending=${pending} error=Splunk not configured`);
      return { attempted: 0, sent: 0, failed: pending };
    }
    this.retryRunning = true;
    let attempted = 0;
    let sent = 0;
    let failed = 0;
    try {
      const pending = this.database.listPendingSplunkEvents(25);
      console.log(`[SPLUNK_BUFFER] retry tick pending=${pending.length}`);
      for (const record of pending) {
        if (!this.database.markSplunkEventSending(record.id)) continue;
        attempted += 1;
        console.log(`[SPLUNK_BUFFER] retry sending id=${record.id} attempts=${record.attempts}`);
        const result = await this.client.send(JSON.parse(record.payloadJson) as SplunkHecEnvelope);
        if (result.ok) {
          this.database.markSplunkEventSent(record.id);
          sent += 1;
          console.log(`[SPLUNK_BUFFER] sent id=${record.id} status=sent`);
        } else {
          failed += 1;
          const error = result.error ?? 'Splunk retry failed';
          this.database.markSplunkEventFailed(record.id, error, this.nextAttemptAt(), this.config.bufferMaxAttempts);
          console.warn(`[SPLUNK_BUFFER] failed id=${record.id} attempts=${record.attempts + 1} error=${error}`);
        }
      }
      return { attempted, sent, failed };
    } finally {
      this.retryRunning = false;
    }
  }

  getStatus() {
    return {
      ...this.database.getSplunkBufferStats(),
      bufferEnabled: this.config.bufferEnabled,
      bufferWorkerEnabled: this.workerEnabled,
      retryIntervalMs: this.config.bufferRetryIntervalMs,
      lastRetryAt: this.lastRetryAt,
      nextRetryAt: this.nextRetryAt,
    };
  }

  private nextAttemptAt(): string {
    return new Date(Date.now() + this.config.bufferRetryIntervalMs).toISOString();
  }
}
