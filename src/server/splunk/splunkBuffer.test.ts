import { describe, expect, it } from 'vitest';
import { AppDatabase } from '../db/database';
import { SplunkBuffer } from './splunkBuffer';
import type { SplunkClient } from './splunkClient';
import type { SplunkHecEnvelope, SplunkRuntimeConfig, SplunkSendResult } from './splunkTypes';

const envelope: SplunkHecEnvelope = { time: 1, index: 'i', source: 's', sourcetype: '_json', event: { eventType: 'lpc_test_result', testId: 't1', barcode: 'b', curve: { pointCount: 0 } } };
function config(patch: Partial<SplunkRuntimeConfig> = {}): SplunkRuntimeConfig {
  return { enabled: true, url: 'https://splunk.example.local:8088/services/collector', token: 'token-for-test', index: 'i', source: 's', sourcetype: '_json', site: 'W16', line: 'PWT', workplace: 'LPC-528-01', device: 'LPC-528-01', timeoutMs: 1, verifyTls: true, sendResult: true, sendCurve: true, bufferEnabled: true, bufferRetryIntervalMs: 1, bufferMaxAttempts: 0, ...patch };
}
function client(result: SplunkSendResult): SplunkClient {
  return { send: async () => result, getStatus: () => ({ enabled: true, configured: true, urlConfigured: true, tokenConfigured: true, index: 'i', source: 's', sourcetype: '_json' }) } as unknown as SplunkClient;
}

describe('SplunkBuffer', () => {
  it('does nothing when Splunk is disabled', async () => {
    const db = new AppDatabase(':memory:');
    const buffer = new SplunkBuffer(db, client({ ok: false, error: 'should not send' }), config({ enabled: false }));
    await buffer.sendOrQueue(envelope);
    expect(db.getSplunkBufferStats().pending).toBe(0);
  });

  it('does not buffer successful HTTP 200 sends', async () => {
    const db = new AppDatabase(':memory:');
    const buffer = new SplunkBuffer(db, client({ ok: true, status: 200 }), config());
    await buffer.sendOrQueue(envelope);
    expect(db.getSplunkBufferStats().pending).toBe(0);
  });

  it('queues timeout or network errors', async () => {
    const db = new AppDatabase(':memory:');
    const buffer = new SplunkBuffer(db, client({ ok: false, error: 'timeout' }), config());
    await buffer.sendOrQueue(envelope);
    expect(db.getSplunkBufferStats()).toMatchObject({ pending: 1, lastError: 'timeout' });
  });

  it('marks pending event sent after successful retry', async () => {
    const db = new AppDatabase(':memory:');
    db.enqueueSplunkEvent({ eventType: 'lpc_test_result', testId: 't1', payloadJson: JSON.stringify(envelope) });
    const buffer = new SplunkBuffer(db, client({ ok: true, status: 200 }), config());
    await buffer.retryPending();
    expect(db.getSplunkBufferStats()).toMatchObject({ pending: 0, sent: 1 });
  });

  it('keeps missing token failures non-crashing and pending when initially queued', async () => {
    const db = new AppDatabase(':memory:');
    const buffer = new SplunkBuffer(db, client({ ok: false, error: 'Splunk HEC URL or token is not configured' }), config({ token: '' }));
    await buffer.sendOrQueue(envelope);
    expect(db.getSplunkBufferStats()).toMatchObject({ pending: 1, lastError: 'Splunk HEC URL or token is not configured' });
  });
});
