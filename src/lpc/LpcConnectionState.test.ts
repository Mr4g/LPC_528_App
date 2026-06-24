import { describe, expect, it } from 'vitest';
import { LpcConnectionState } from './LpcConnectionState';

const options = {
  host: 'example.local',
  port: 23,
  autoConnect: false,
  reconnectEnabled: true,
  reconnectDelayMs: 15000,
  connectTimeoutMs: 5000,
  heartbeatEnabled: true,
  heartbeatIntervalMs: 5000,
  heartbeatTimeoutMs: 12000,
  staleConnectionTimeoutMs: 15000,
  heartbeatPayload: '',
};

describe('LpcConnectionState', () => {
  it('moves through connecting, connected, error, reconnecting and disconnected states', () => {
    const state = new LpcConnectionState(options);

    expect(state.getSnapshot()).toMatchObject({ status: 'idle', connected: false, ...options });

    state.setConnecting();
    expect(state.getSnapshot()).toMatchObject({ status: 'connecting', connected: false, socketDestroyed: false });
    expect(state.getSnapshot().lastConnectionAttemptAt).not.toBeNull();

    state.setConnected();
    expect(state.getSnapshot()).toMatchObject({ status: 'connected', connected: true, socketWritable: true, lastError: null });

    state.recordDataReceived();
    state.recordHeartbeat();
    state.recordSuccessfulWrite();
    expect(state.getSnapshot().lastDataReceivedAt).not.toBeNull();
    expect(state.getSnapshot().lastHeartbeatAt).not.toBeNull();
    expect(state.getSnapshot().lastSuccessfulWriteAt).not.toBeNull();

    state.setError('connect ETIMEDOUT example.local:23');
    expect(state.getSnapshot()).toMatchObject({ status: 'error', connected: false, lastError: 'connect ETIMEDOUT example.local:23' });

    state.setReconnecting('2026-06-24T10:00:15.000Z');
    expect(state.getSnapshot()).toMatchObject({ status: 'reconnecting', connected: false, reconnectAttemptCount: 1, nextReconnectAt: '2026-06-24T10:00:15.000Z' });

    state.setStaleConnectionDetected();
    expect(state.getSnapshot()).toMatchObject({ status: 'error', connected: false, lastError: 'Stale LPC connection detected' });
    expect(state.getSnapshot().staleConnectionDetectedAt).not.toBeNull();

    state.setDisconnected();
    expect(state.getSnapshot()).toMatchObject({ status: 'disconnected', connected: false, socketDestroyed: true });
  });
});
