import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanSplunkJsonPayload, createSplunkRequestOptions, normalizeSplunkHecUrl, SplunkClient } from './splunkClient';
import type { SplunkHecEnvelope, SplunkRuntimeConfig } from './splunkTypes';

const envelope: SplunkHecEnvelope = { time: 1710000000.123, index: 'machinedata_w16', source: 'LPC-528-01', sourcetype: '_json', event: { eventType: 'lpc_test_result' } };
const baseConfig: SplunkRuntimeConfig = { enabled: true, url: 'http://127.0.0.1/services/collector', token: 'token-for-test', index: 'machinedata_w16', source: 'LPC-528-01', sourcetype: '_json', site: 'W16', line: 'PWT', workplace: 'LPC-528-01', device: 'LPC-528-01', timeoutMs: 1000, verifyTls: true, sendResult: true, sendCurve: true, bufferEnabled: true, bufferRetryIntervalMs: 30000, bufferMaxAttempts: 0, streamPointsMode: 'full', streamPointsMax: 5000, includeRawStream: false, rawStreamMax: 1000 };
const servers: http.Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

function listen(handler: http.RequestListener): Promise<{ url: string; requests: { url?: string; body: unknown; authorization?: string }[] }> {
  const requests: { url?: string; body: unknown; authorization?: string }[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      requests.push({ url: req.url, authorization: req.headers.authorization, body: JSON.parse(raw) as unknown });
      handler(req, res);
    });
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'object' && address) resolve({ url: `http://127.0.0.1:${address.port}`, requests });
    });
  });
}

describe('SplunkClient', () => {
  it('cleans JSON payload diacritics and invisible whitespace while keeping valid JSON', () => {
    const raw = JSON.stringify({ message: 'Zażółć\tgęślą\njaźń Łódź', value: 11.686662 });
    const cleaned = cleanSplunkJsonPayload(raw);
    expect(cleaned).not.toMatch(/[ąćęłńóśżźŁ\t\r\n]/);
    expect(JSON.parse(cleaned)).toMatchObject({ message: 'Zazolc gesla jazn Lodz', value: 11.686662 });
  });

  it('normalizes HEC event endpoint', () => {
    expect(normalizeSplunkHecUrl('https://splunk:8088/services/collector')).toBe('https://splunk:8088/services/collector/event');
    expect(normalizeSplunkHecUrl('https://splunk:8088/services/collector/event')).toBe('https://splunk:8088/services/collector/event');
    expect(normalizeSplunkHecUrl('https://splunk:8088/services/collector/')).toBe('https://splunk:8088/services/collector/event');
  });

  it('uses a local TLS agent with rejectUnauthorized=false when SPLUNK_VERIFY_TLS=false', () => {
    const options = createSplunkRequestOptions({ ...baseConfig, url: 'https://splunk.example.local:8088/services/collector', verifyTls: false }, JSON.stringify(envelope));
    expect(options.agent).toBeTruthy();
    expect((options.agent as { options?: { rejectUnauthorized?: boolean } }).options?.rejectUnauthorized).toBe(false);
    expect(options.path).toBe('/services/collector/event');
  });

  it('sends a single HEC envelope JSON body to /services/collector/event', async () => {
    const server = await listen((_req, res) => res.end('{"text":"Success","code":0}'));
    const client = new SplunkClient({ ...baseConfig, url: `${server.url}/services/collector` });
    const result = await client.send(envelope);
    expect(result).toMatchObject({ ok: true, status: 200, code: 0 });
    expect(server.requests[0]).toMatchObject({ url: '/services/collector/event', authorization: 'Splunk token-for-test', body: { index: 'machinedata_w16', source: 'LPC-528-01', sourcetype: '_json', event: { eventType: 'lpc_test_result' } } });
  });



  it('treats HTTP 200 with Splunk authorization code as an error', async () => {
    const server = await listen((_req, res) => res.end('{"text":"Invalid authorization","code":3}'));
    const client = new SplunkClient({ ...baseConfig, url: `${server.url}/services/collector/event` });
    const result = await client.send(envelope);
    expect(result).toMatchObject({ ok: false, status: 200, code: 3 });
    expect(result.error).toContain('Invalid authorization');
  });

  it('treats HTTP 401 as an error', async () => {
    const server = await listen((_req, res) => { res.statusCode = 401; res.end('{"text":"Unauthorized","code":3}'); });
    const client = new SplunkClient({ ...baseConfig, url: `${server.url}/services/collector/event` });
    const result = await client.send(envelope);
    expect(result).toMatchObject({ ok: false, status: 401, code: 3 });
  });

  it('treats HTTP 200 with Splunk code != 0 as an error', async () => {
    const server = await listen((_req, res) => res.end('{"text":"Invalid data format","code":6}'));
    const client = new SplunkClient({ ...baseConfig, url: `${server.url}/services/collector/event` });
    const result = await client.send(envelope);
    expect(result).toMatchObject({ ok: false, status: 200, code: 6 });
    expect(result.error).toContain('Invalid data format');
  });
});
