import http from 'node:http';
import https from 'node:https';
import type { SplunkHecEnvelope, SplunkRuntimeConfig, SplunkSendResult } from './splunkTypes';
import { isSplunkConfigured } from './splunkConfig';

export class SplunkClient {
  constructor(private readonly config: SplunkRuntimeConfig) {}

  getStatus() {
    return {
      enabled: this.config.enabled,
      configured: isSplunkConfigured(this.config),
      urlConfigured: Boolean(this.config.url),
      tokenConfigured: Boolean(this.config.token),
      index: this.config.index,
      source: this.config.source,
      sourcetype: this.config.sourcetype,
    };
  }

  async send(envelope: SplunkHecEnvelope): Promise<SplunkSendResult> {
    if (!this.config.enabled) return { ok: true, skipped: true };
    if (!isSplunkConfigured(this.config)) return { ok: false, error: 'Splunk HEC URL or token is not configured' };

    const started = Date.now();
    const body = JSON.stringify(envelope);
    return new Promise<SplunkSendResult>((resolve) => {
      const url = new URL(this.config.url);
      const transport = url.protocol === 'http:' ? http : https;
      const request = transport.request({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        timeout: this.config.timeoutMs,
        rejectUnauthorized: url.protocol === 'https:' ? this.config.verifyTls : undefined,
        headers: {
          Authorization: `Splunk ${this.config.token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (response) => {
        response.resume();
        response.on('end', () => {
          const durationMs = Date.now() - started;
          const status = response.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            console.log(`[SPLUNK] sent status=${status} durationMs=${durationMs}`);
            resolve({ ok: true, status, durationMs });
            return;
          }
          const error = `HTTP ${status}`;
          console.warn(`[SPLUNK] failed status=${status} error=${error}`);
          resolve({ ok: false, status, durationMs, error });
        });
      });

      request.on('timeout', () => request.destroy(new Error(`Splunk HEC timeout after ${this.config.timeoutMs}ms`)));
      request.on('error', (error) => {
        const message = error.message;
        console.warn(`[SPLUNK] failed status=network error=${message}`);
        resolve({ ok: false, durationMs: Date.now() - started, error: message });
      });
      request.write(body);
      request.end();
    });
  }
}
