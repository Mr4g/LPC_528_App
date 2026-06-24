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
}

export interface LpcConnectResult {
  ok: boolean;
  state: LpcConnectionStateSnapshot;
  message: string;
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
  emit<TEvent extends keyof LpcTcpClientEvents>(event: TEvent, ...args: LpcTcpClientEvents[TEvent]): boolean;
}

export class LpcTcpClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private readonly state: LpcConnectionState;
  private receiveBuffer = '';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private manuallyDisconnected = false;
  private connecting = false;
  private closingForReconnect = false;

  constructor(private readonly options: LpcTcpClientOptions) {
    super();
    this.state = new LpcConnectionState(options);
  }

  connect(): LpcConnectResult {
    const snapshot = this.state.getSnapshot();
    if (this.connecting || snapshot.status === 'connecting') {
      return { ok: false, state: snapshot, message: 'LPC connection is already connecting' };
    }

    if (this.socket || snapshot.connected || snapshot.status === 'connected') {
      return { ok: false, state: snapshot, message: 'LPC is already connected' };
    }

    this.clearReconnectTimer();
    this.manuallyDisconnected = false;
    this.closingForReconnect = false;
    this.connecting = true;
    this.state.setConnecting();
    this.emitStatus();

    const socket = net.createConnection({ host: this.options.host, port: this.options.port });
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.setTimeout(this.options.connectTimeoutMs);

    socket.on('connect', () => {
      socket.setTimeout(0);
      this.connecting = false;
      this.closingForReconnect = false;
      this.state.resetReconnectAttempts();
      this.state.setConnected();
      const state = this.state.getSnapshot();
      this.emit('connected', state);
      this.emit('status', state);
    });

    socket.on('timeout', () => {
      const message = `connect ETIMEDOUT ${this.options.host}:${this.options.port}`;
      this.connecting = false;
      this.state.setError(message, socket.destroyed);
      const error = new Error(message);
      const state = this.state.getSnapshot();
      this.emit('error', error, state);
      this.emit('status', state);
      socket.destroy(error);
    });

    socket.on('data', (chunk: string | Buffer) => {
      const text = chunk.toString('utf8');
      this.emit('rawData', text);
      this.processIncomingText(text);
    });

    socket.on('close', () => {
      this.socket = null;
      this.connecting = false;
      const shouldReconnect = !this.manuallyDisconnected && this.options.reconnectEnabled;

      if (shouldReconnect) {
        this.scheduleReconnect();
        return;
      }

      if (this.state.getStatus() === 'disconnected') return;
      this.state.setDisconnected(true);
      const state = this.state.getSnapshot();
      this.emit('disconnected', state);
      this.emit('status', state);
    });

    socket.on('error', (error) => {
      this.connecting = false;
      this.state.setError(error, socket.destroyed);
      const state = this.state.getSnapshot();
      this.emit('error', error, state);
      this.emit('status', state);
    });

    return { ok: true, state: this.state.getSnapshot(), message: 'LPC connection started' };
  }

  disconnect(): LpcConnectResult {
    this.manuallyDisconnected = true;
    this.clearReconnectTimer();
    this.state.setDisconnecting();
    this.emitStatus();
    this.socket?.destroy();
    this.socket = null;
    this.connecting = false;
    this.closingForReconnect = false;
    this.state.setDisconnected(true);
    const state = this.state.getSnapshot();
    this.emit('disconnected', state);
    this.emit('status', state);
    return { ok: true, state, message: 'LPC disconnected' };
  }

  send(data: string | Buffer): void {
    if (!this.socket || !this.state.isConnected()) {
      throw new Error('LPC TCP client is not connected');
    }

    this.socket.write(data);
  }

  isConnected(): boolean {
    return this.state.isConnected();
  }

  getState(): LpcConnectionStateSnapshot {
    return this.state.getSnapshot();
  }

  private processIncomingText(text: string): void {
    this.receiveBuffer += text;

    let newlineIndex = this.receiveBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.receiveBuffer.slice(0, newlineIndex);
      this.receiveBuffer = this.receiveBuffer.slice(newlineIndex + 1);
      this.emit('line', line);
      newlineIndex = this.receiveBuffer.indexOf('\n');
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.socket || this.connecting) return;

    this.closingForReconnect = true;
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

  private emitStatus(): void {
    this.emit('status', this.state.getSnapshot());
  }
}
