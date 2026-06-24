export type LpcConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface LpcConnectionStateSnapshot {
  status: LpcConnectionStatus;
  connected: boolean;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastError: string | null;
}

export class LpcConnectionState {
  private status: LpcConnectionStatus = 'idle';
  private lastConnectedAt: string | null = null;
  private lastDisconnectedAt: string | null = null;
  private lastError: string | null = null;

  setConnecting(): void {
    this.status = 'connecting';
  }

  setConnected(): void {
    this.status = 'connected';
    this.lastConnectedAt = new Date().toISOString();
    this.lastError = null;
  }

  setDisconnected(): void {
    this.status = 'disconnected';
    this.lastDisconnectedAt = new Date().toISOString();
  }

  setError(error: Error | string): void {
    this.status = 'error';
    this.lastError = typeof error === 'string' ? error : error.message;
  }

  isConnected(): boolean {
    return this.status === 'connected';
  }

  getSnapshot(): LpcConnectionStateSnapshot {
    return {
      status: this.status,
      connected: this.isConnected(),
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
      lastError: this.lastError,
    };
  }
}
