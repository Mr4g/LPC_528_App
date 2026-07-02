import http from 'node:http';
import https from 'node:https';
import type { SplunkHecEnvelope, SplunkRuntimeConfig, SplunkSendResult } from './splunkTypes';
import { isSplunkConfigured } from './splunkConfig';

export function normalizeSplunkHecUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/services/collector/event')) return trimmed;
  if (trimmed.endsWith('/services/collector')) return `${trimmed}/event`;
  return trimmed;
}

export function createSplunkRequestOptions(config: SplunkRuntimeConfig, body: string): http.RequestOptions | https.RequestOptions {
  const normalizedUrl = normalizeSplunkHecUrl(config.url);
  const url = new URL(normalizedUrl);
  const isHttps = url.protocol === 'https:';
  return {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port,
    path: `${url.pathname}${url.search}`,
    method: 'POST',
    timeout: config.timeoutMs,
    agent: isHttps ? new https.Agent({ rejectUnauthorized: config.verifyTls }) : undefined,
    headers: {
      Authorization: `Splunk ${config.token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  };
}

function parseSplunkResponse(body: string): { code?: number; text?: string } | null {
  if (!body.trim()) return null;
  try {
    return JSON.parse(body) as { code?: number; text?: string };
  } catch {
    return null;
  }
}

export class SplunkClient {
  private readonly normalizedUrl: string;

  constructor(private readonly config: SplunkRuntimeConfig) {
    this.normalizedUrl = config.url ? normalizeSplunkHecUrl(config.url) : '';
    if (config.enabled) console.info(`[SPLUNK] normalizedUrl=${this.normalizedUrl} verifyTls=${config.verifyTls}`);
  }

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
      const url = new URL(this.normalizedUrl);
      const transport = url.protocol === 'http:' ? http : https;
      const request = transport.request(createSplunkRequestOptions({ ...this.config, url: this.normalizedUrl }, body), (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on('end', () => {
          const durationMs = Date.now() - started;
          const status = response.statusCode ?? 0;
          const responseBody = Buffer.concat(chunks).toString('utf8');
          const parsed = parseSplunkResponse(responseBody);
          const code = parsed?.code;
          if (status >= 200 && status < 300 && (code === undefined || code === 0)) {
            console.log(`[SPLUNK] sent status=${status} code=${code ?? 'n/a'} durationMs=${durationMs}`);
            resolve({ ok: true, status, durationMs, code });
            return;
          }
          const error = status >= 200 && status < 300 ? `Splunk HEC error code=${code ?? 'unknown'} text=${parsed?.text ?? responseBody}` : `HTTP ${status}`;
          console.warn(`[SPLUNK] failed status=${status} error=${error}`);
          resolve({ ok: false, status, durationMs, code, error });
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
