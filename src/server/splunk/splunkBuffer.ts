import type { AppDatabase } from '../db/database';
import { isSplunkConfigured } from './splunkConfig';
import type { SplunkClient } from './splunkClient';
import type { SplunkHecEnvelope, SplunkRuntimeConfig } from './splunkTypes';

export class SplunkBuffer {
  private retryHandle: NodeJS.Timeout | null = null;
  private retryRunning = false;

  constructor(
    private readonly database: AppDatabase,
    private readonly client: SplunkClient,
    private readonly config: SplunkRuntimeConfig,
  ) {}

  async sendOrQueue(envelope: SplunkHecEnvelope): Promise<void> {
    if (!this.config.enabled) return;
    const event = envelope.event;
    const testId = typeof event.testId === 'string' ? event.testId : null;
    const pointCount = typeof event.curve === 'object' && event.curve !== null && 'pointCount' in event.curve ? String((event.curve as { pointCount?: unknown }).pointCount) : '0';
    console.log(`[SPLUNK] send result testId=${testId ?? ''} barcode=${String(event.barcode ?? '')} pointCount=${pointCount}`);

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
    console.warn(`[SPLUNK_BUFFER] queued id=${id} testId=${testId ?? ''}`);
  }

  start(): void {
    if (!this.config.enabled || !this.config.bufferEnabled) return;
    void this.retryPending();
    this.retryHandle = setInterval(() => void this.retryPending(), this.config.bufferRetryIntervalMs);
  }

  stop(): void {
    if (this.retryHandle) clearInterval(this.retryHandle);
    this.retryHandle = null;
  }

  async retryPending(): Promise<{ attempted: number; sent: number; failed: number }> {
    if (this.retryRunning || !this.config.enabled || !this.config.bufferEnabled || !isSplunkConfigured(this.config)) return { attempted: 0, sent: 0, failed: 0 };
    this.retryRunning = true;
    let attempted = 0;
    let sent = 0;
    let failed = 0;
    try {
      const pending = this.database.listPendingSplunkEvents(25);
      console.log(`[SPLUNK_BUFFER] retry started pending=${pending.length}`);
      for (const record of pending) {
        if (!this.database.markSplunkEventSending(record.id)) continue;
        attempted += 1;
        const result = await this.client.send(JSON.parse(record.payloadJson) as SplunkHecEnvelope);
        if (result.ok) {
          this.database.markSplunkEventSent(record.id);
          sent += 1;
          console.log(`[SPLUNK_BUFFER] sent id=${record.id}`);
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
    return this.database.getSplunkBufferStats();
  }

  private nextAttemptAt(): string {
    return new Date(Date.now() + this.config.bufferRetryIntervalMs).toISOString();
  }
}
