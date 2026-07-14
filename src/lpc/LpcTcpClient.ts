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
  preferredInterface: number;
  fallbackEnabled: boolean;
  fallbackInterfaces: number[];
  startupCleanupEnabled: boolean;
  startupCleanupInterfaces: number[];
  startupCleanupWaitMs: number;
  gracefulCloseWaitMs: number;
  streamWatchdogMs: number;
}

export interface LpcConnectResult { ok: boolean; state: LpcConnectionStateSnapshot; message: string; }
export interface LpcHeartbeatResult { ok: boolean; state: LpcConnectionStateSnapshot; heartbeatAttempted: boolean; writeAttempted: boolean; writeSuccess: boolean; error?: string; }
export interface LpcTcpClientEvents {
  connected: [LpcConnectionStateSnapshot]; disconnected: [LpcConnectionStateSnapshot]; reconnecting: [LpcConnectionStateSnapshot]; status: [LpcConnectionStateSnapshot]; error: [Error, LpcConnectionStateSnapshot]; rawData: [string]; line: [string];
}
export declare interface LpcTcpClient {
  on<TEvent extends keyof LpcTcpClientEvents>(event: TEvent, listener: (...args: LpcTcpClientEvents[TEvent]) => void): this;
  once<TEvent extends keyof LpcTcpClientEvents>(event: TEvent, listener: (...args: LpcTcpClientEvents[TEvent]) => void): this;
  emit<TEvent extends keyof LpcTcpClientEvents>(event: TEvent, ...args: LpcTcpClientEvents[TEvent]): boolean;
}

