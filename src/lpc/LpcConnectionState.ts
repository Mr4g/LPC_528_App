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
  heartbeatEnabled: boolean;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  staleConnectionTimeoutMs: number;
  heartbeatPayload: string;
  preferredInterface?: number;
  startupCleanupEnabled?: boolean;
  startupCleanupInterfaces?: number[];
  startupCleanupWaitMs?: number;
  gracefulCloseWaitMs?: number;
  streamWatchdogMs?: number;
}

export interface LpcConnectionStateSnapshot extends LpcConnectionStateOptions {
  status: LpcConnectionStatus;
  connected: boolean;
  lastConnectionAttemptAt: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastError: string | null;
  socketDestroyed: boolean;
  socketWritable: boolean;
  reconnectAttemptCount: number;
  nextReconnectAt: string | null;
  lastDataReceivedAt: string | null;
  lastSuccessfulWriteAt: string | null;
  lastHeartbeatAt: string | null;
  staleConnectionDetectedAt: string | null;
  tcpConnected?: boolean;
  interfaceSelected?: boolean;
  selectedInterface?: number | null;
  streamingHealthy?: boolean;
  lpcStatusCode?: string | null;
  lastLpcRxAt?: string | null;
  lastStreamFrameAt?: string | null;
  lastResultFrameAt?: string | null;
  isConnecting?: boolean;
  isDisconnecting?: boolean;
  lastDisconnectReason?: string | null;
  lastReconnectAt?: string | null;
  lastStartupCleanupAt?: string | null;
  lastStartupCleanupResult?: Record<string, string>;
}

export class LpcConnectionState {
  private status: LpcConnectionStatus = 'idle';
  private connected = false;
  private lastConnectionAttemptAt: string | null = null;
  private lastConnectedAt: string | null = null;
  private lastDisconnectedAt: string | null = null;
  private lastError: string | null = null;
  private socketDestroyed = true;
  private socketWritable = false;
  private reconnectAttemptCount = 0;
  private nextReconnectAt: string | null = null;
  private lastDataReceivedAt: string | null = null;
  private lastSuccessfulWriteAt: string | null = null;
  private lastHeartbeatAt: string | null = null;
  private staleConnectionDetectedAt: string | null = null;

  constructor(private readonly options: LpcConnectionStateOptions) {}

  setConnecting(): void {
    this.status = 'connecting';
    this.connected = false;
    this.socketDestroyed = false;
    this.socketWritable = false;
    this.lastConnectionAttemptAt = new Date().toISOString();
    this.nextReconnectAt = null;
  }

  setConnected(): void {
    this.status = 'connected';
    this.connected = true;
    this.socketDestroyed = false;
    this.socketWritable = true;
    this.lastConnectedAt = new Date().toISOString();
    this.lastError = null;
    this.nextReconnectAt = null;
    this.staleConnectionDetectedAt = null;
  }

  setDisconnecting(): void {
    this.status = 'disconnecting';
    this.connected = false;
  }

  setDisconnected(socketDestroyed = true, socketWritable = false): void {
    this.status = 'disconnected';
    this.connected = false;
    this.socketDestroyed = socketDestroyed;
    this.socketWritable = socketWritable;
    this.lastDisconnectedAt = new Date().toISOString();
    this.nextReconnectAt = null;
  }

  setReconnecting(nextReconnectAt: string): void {
    this.status = 'reconnecting';
    this.connected = false;
    this.socketDestroyed = true;
    this.socketWritable = false;
    this.reconnectAttemptCount += 1;
    this.lastConnectionAttemptAt = new Date().toISOString();
    this.nextReconnectAt = nextReconnectAt;
  }

  setError(error: Error | string, socketDestroyed = true, socketWritable = false): void {
    this.status = 'error';
    this.connected = false;
    this.socketDestroyed = socketDestroyed;
    this.socketWritable = socketWritable;
    this.lastError = typeof error === 'string' ? error : error.message;
  }

  setStaleConnectionDetected(error = 'Stale LPC connection detected'): void {
    this.staleConnectionDetectedAt = new Date().toISOString();
    this.setError(error, true, false);
  }

  recordDataReceived(): void {
    this.lastDataReceivedAt = new Date().toISOString();
  }

  recordSuccessfulWrite(): void {
    this.lastSuccessfulWriteAt = new Date().toISOString();
  }

  recordHeartbeat(): void {
    this.lastHeartbeatAt = new Date().toISOString();
  }

  updateSocketFlags(socketDestroyed: boolean, socketWritable: boolean): void {
    this.socketDestroyed = socketDestroyed;
    this.socketWritable = socketWritable;
    if (this.status === 'connected') {
      this.connected = !socketDestroyed && socketWritable;
    }
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
      socketWritable: this.socketWritable,
      reconnectAttemptCount: this.reconnectAttemptCount,
      nextReconnectAt: this.nextReconnectAt,
      lastDataReceivedAt: this.lastDataReceivedAt,
      lastSuccessfulWriteAt: this.lastSuccessfulWriteAt,
      lastHeartbeatAt: this.lastHeartbeatAt,
      staleConnectionDetectedAt: this.staleConnectionDetectedAt,
    };
  }
}
