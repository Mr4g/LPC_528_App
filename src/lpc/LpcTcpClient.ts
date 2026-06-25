import { EventEmitter } from 'node:events';
import net from 'node:net';
import { LpcConnectionState, type LpcConnectionStateSnapshot } from './LpcConnectionState';

export interface LpcTcpClientOptions {
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
}

export interface LpcConnectResult {
  ok: boolean;
  state: LpcConnectionStateSnapshot;
  message: string;
}

export interface LpcHeartbeatResult {
  ok: boolean;
  state: LpcConnectionStateSnapshot;
  heartbeatAttempted: boolean;
  writeAttempted: boolean;
  writeSuccess: boolean;
  error?: string;
}

export interface LpcTcpClientEvents {
  connected: [LpcConnectionStateSnapshot];
  disconnected: [LpcConnectionStateSnapshot];
  reconnecting: [LpcConnectionStateSnapshot];
  status: [LpcConnectionStateSnapshot];
  error: [Error, LpcConnectionStateSnapshot];
  rawData: [string];
  line: [string];
}

export declare interface LpcTcpClient {
  on<TEvent extends keyof LpcTcpClientEvents>(event: TEvent, listener: (...args: LpcTcpClientEvents[TEvent]) => void): this;
  once<TEvent extends keyof LpcTcpClientEvents>(event: TEvent, listener: (...args: LpcTcpClientEvents[TEvent]) => void): this;
  emit<TEvent extends keyof LpcTcpClientEvents>(event: TEvent, ...args: LpcTcpClientEvents[TEvent]): boolean;
}

