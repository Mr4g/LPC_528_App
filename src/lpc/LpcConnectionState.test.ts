import { describe, expect, it } from 'vitest';
import { LpcConnectionState } from './LpcConnectionState';

const options = {
  host: 'example.local',
  port: 23,
  autoConnect: false,
  reconnectEnabled: true,
  reconnectDelayMs: 3000,
  connectTimeoutMs: 5000,
};

describe('LpcConnectionState', () => {
  it('moves through connecting, connected, error, reconnecting and disconnected states', () => {
    const state = new LpcConnectionState(options);

    expect(state.getSnapshot()).toMatchObject({ status: 'idle', connected: false, ...options });

    state.setConnecting();
    expect(state.getSnapshot()).toMatchObject({ status: 'connecting', connected: false, socketDestroyed: false });
    expect(state.getSnapshot().lastConnectionAttemptAt).not.toBeNull();

    state.setConnected();
    expect(state.getSnapshot()).toMatchObject({ status: 'connected', connected: true, lastError: null });

    state.setError('connect ETIMEDOUT example.local:23');
    expect(state.getSnapshot()).toMatchObject({ status: 'error', connected: false, lastError: 'connect ETIMEDOUT example.local:23' });

    state.setReconnecting();
    expect(state.getSnapshot()).toMatchObject({ status: 'reconnecting', connected: false, reconnectAttemptCount: 1 });

    state.setDisconnected();
    expect(state.getSnapshot()).toMatchObject({ status: 'disconnected', connected: false, socketDestroyed: true });
  });
});
