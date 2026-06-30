import type { AppConfig } from '../config';

export class LpcClient {
  constructor(private readonly config: AppConfig) {}

  connect(): void {
    // TODO: Open TCP/Telnet stream to LPC and auto-select configured interface when prompted.
    void this.config;
  }
}
