import { EventEmitter } from 'node:events';
import net from 'node:net';
import { LpcConnectionState, type LpcConnectionStateSnapshot } from './LpcConnectionState';

export interface LpcTcpClientOptions {
  host: string;
  port: number;
  reconnectEnabled?: boolean;
  reconnectDelayMs?: number;
}

export interface LpcTcpClientEvents {
  connected: [];
  disconnected: [];
  error: [Error];
  rawData: [string];
  line: [string];
}

export declare interface LpcTcpClient {
  on<TEvent extends keyof LpcTcpClientEvents>(event: TEvent, listener: (...args: LpcTcpClientEvents[TEvent]) => void): this;
  emit<TEvent extends keyof LpcTcpClientEvents>(event: TEvent, ...args: LpcTcpClientEvents[TEvent]): boolean;
}

export class LpcTcpClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private readonly state = new LpcConnectionState();
  private receiveBuffer = '';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private manuallyDisconnected = false;
  private connecting = false;

  constructor(private readonly options: LpcTcpClientOptions) {
    super();
  }

  connect(): void {
    if (this.socket || this.connecting || this.state.isConnected()) return;

    this.clearReconnectTimer();
    this.manuallyDisconnected = false;
    this.connecting = true;
    this.state.setConnecting();

    const socket = net.createConnection({ host: this.options.host, port: this.options.port });
    this.socket = socket;

    socket.setEncoding('utf8');

    socket.on('connect', () => {
      this.connecting = false;
      this.state.setConnected();
      this.emit('connected');
    });

    socket.on('data', (chunk: string | Buffer) => {
      const text = chunk.toString('utf8');
      this.emit('rawData', text);
      this.processIncomingText(text);
    });

    socket.on('close', () => {
      this.socket = null;
      this.connecting = false;
      this.state.setDisconnected();
      this.emit('disconnected');

      if (!this.manuallyDisconnected && this.options.reconnectEnabled) {
        this.scheduleReconnect();
      }
    });

    socket.on('error', (error) => {
      this.connecting = false;
      this.state.setError(error);
      this.emit('error', error);
    });
  }

  disconnect(): void {
    this.manuallyDisconnected = true;
    this.clearReconnectTimer();
    this.socket?.destroy();
    this.socket = null;
    this.connecting = false;
    this.state.setDisconnected();
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

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.options.reconnectDelayMs ?? 3000);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}
