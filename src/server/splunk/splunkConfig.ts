import type { AppConfig } from '../../config';
import type { SplunkRuntimeConfig } from './splunkTypes';

export function getSplunkConfig(config: AppConfig): SplunkRuntimeConfig {
  return {
    enabled: config.SPLUNK_ENABLED,
    url: config.SPLUNK_HEC_URL ?? '',
    token: config.SPLUNK_HEC_TOKEN ?? '',
    index: config.SPLUNK_INDEX,
    source: config.SPLUNK_SOURCE,
    sourcetype: config.SPLUNK_SOURCETYPE,
    site: config.SPLUNK_SITE || null,
    line: config.SPLUNK_LINE || null,
    workplace: config.SPLUNK_WORKPLACE || config.SPLUNK_SOURCE,
    device: config.SPLUNK_DEVICE || config.SPLUNK_SOURCE,
    timeoutMs: config.SPLUNK_TIMEOUT_MS,
    verifyTls: config.SPLUNK_VERIFY_TLS,
    sendResult: config.SPLUNK_SEND_RESULT,
    sendCurve: config.SPLUNK_SEND_CURVE,
    bufferEnabled: config.SPLUNK_BUFFER_ENABLED,
    bufferRetryIntervalMs: config.SPLUNK_BUFFER_RETRY_INTERVAL_MS,
    bufferMaxAttempts: config.SPLUNK_BUFFER_MAX_ATTEMPTS,
  };
}

export function isSplunkConfigured(config: SplunkRuntimeConfig): boolean {
  return Boolean(config.url && config.token);
}