type CleanupResult = 'success' | 'failed' | 'skipped' | 'unavailable';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class LpcTcpClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private readonly state: LpcConnectionState;
  private receiveBuffer = '';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private residualLineTimer: NodeJS.Timeout | null = null;
  private streamWatchdogTimer: NodeJS.Timeout | null = null;
  private manuallyDisconnected = false;
  private connecting = false;
  private disconnecting = false;
  private interfaceSelected = false;
  private selectedInterface: number | null = null;
  private streamingHealthy = false;
  private lpcStatusCode: string | null = null;
  private lastDisconnectReason: string | null = null;
  private lastReconnectAt: string | null = null;
  private lastLpcRxAt: string | null = null;
  private lastStreamFrameAt: string | null = null;
  private lastResultFrameAt: string | null = null;
  private interfaceSelectionSent = false;
  private currentInterfaceAttempt: number | null = null;
  private fallbackInterfacesForRound: number[] = [];
  private usingFallbackInterface = false;
  private lastInterfaceAttempts: Array<{ interface: number; result: 'success' | 'unavailable' | 'timeout' | 'failed'; at: string }> = [];
  private operatorMessage: string | null = null;
  private lastInterfaceError: string | null = null;
  private lastInterfaceErrorAt: string | null = null;
  private lastInterfaceAttempt: number | null = null;
  private startupCleanupDone = false;
  private lastStartupCleanupAt: string | null = null;
  private lastStartupCleanupResult: Record<string, CleanupResult> = {};

  constructor(private readonly options: LpcTcpClientOptions) { super(); this.state = new LpcConnectionState(options); }

  async connect(): Promise<LpcConnectResult> {
    const snapshot = this.state.getSnapshot();
    if (this.connecting || this.disconnecting || snapshot.status === 'connecting' || (snapshot.status === 'reconnecting' && this.reconnectTimer)) return { ok: false, state: this.getState(), message: 'LPC connection is already connecting' };
    if (this.socket || snapshot.connected || snapshot.status === 'connected') {
      this.refreshSocketFlags();
      if (this.state.getSnapshot().connected) return { ok: false, state: this.getState(), message: 'LPC is already connected' };
      await this.disconnectGracefully('before_reconnect');
    }
    if (this.options.startupCleanupEnabled && !this.startupCleanupDone) await this.runStartupCleanup();

    this.clearReconnectTimer(); this.manuallyDisconnected = false; this.connecting = true; this.interfaceSelected = false; this.interfaceSelectionSent = false; this.selectedInterface = null; this.usingFallbackInterface = false; this.streamingHealthy = false; this.lpcStatusCode = null; this.operatorMessage = null; this.lastInterfaceAttempts = [];
    this.fallbackInterfacesForRound = this.getFallbackInterfacesForRound();
    this.state.setConnecting(); this.emitStatus();
    console.log(`[LPC] connecting preferred interface=${this.options.preferredInterface}`);
    this.startSocketForInterface(this.fallbackInterfacesForRound[0] ?? this.options.preferredInterface);
    return { ok: true, state: this.getState(), message: 'LPC connection started' };
  }

  private startSocketForInterface(iface: number): void {
    this.currentInterfaceAttempt = iface;
    this.interfaceSelectionSent = false;
    this.connecting = true;
    this.state.setConnecting();
    this.emitStatus();
    if (iface !== this.options.preferredInterface) console.log(`[LPC] trying fallback interface=${iface}`);
    const socket = net.createConnection({ host: this.options.host, port: this.options.port });
    this.socket = socket; socket.setEncoding('utf8'); socket.setTimeout(this.options.connectTimeoutMs); socket.setKeepAlive(true, 5000); socket.setNoDelay(true);
    socket.on('connect', () => { this.state.resetReconnectAttempts(); console.log('[LPC] TCP connected'); });
    socket.on('timeout', () => { void this.handleInterfaceAttemptFailed('timeout'); });
    socket.on('data', (chunk: string | Buffer) => { this.state.recordDataReceived(); this.lastLpcRxAt = new Date().toISOString(); this.refreshSocketFlags(); const text = chunk.toString('utf8'); this.emit('rawData', text); this.handleInterfaceSelection(text); this.processIncomingText(text); });
    socket.on('end', () => { this.connecting = false; this.state.setDisconnected(socket.destroyed, socket.writable); this.emitStatus(); });
    socket.on('close', () => { this.stopHeartbeat(); this.socket = null; this.connecting = false; if (!this.interfaceSelected) this.selectedInterface = null; if (!this.manuallyDisconnected && this.options.reconnectEnabled) { this.scheduleReconnect(); return; } if (this.state.getStatus() === 'disconnected') return; this.state.setDisconnected(true, false); this.emit('disconnected', this.getState()); this.emitStatus(); });
    socket.on('error', (error: NodeJS.ErrnoException) => { console.warn(`[LPC] socket error code=${error.code ?? 'unknown'} message=${error.message}`); this.connecting = false; this.streamingHealthy = false; this.state.setError(error, socket.destroyed, socket.writable); this.emit('error', error, this.getState()); this.emitStatus(); });
  }

  async reconnect(): Promise<LpcConnectResult> { console.log('[LPC] reconnect requested'); if (this.socket || this.connecting) { console.log('[LPC] cleanup old socket before reconnect'); await this.disconnectGracefully('before_reconnect'); } this.lastReconnectAt = new Date().toISOString(); return this.connect(); }
  disconnect(): LpcConnectResult { void this.disconnectGracefully('manual_disconnect'); return { ok: true, state: this.getState(), message: 'LPC disconnect started' }; }

  async disconnectGracefully(reason: string): Promise<LpcConnectResult> {
    if (this.disconnecting) return { ok: false, state: this.getState(), message: 'LPC disconnect is already running' };
    console.log(`[LPC] disconnectGracefully reason=${reason}`); this.disconnecting = true; this.lastDisconnectReason = reason; this.manuallyDisconnected = true; this.clearReconnectTimer(); this.stopHeartbeat(); this.clearResidualLineTimer(); this.clearStreamWatchdog(); this.state.setDisconnecting(); this.emitStatus();
    const socket = this.socket; this.socket = null;
    if (socket) { socket.removeAllListeners('data'); socket.removeAllListeners('timeout'); socket.removeAllListeners('error'); try { if (!socket.destroyed) { socket.end(); console.log('[LPC] socket.end sent'); await sleep(this.options.gracefulCloseWaitMs); } if (!socket.destroyed) { socket.destroy(); console.log('[LPC] socket.destroy after timeout'); } } catch { if (!socket.destroyed) socket.destroy(); } finally { socket.removeAllListeners(); console.log('[LPC] socket closed'); } }
    this.connecting = false; this.interfaceSelected = false; this.interfaceSelectionSent = false; this.selectedInterface = null; this.streamingHealthy = false; this.lastLpcRxAt = null; this.lastStreamFrameAt = null; this.lastResultFrameAt = null; this.state.setDisconnected(true, false); const state = this.getState(); this.emit('disconnected', state); this.emit('status', state); this.disconnecting = false; return { ok: true, state, message: 'LPC disconnected' };
  }

  send(data: string | Buffer): void { if (!this.socket || !this.state.isConnected() || !this.interfaceSelected) { this.markStaleConnection('LPC TCP client is not connected or interface is not selected'); throw new Error('LPC TCP client is not connected'); } const written = this.safeWrite(this.socket, data, 'send', (error) => { if (error) { this.markStaleConnection(error.message); return; } this.state.recordSuccessfulWrite(); this.emitStatus(); }); if (!written) { this.markStaleConnection('LPC TCP client is not connected or writable'); throw new Error('LPC TCP client is not connected'); } }
  isConnected(): boolean { this.refreshSocketFlags(); return this.state.isConnected() && this.interfaceSelected; }
  getState(): LpcConnectionStateSnapshot { this.refreshSocketFlags(); return { ...this.state.getSnapshot(), tcpConnected: this.state.isConnected(), interfaceSelected: this.interfaceSelected, selectedInterface: this.selectedInterface, streamingHealthy: this.streamingHealthy, lpcStatusCode: this.lpcStatusCode, operatorMessage: this.operatorMessage, lastLpcRxAt: this.lastLpcRxAt, lastStreamFrameAt: this.lastStreamFrameAt, lastResultFrameAt: this.lastResultFrameAt, isConnecting: this.connecting, isDisconnecting: this.disconnecting, lastDisconnectReason: this.lastDisconnectReason, lastReconnectAt: this.lastReconnectAt, lastInterfaceError: this.lastInterfaceError, lastInterfaceErrorAt: this.lastInterfaceErrorAt, lastInterfaceAttempt: this.lastInterfaceAttempt, usingFallbackInterface: this.usingFallbackInterface, fallbackEnabled: this.options.fallbackEnabled, fallbackInterfaces: this.options.fallbackInterfaces, lastInterfaceAttempts: this.lastInterfaceAttempts, startupCleanupEnabled: this.options.startupCleanupEnabled, startupCleanupInterfaces: this.options.startupCleanupInterfaces, preferredInterface: this.options.preferredInterface, lastStartupCleanupAt: this.lastStartupCleanupAt, lastStartupCleanupResult: this.lastStartupCleanupResult } as LpcConnectionStateSnapshot; }
  receiveTextForTest(text: string): void { this.processIncomingText(text); }
  flushBufferedLineForTest(): void { this.flushResidualLineIfComplete(); }
  forceRefreshStatus(): LpcConnectionStateSnapshot { if (this.state.getStatus() === 'connected' && (!this.socket || this.socket.destroyed || !this.socket.writable)) this.markStaleConnection('Stale LPC connection detected'); else { this.refreshSocketFlags(); this.emitStatus(); } return this.getState(); }

  markTestStartCommand(): void { this.clearStreamWatchdog(); this.streamWatchdogTimer = setTimeout(() => { if (this.lastStreamFrameAt || this.lastResultFrameAt) return; this.streamingHealthy = false; this.lpcStatusCode = 'LPC_STREAM_STALLED'; console.warn(`[LPC] streaming stalled after test start watchdogMs=${this.options.streamWatchdogMs}`); this.emitStatus(); }, this.options.streamWatchdogMs); }
  recordStreamFrame(kind: 'stream' | 'result', receivedAt = new Date().toISOString()): void { this.lastLpcRxAt = receivedAt; this.streamingHealthy = true; if (this.lpcStatusCode === 'LPC_STREAM_STALLED') this.lpcStatusCode = this.usingFallbackInterface ? 'LPC_CONNECTED_FALLBACK_INTERFACE' : null; if (kind === 'stream') { this.lastStreamFrameAt = receivedAt; console.log('[LPC] streaming frame received'); } else { this.lastResultFrameAt = receivedAt; console.log('[LPC] result frame received'); } this.clearStreamWatchdog(); this.emitStatus(); }
  canStartTest(): { ok: true } | { ok: false; code: string; message: string } { if (this.lpcStatusCode === 'LPC_NO_AVAILABLE_INTERFACE') return { ok: false, code: 'LPC_NO_AVAILABLE_INTERFACE', message: this.operatorMessage ?? 'Zresetuj LPC, następnie IPC.' }; if (this.lpcStatusCode === 'LPC_INTERFACE_UNAVAILABLE') return { ok: false, code: 'LPC_INTERFACE_UNAVAILABLE', message: `Interface LPC ${this.lastInterfaceAttempt ?? this.options.preferredInterface} jest niedostępny. Prawdopodobnie jest zajęty przez inną sesję lub poprzednie połączenie nie zostało zwolnione.` }; if (this.lpcStatusCode === 'LPC_STREAM_STALLED') return { ok: false, code: 'LPC_STREAM_STALLED', message: 'Połączenie TCP z LPC jest aktywne, ale nie przychodzą dane pomiarowe po starcie testu.' }; if (!this.state.isConnected() || !this.interfaceSelected) return { ok: false, code: 'LPC_NOT_READY', message: `LPC nie jest gotowy: TCP lub Interface ${this.options.preferredInterface} nie zostały poprawnie zestawione.` }; return { ok: true }; }

  async performHeartbeatCheck(): Promise<LpcHeartbeatResult> {
    const heartbeatAttempted = true; this.state.recordHeartbeat();
    if (!this.socket || !this.state.isConnected()) return { ok: false, state: this.getState(), heartbeatAttempted, writeAttempted: false, writeSuccess: false, error: 'LPC is not connected' };
    if (this.socket.destroyed || !this.socket.writable) { this.markStaleConnection('Stale LPC connection detected'); return { ok: false, state: this.getState(), heartbeatAttempted, writeAttempted: false, writeSuccess: false, error: 'Socket is destroyed or not writable' }; }
    const payload = this.options.heartbeatPayload; if (!payload) { this.refreshSocketFlags(); this.emitStatus(); return { ok: true, state: this.getState(), heartbeatAttempted, writeAttempted: false, writeSuccess: false }; }
    return new Promise((resolve) => { const timeout = setTimeout(() => { this.markStaleConnection('LPC heartbeat write timed out'); resolve({ ok: false, state: this.getState(), heartbeatAttempted, writeAttempted: true, writeSuccess: false, error: 'LPC heartbeat write timed out' }); }, this.options.heartbeatTimeoutMs); try { const written = this.safeWrite(this.socket, payload, 'heartbeat', (error) => { clearTimeout(timeout); if (error) { this.markStaleConnection(error.message); resolve({ ok: false, state: this.getState(), heartbeatAttempted, writeAttempted: true, writeSuccess: false, error: error.message }); return; } this.state.recordSuccessfulWrite(); this.refreshSocketFlags(); this.emitStatus(); resolve({ ok: true, state: this.getState(), heartbeatAttempted, writeAttempted: true, writeSuccess: true }); }); if (!written) { clearTimeout(timeout); resolve({ ok: false, state: this.getState(), heartbeatAttempted, writeAttempted: true, writeSuccess: false, error: 'Socket is not writable' }); } } catch (error) { clearTimeout(timeout); const message = error instanceof Error ? error.message : 'Heartbeat write failed'; this.markStaleConnection(message); resolve({ ok: false, state: this.getState(), heartbeatAttempted, writeAttempted: true, writeSuccess: false, error: message }); } });
  }

  private handleInterfaceSelection(text: string): void { if (!this.socket || this.interfaceSelected) return; const iface = this.currentInterfaceAttempt ?? this.options.preferredInterface; if (this.isUnavailableInterfaceText(text)) { void this.handleInterfaceAttemptFailed('unavailable'); return; } if (text.includes('TCP/IP INTERFACE SELECTION') || /Interface Connection\d+/.test(text)) { if (!this.interfaceSelectionSent) { console.log('[LPC] interface selection menu detected'); this.interfaceSelectionSent = this.safeWrite(this.socket, `${iface}\r\n`, 'interface_selection'); if (this.interfaceSelectionSent) { this.lastInterfaceAttempt = iface; console.log(`[LPC] interface selection sent interface=${iface}`); } } return; } if (text.includes(`Interface Connection ${iface} has been established`) || text.includes('TREE ROOT')) { this.socket.setTimeout(0); this.connecting = false; this.interfaceSelected = true; this.selectedInterface = iface; this.usingFallbackInterface = iface !== this.options.preferredInterface; this.lastInterfaceAttempts.push({ interface: iface, result: 'success', at: new Date().toISOString() }); this.lpcStatusCode = this.usingFallbackInterface ? 'LPC_CONNECTED_FALLBACK_INTERFACE' : null; this.operatorMessage = this.usingFallbackInterface ? `LPC połączony awaryjnie przez Interface ${iface}. Preferowany Interface ${this.options.preferredInterface} był niedostępny.` : null; this.state.setConnected(); this.startHeartbeat(); console.log(`[LPC] interface ${iface} selected`); if (this.usingFallbackInterface) console.warn(`[LPC] connected using fallback interface=${iface} preferred=${this.options.preferredInterface}`); const state = this.getState(); this.emit('connected', state); this.emit('status', state); } }
  private async handleInterfaceAttemptFailed(result: 'unavailable' | 'timeout' | 'failed'): Promise<void> { const iface = this.currentInterfaceAttempt ?? this.options.preferredInterface; this.lastInterfaceAttempts.push({ interface: iface, result, at: new Date().toISOString() }); this.lastInterfaceError = result; this.lastInterfaceErrorAt = new Date().toISOString(); this.lastInterfaceAttempt = iface; this.interfaceSelected = false; this.selectedInterface = null; this.streamingHealthy = false; if (result === 'unavailable') console.warn(`[LPC] interface ${iface} unavailable`); else console.warn(`[LPC] interface ${iface} selection ${result}`); console.warn(`[LPC] closing socket after ${result} interface=${iface}`); await this.closeCurrentAttemptSocket(); const next = this.getNextFallbackInterface(iface); if (next != null) { this.startSocketForInterface(next); return; } this.lpcStatusCode = 'LPC_NO_AVAILABLE_INTERFACE'; this.operatorMessage = 'Zresetuj LPC, następnie IPC.'; this.connecting = false; this.state.setDisconnected(true, false); console.error('[LPC] no available LPC interface'); console.error('[LPC] operator action required: reset LPC then IPC'); this.emit('disconnected', this.getState()); this.emitStatus(); }
  private async runStartupCleanup(): Promise<void> { this.startupCleanupDone = true; this.lastStartupCleanupAt = new Date().toISOString(); console.log(`[LPC] startup cleanup started interfaces=${this.options.startupCleanupInterfaces.join(',')}`); for (const iface of this.options.startupCleanupInterfaces) { if (![1, 2].includes(iface)) { this.lastStartupCleanupResult[String(iface)] = 'skipped'; continue; } console.log(`[LPC] cleanup try interface=${iface}`); try { const result = await this.cleanupInterface(iface); this.lastStartupCleanupResult[String(iface)] = result; } catch (error) { this.lastStartupCleanupResult[String(iface)] = 'failed'; console.warn(`[LPC] cleanup interface=${iface} failed`, error instanceof Error ? error.message : error); } } console.log(`[LPC] startup cleanup finished waitMs=${this.options.startupCleanupWaitMs}`); await sleep(this.options.startupCleanupWaitMs); }
  private cleanupInterface(iface: number): Promise<'success' | 'unavailable'> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.options.host, port: this.options.port });
      let buffer = '';
      let finished = false;
      let closing = false;
      let interfaceSelectionSent = false;
      const timeout = setTimeout(() => finish('timeout', new Error('cleanup interface selection timeout')), this.options.connectTimeoutMs);

      const noopErrorHandler = (error: Error) => console.warn(`[LPC] cleanup interface=${iface} socket error after finish message=${error.message}`);
      const gracefulClose = async (result: 'success' | 'failed' | 'timeout' | 'unavailable') => {
        console.log(`[LPC] cleanup interface=${iface} closing gracefully`);
        if (!socket.destroyed && !socket.writableEnded) socket.end();
        await sleep(this.options.gracefulCloseWaitMs);
        if (!socket.destroyed) socket.destroy();
        socket.removeAllListeners();
        console.log(`[LPC] cleanup interface=${iface} closed result=${result}`);
      };
      const finish = (result: 'success' | 'failed' | 'timeout' | 'unavailable', error?: Error) => {
        if (finished) return;
        finished = true;
        closing = true;
        clearTimeout(timeout);
        socket.removeAllListeners('data');
        socket.removeAllListeners('timeout');
        socket.removeAllListeners('close');
        socket.removeAllListeners('error');
        socket.on('error', noopErrorHandler);
        void gracefulClose(result).then(() => {
          socket.removeListener('error', noopErrorHandler);
          if (result === 'success' || result === 'unavailable') resolve(result);
          else reject(error ?? new Error(`cleanup interface ${iface} ${result}`));
        }, reject);
      };

      socket.setEncoding('utf8');
      socket.setTimeout(this.options.connectTimeoutMs);
      socket.on('timeout', () => finish('timeout', new Error('cleanup interface selection timeout')));
      socket.on('data', (chunk) => {
        if (finished || closing) return;
        buffer += chunk.toString();
        if (this.isUnavailableInterfaceText(buffer)) {
          console.warn(`[LPC] cleanup interface=${iface} unavailable`);
          finish('unavailable');
          return;
        }
        if (buffer.includes(`Interface Connection ${iface} has been established`) || buffer.includes('TREE ROOT')) {
          console.log(`[LPC] cleanup interface=${iface} established`);
          finish('success');
          return;
        }
        if (!interfaceSelectionSent && (buffer.includes('TCP/IP INTERFACE SELECTION') || /Interface Connection1/.test(buffer))) {
          console.log(`[LPC] cleanup interface=${iface} selection menu detected`);
          interfaceSelectionSent = this.safeWrite(socket, `${iface}\r\n`, `startup_cleanup_interface_${iface}`, () => undefined);
          if (interfaceSelectionSent) console.log(`[LPC] cleanup interface=${iface} selection sent`);
        }
      });
      socket.on('error', (error: NodeJS.ErrnoException) => {
        console.warn(`[LPC] cleanup interface=${iface} socket error code=${error.code ?? 'unknown'} message=${error.message}`);
        finish('failed', error);
      });
      socket.on('close', () => {
        if (!finished) finish('failed', new Error('cleanup socket closed before interface selection completed'));
      });
    });
  }

  private safeWrite(socket: net.Socket | null, data: string | Buffer, context: string, callback?: (error?: Error | null) => void): boolean {
    if (!socket || socket.destroyed || !socket.writable || socket.writableEnded || ('closed' in socket && socket.closed) || this.disconnecting) {
      console.warn(`[LPC] skip write context=${context} reason=socket_not_writable`);
      return false;
    }
    try {
      return socket.write(data, callback);
    } catch (error) {
      console.warn(`[LPC] skip write context=${context} reason=${error instanceof Error ? error.message : 'write_failed'}`);
      return false;
    }
  }

  private async closeCurrentAttemptSocket(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.removeAllListeners('data');
    socket.removeAllListeners('timeout');
    socket.removeAllListeners('error');
    socket.removeAllListeners('close');
    try {
      if (!socket.destroyed && !socket.writableEnded) socket.end();
      await sleep(this.options.gracefulCloseWaitMs);
      if (!socket.destroyed) socket.destroy();
    } catch {
      if (!socket.destroyed) socket.destroy();
    } finally {
      socket.removeAllListeners();
    }
  }

  private getFallbackInterfacesForRound(): number[] {
    const configured = this.options.fallbackEnabled ? this.options.fallbackInterfaces : [this.options.preferredInterface];
    const ordered = [this.options.preferredInterface, ...configured].filter((iface) => Number.isInteger(iface) && iface >= 1 && iface <= 4);
    return [...new Set(ordered)];
  }

  private getNextFallbackInterface(current: number): number | null {
    const currentIndex = this.fallbackInterfacesForRound.indexOf(current);
    return currentIndex >= 0 ? this.fallbackInterfacesForRound[currentIndex + 1] ?? null : null;
  }

  private isUnavailableInterfaceText(text: string): boolean {
    return text.toLowerCase().includes('you have selected an unavailable interface connection');
  }

  private processIncomingText(text: string): void { this.receiveBuffer += text; this.clearResidualLineTimer(); let delimiter = this.findLineDelimiterIndex(); while (delimiter >= 0) { const line = this.receiveBuffer.slice(0, delimiter); const delimiterLength = this.receiveBuffer[delimiter] === '\r' && this.receiveBuffer[delimiter + 1] === '\n' ? 2 : 1; this.receiveBuffer = this.receiveBuffer.slice(delimiter + delimiterLength); if ((line || delimiter !== 0) && !this.isLpcMenuNoise(line)) this.emit('line', line); delimiter = this.findLineDelimiterIndex(); } if (this.receiveBuffer && this.looksLikeCompleteLpcFrame(this.receiveBuffer)) this.residualLineTimer = setTimeout(() => this.flushResidualLineIfComplete(), 25); }
  private findLineDelimiterIndex(): number { const newlineIndex = this.receiveBuffer.indexOf('\n'); const carriageReturnIndex = this.receiveBuffer.indexOf('\r'); if (newlineIndex < 0) return carriageReturnIndex; if (carriageReturnIndex < 0) return newlineIndex; return Math.min(newlineIndex, carriageReturnIndex); }
  private looksLikeCompleteLpcFrame(text: string): boolean { const normalized = text.replace(/\t/g, ' ').replace(/→/g, ' ').replace(/ +/g, ' ').trim(); const streamFrame = /^\S+\s+S\s+C\d{2},P\d{2},[^,]+,ET\s+[-+]?\d+(?:[.,]\d+)?\s+sec,T\s+[-+]?\d+(?:[.,]\d+)?\s+sec,P\s+[-+]?\d+(?:[.,]\d+)?\s+\S+$/; const resultFrame = /^(?:(\S+)\s+([A-Z])\s+)?C\d{2}\s+N\d+\s+P\d{2}\s+\S+\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+\d{2}\/\d{2}\/\d{2}\s+\d+/; return streamFrame.test(normalized) || resultFrame.test(normalized); }
  private flushResidualLineIfComplete(): void { this.clearResidualLineTimer(); if (!this.receiveBuffer || !this.looksLikeCompleteLpcFrame(this.receiveBuffer)) return; const line = this.receiveBuffer; this.receiveBuffer = ''; if (!this.isLpcMenuNoise(line)) this.emit('line', line); }
  private isLpcMenuNoise(line: string): boolean {
    const withoutControl = line.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '');
    const normalized = withoutControl.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
    if (!normalized) return true;
    if (this.looksLikePossibleLpcDataFrame(normalized)) return false;
    return /^[?*.\-\s]+$/.test(withoutControl)
      || /^[1-4]$/.test(normalized)
      || normalized.includes('TCP/IP INTERFACE SELECTION')
      || normalized.includes('Select from the following available connections')
      || normalized.includes('You have selected an unavailable Interface connection')
      || normalized.includes('Interface Connection')
      || normalized.includes('TREE ROOT')
      || normalized.includes('CONTROLLER')
      || /^<I\\?>: Global config$/i.test(normalized)
      || /^<C\\?>: Channel config$/i.test(normalized)
      || /^<P#\\?>: Part config menu$/i.test(normalized)
      || /^<T#\\?>: Result data$/i.test(normalized)
      || /^<A#\\?>: Autosetup$/i.test(normalized)
      || /^<M\\?>: Module menu$/i.test(normalized)
      || /^<U\\?>: Update Firmware$/i.test(normalized)
      || normalized.startsWith('VAR>:')
      || normalized.startsWith('VAR?:')
      || normalized.includes('VER: Display Version Number')
      || normalized.includes('Dir: Display Current Branch')
      || normalized === 'Help: Help';
  }
  private looksLikePossibleLpcDataFrame(line: string): boolean { return /\b[SR]\s+C\d{2}[,\s]/.test(line) || /\bC\d{2}\s+N?\d*\s*P\d{2}\b/.test(line); }
  private clearResidualLineTimer(): void { if (!this.residualLineTimer) return; clearTimeout(this.residualLineTimer); this.residualLineTimer = null; }
  private clearStreamWatchdog(): void { if (!this.streamWatchdogTimer) return; clearTimeout(this.streamWatchdogTimer); this.streamWatchdogTimer = null; }
  private startHeartbeat(): void { this.stopHeartbeat(); if (!this.options.heartbeatEnabled) return; this.heartbeatTimer = setInterval(() => { void this.performHeartbeatCheck(); }, this.options.heartbeatIntervalMs); }
  private stopHeartbeat(): void { if (!this.heartbeatTimer) return; clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  private markStaleConnection(message: string): void { this.state.setStaleConnectionDetected(message || 'Stale LPC connection detected'); this.emit('error', new Error(message || 'Stale LPC connection detected'), this.getState()); this.emitStatus(); this.destroySocket(); }
  private destroySocket(): void { this.clearResidualLineTimer(); this.clearStreamWatchdog(); if (!this.socket) return; this.socket.destroy(); this.socket = null; }
  private scheduleReconnect(): void { if (this.reconnectTimer || this.socket || this.connecting) return; const nextReconnectAt = new Date(Date.now() + this.options.reconnectDelayMs).toISOString(); this.state.setReconnecting(nextReconnectAt); this.emit('reconnecting', this.getState()); this.emitStatus(); this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.socket = null; this.connecting = false; void this.connect(); }, this.options.reconnectDelayMs); }
  private clearReconnectTimer(): void { if (!this.reconnectTimer) return; clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  private refreshSocketFlags(): void { if (!this.socket) { this.state.updateSocketFlags(true, false); return; } this.state.updateSocketFlags(this.socket.destroyed, this.socket.writable); }
  private emitStatus(): void { this.emit('status', this.getState()); }
}
