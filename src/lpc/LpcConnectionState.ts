export type LpcConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'disconnected'
  | 'reconnecting'
  | 'error';

export interface LpcConnectionStateOptions {
  host: string;
  port: number;
  autoConnect: boolean;
  reconnectEnabled: boolean;
  reconnectDelayMs: number;
  connectTimeoutMs: number;
}

export interface LpcConnectionStateSnapshot extends LpcConnectionStateOptions {
  status: LpcConnectionStatus;
  connected: boolean;
  lastConnectionAttemptAt: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastError: string | null;
  socketDestroyed: boolean;
  reconnectAttemptCount: number;
}

export class LpcConnectionState {
  private status: LpcConnectionStatus = 'idle';
  private connected = false;
  private lastConnectionAttemptAt: string | null = null;
  private lastConnectedAt: string | null = null;
  private lastDisconnectedAt: string | null = null;
  private lastError: string | null = null;
  private socketDestroyed = true;
  private reconnectAttemptCount = 0;

  constructor(private readonly options: LpcConnectionStateOptions) {}

  setConnecting(): void {
    this.status = 'connecting';
    this.connected = false;
    this.socketDestroyed = false;
    this.lastConnectionAttemptAt = new Date().toISOString();
  }

  setConnected(): void {
    this.status = 'connected';
    this.connected = true;
    this.socketDestroyed = false;
    this.lastConnectedAt = new Date().toISOString();
    this.lastError = null;
  }

  setDisconnecting(): void {
    this.status = 'disconnecting';
    this.connected = false;
  }

  setDisconnected(socketDestroyed = true): void {
    this.status = 'disconnected';
    this.connected = false;
    this.socketDestroyed = socketDestroyed;
    this.lastDisconnectedAt = new Date().toISOString();
  }

  setReconnecting(): void {
    this.status = 'reconnecting';
    this.connected = false;
    this.socketDestroyed = true;
    this.reconnectAttemptCount += 1;
    this.lastConnectionAttemptAt = new Date().toISOString();
  }

  setError(error: Error | string, socketDestroyed = true): void {
    this.status = 'error';
    this.connected = false;
    this.socketDestroyed = socketDestroyed;
    this.lastError = typeof error === 'string' ? error : error.message;
  }

  resetReconnectAttempts(): void {
    this.reconnectAttemptCount = 0;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getStatus(): LpcConnectionStatus {
    return this.status;
  }

  getSnapshot(): LpcConnectionStateSnapshot {
    return {
      ...this.options,
      status: this.status,
      connected: this.connected,
      lastConnectionAttemptAt: this.lastConnectionAttemptAt,
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
      lastError: this.lastError,
      socketDestroyed: this.socketDestroyed,
      reconnectAttemptCount: this.reconnectAttemptCount,
    };
  }
}
