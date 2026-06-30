import type { AppConfig } from '../config';
import type { LpcResult } from '../shared/types';

export interface SplunkHecPayload<TEvent> {
  time?: number;
  index: string;
  source: string;
  sourcetype: string;
  event: TEvent;
}

export class SplunkHecClient {
  constructor(private readonly config: Pick<AppConfig, 'SPLUNK_INDEX' | 'SPLUNK_SOURCE' | 'SPLUNK_SOURCETYPE'>) {}

  buildResultPayload(result: LpcResult): SplunkHecPayload<LpcResult> {
    // TODO: Send this payload to the configured HEC URL with the token loaded from environment.
    return {
      index: this.config.SPLUNK_INDEX,
      source: this.config.SPLUNK_SOURCE,
      sourcetype: this.config.SPLUNK_SOURCETYPE,
      event: result,
    };
  }
}
