import http from 'node:http';
import https from 'node:https';
import type { LastSplunkStatus, SplunkHecEnvelope, SplunkRuntimeConfig, SplunkSendResult } from './splunkTypes';
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

export function cleanSplunkJsonPayload(json: string): string {
  return json
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[łŁ]/g, (char) => (char === 'Ł' ? 'L' : 'l'))
    .replace(/\\[trn]/g, ' ')
    .replace(/[\t\r\n\f\v\u00A0\u1680\u180E\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]+/g, ' ');
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
  private lastSplunkStatus: LastSplunkStatus | null = null;
  private lastSplunkAt: string | null = null;
  private lastSplunkErrorCode: number | null = null;
  private lastSplunkErrorText: string | null = null;

  constructor(private readonly config: SplunkRuntimeConfig) {
    this.normalizedUrl = config.url ? normalizeSplunkHecUrl(config.url) : '';
    if (config.enabled) console.info(`[SPLUNK] config enabled=${config.enabled} configured=${isSplunkConfigured(config)} verifyTls=${config.verifyTls} urlConfigured=${Boolean(config.url)} tokenConfigured=${Boolean(config.token)}`);
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
      site: this.config.site,
      line: this.config.line,
      workplace: this.config.workplace,
      device: this.config.device,
      verifyTls: this.config.verifyTls,
      lastSplunkStatus: this.lastSplunkStatus,
      lastSplunkAt: this.lastSplunkAt,
      lastSplunkErrorCode: this.lastSplunkErrorCode,
      lastSplunkErrorText: this.lastSplunkErrorText,
    };
  }

  setLastStatus(status: LastSplunkStatus, errorCode: number | null = null, errorText: string | null = null): void {
    this.lastSplunkStatus = status;
    this.lastSplunkAt = new Date().toISOString();
    this.lastSplunkErrorCode = errorCode;
    this.lastSplunkErrorText = errorText;
  }

  async send(envelope: SplunkHecEnvelope): Promise<SplunkSendResult> {
    if (!this.config.enabled) {
      this.setLastStatus('disabled');
      return { ok: true, skipped: true };
    }
    if (!isSplunkConfigured(this.config)) {
      this.setLastStatus('not_configured', null, 'Splunk HEC URL or token is not configured');
      return { ok: false, error: 'Splunk HEC URL or token is not configured' };
    }

    const started = Date.now();
    console.log(`[SPLUNK] tls verify=${this.config.verifyTls}`);
    const body = cleanSplunkJsonPayload(JSON.stringify(envelope));
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
            this.setLastStatus('sent', code ?? null, null);
            resolve({ ok: true, status, durationMs, code });
            return;
          }
          const text = parsed?.text ?? responseBody;
          const error = status >= 200 && status < 300 ? `Splunk HEC error code=${code ?? 'unknown'} text=${text}` : `HTTP ${status}`;
          console.warn(`[SPLUNK] failed status=${status} code=${code ?? 'n/a'} text=${text} error=${error}`);
          this.setLastStatus('failed', code ?? null, text || error);
          resolve({ ok: false, status, durationMs, code, error });
        });
      });

      request.on('timeout', () => request.destroy(new Error(`Splunk HEC timeout after ${this.config.timeoutMs}ms`)));
      request.on('error', (error) => {
        const message = error.message;
        console.warn(`[SPLUNK] failed status=network error=${message}`);
        this.setLastStatus('failed', null, message);
        resolve({ ok: false, durationMs: Date.now() - started, error: message });
      });
      request.write(body);
      request.end();
    });
  }
}