export class LpcTcpClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private readonly state: LpcConnectionState;
  private receiveBuffer = '';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private manuallyDisconnected = false;
  private connecting = false;

  constructor(private readonly options: LpcTcpClientOptions) {
    super();
    this.state = new LpcConnectionState(options);
  }

  connect(): LpcConnectResult {
    const snapshot = this.state.getSnapshot();
    if (this.connecting || snapshot.status === 'connecting' || (snapshot.status === 'reconnecting' && this.reconnectTimer)) {
      return { ok: false, state: snapshot, message: 'LPC connection is already connecting' };
    }

    if (this.socket || snapshot.connected || snapshot.status === 'connected') {
      this.refreshSocketFlags();
      const current = this.state.getSnapshot();
      if (current.connected) return { ok: false, state: current, message: 'LPC is already connected' };
      this.destroySocket();
    }

    this.clearReconnectTimer();
    this.manuallyDisconnected = false;
    this.connecting = true;
    this.state.setConnecting();
    this.emitStatus();

    const socket = net.createConnection({ host: this.options.host, port: this.options.port });
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.setTimeout(this.options.connectTimeoutMs);
    socket.setKeepAlive(true, 5000);
    socket.setNoDelay(true);

    socket.on('connect', () => {
      socket.setTimeout(0);
      this.connecting = false;
      this.state.resetReconnectAttempts();
      this.state.setConnected();
      this.startHeartbeat();
      const state = this.state.getSnapshot();
      this.emit('connected', state);
      this.emit('status', state);
    });

    socket.on('timeout', () => {
      const message = `connect ETIMEDOUT ${this.options.host}:${this.options.port}`;
      this.connecting = false;
      this.state.setError(message, socket.destroyed, socket.writable);
      const error = new Error(message);
      const state = this.state.getSnapshot();
      this.emit('error', error, state);
      this.emit('status', state);
      socket.destroy(error);
    });

    socket.on('data', (chunk: string | Buffer) => {
      this.state.recordDataReceived();
      this.refreshSocketFlags();
      const text = chunk.toString('utf8');
      this.emit('rawData', text);
      this.processIncomingText(text);
    });

    socket.on('end', () => {
      this.connecting = false;
      this.state.setDisconnected(socket.destroyed, socket.writable);
      this.emitStatus();
    });

    socket.on('close', () => {
      this.stopHeartbeat();
      this.socket = null;
      this.connecting = false;
      const shouldReconnect = !this.manuallyDisconnected && this.options.reconnectEnabled;

      if (shouldReconnect) {
        this.scheduleReconnect();
        return;
      }

      if (this.state.getStatus() === 'disconnected') return;
      this.state.setDisconnected(true, false);
      const state = this.state.getSnapshot();
      this.emit('disconnected', state);
      this.emit('status', state);
    });

    socket.on('error', (error) => {
      this.connecting = false;
      this.state.setError(error, socket.destroyed, socket.writable);
      const state = this.state.getSnapshot();
      this.emit('error', error, state);
      this.emit('status', state);
    });

    return { ok: true, state: this.state.getSnapshot(), message: 'LPC connection started' };
  }

  disconnect(): LpcConnectResult {
    this.manuallyDisconnected = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.state.setDisconnecting();
    this.emitStatus();
    this.destroySocket();
    this.connecting = false;
    this.state.setDisconnected(true, false);
    const state = this.state.getSnapshot();
    this.emit('disconnected', state);
    this.emit('status', state);
    return { ok: true, state, message: 'LPC disconnected' };
  }

  send(data: string | Buffer): void {
    if (!this.socket || !this.state.isConnected() || this.socket.destroyed || !this.socket.writable) {
      this.markStaleConnection('LPC TCP client is not connected or writable');
      throw new Error('LPC TCP client is not connected');
    }

    this.socket.write(data, (error) => {
      if (error) {
        this.markStaleConnection(error.message);
        return;
      }
      this.state.recordSuccessfulWrite();
      this.emitStatus();
    });
  }

  isConnected(): boolean {
    this.refreshSocketFlags();
    return this.state.isConnected();
  }

  getState(): LpcConnectionStateSnapshot {
    this.refreshSocketFlags();
    return this.state.getSnapshot();
  }

  receiveTextForTest(text: string): void {
    this.processIncomingText(text);
  }

  forceRefreshStatus(): LpcConnectionStateSnapshot {
    if (this.state.getStatus() === 'connected' && (!this.socket || this.socket.destroyed || !this.socket.writable)) {
      this.markStaleConnection('Stale LPC connection detected');
    } else {
      this.refreshSocketFlags();
      this.emitStatus();
    }
    return this.state.getSnapshot();
  }

  async performHeartbeatCheck(): Promise<LpcHeartbeatResult> {
    const heartbeatAttempted = true;
    this.state.recordHeartbeat();

    if (!this.socket || !this.state.isConnected()) {
      const state = this.state.getSnapshot();
      return { ok: false, state, heartbeatAttempted, writeAttempted: false, writeSuccess: false, error: 'LPC is not connected' };
    }

    if (this.socket.destroyed || !this.socket.writable) {
      this.markStaleConnection('Stale LPC connection detected');
      const state = this.state.getSnapshot();
      return { ok: false, state, heartbeatAttempted, writeAttempted: false, writeSuccess: false, error: 'Socket is destroyed or not writable' };
    }

    const payload = this.options.heartbeatPayload;
    if (!payload) {
      this.refreshSocketFlags();
      this.emitStatus();
      return { ok: true, state: this.state.getSnapshot(), heartbeatAttempted, writeAttempted: false, writeSuccess: false };
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.markStaleConnection('LPC heartbeat write timed out');
        resolve({ ok: false, state: this.state.getSnapshot(), heartbeatAttempted, writeAttempted: true, writeSuccess: false, error: 'LPC heartbeat write timed out' });
      }, this.options.heartbeatTimeoutMs);

      try {
        this.socket?.write(payload, (error) => {
          clearTimeout(timeout);
          if (error) {
            this.markStaleConnection(error.message);
            resolve({ ok: false, state: this.state.getSnapshot(), heartbeatAttempted, writeAttempted: true, writeSuccess: false, error: error.message });
            return;
          }
          this.state.recordSuccessfulWrite();
          this.refreshSocketFlags();
          this.emitStatus();
          resolve({ ok: true, state: this.state.getSnapshot(), heartbeatAttempted, writeAttempted: true, writeSuccess: true });
        });
      } catch (error) {
        clearTimeout(timeout);
        const message = error instanceof Error ? error.message : 'Heartbeat write failed';
        this.markStaleConnection(message);
        resolve({ ok: false, state: this.state.getSnapshot(), heartbeatAttempted, writeAttempted: true, writeSuccess: false, error: message });
      }
    });
  }

  private processIncomingText(text: string): void {
    this.receiveBuffer += text;

    let delimiter = this.findLineDelimiterIndex();
    while (delimiter >= 0) {
      const line = this.receiveBuffer.slice(0, delimiter);
      const delimiterLength = this.receiveBuffer[delimiter] === '\r' && this.receiveBuffer[delimiter + 1] === '\n' ? 2 : 1;
      this.receiveBuffer = this.receiveBuffer.slice(delimiter + delimiterLength);
      if (line || delimiter !== 0) {
        this.emit('line', line);
      }
      delimiter = this.findLineDelimiterIndex();
    }
  }

  private findLineDelimiterIndex(): number {
    const newlineIndex = this.receiveBuffer.indexOf('\n');
    const carriageReturnIndex = this.receiveBuffer.indexOf('\r');
    if (newlineIndex < 0) return carriageReturnIndex;
    if (carriageReturnIndex < 0) return newlineIndex;
    return Math.min(newlineIndex, carriageReturnIndex);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    if (!this.options.heartbeatEnabled) return;

    this.heartbeatTimer = setInterval(() => {
      void this.performHeartbeatCheck();
    }, this.options.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private markStaleConnection(message: string): void {
    this.state.setStaleConnectionDetected(message || 'Stale LPC connection detected');
    const error = new Error(message || 'Stale LPC connection detected');
    const state = this.state.getSnapshot();
    this.emit('error', error, state);
    this.emit('status', state);
    this.destroySocket();
  }

  private destroySocket(): void {
    if (!this.socket) return;
    this.socket.destroy();
    this.socket = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.socket || this.connecting) return;

    const nextReconnectAt = new Date(Date.now() + this.options.reconnectDelayMs).toISOString();
    this.state.setReconnecting(nextReconnectAt);
    const state = this.state.getSnapshot();
    this.emit('reconnecting', state);
    this.emit('status', state);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.socket = null;
      this.connecting = false;
      this.connect();
    }, this.options.reconnectDelayMs);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private refreshSocketFlags(): void {
    if (!this.socket) {
      this.state.updateSocketFlags(true, false);
      return;
    }
    this.state.updateSocketFlags(this.socket.destroyed, this.socket.writable);
  }

  private emitStatus(): void {
    this.emit('status', this.state.getSnapshot());
  }
}
