import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LpcTcpClient, type LpcTcpClientOptions } from './LpcTcpClient';

function options(port: number): LpcTcpClientOptions {
  return {
    host: '127.0.0.1',
    port,
    autoConnect: false,
    reconnectEnabled: true,
    reconnectDelayMs: 15000,
    connectTimeoutMs: 5000,
    heartbeatEnabled: false,
    heartbeatIntervalMs: 5000,
    heartbeatTimeoutMs: 12000,
    staleConnectionTimeoutMs: 15000,
    heartbeatPayload: '',
  };
}

async function listen(server: net.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server did not expose a TCP address');
  return address.port;
}

describe('LpcTcpClient', () => {
  let server: net.Server | null = null;

  afterEach(() => {
    server?.close();
    server = null;
  });

  it('sets connected=true only after the socket connect event', async () => {
    server = net.createServer();
    const port = await listen(server);
    const client = new LpcTcpClient(options(port));

    client.connect();
    expect(client.getState().connected).toBe(false);

    await new Promise<void>((resolve) => client.once('connected', () => resolve()));
    expect(client.getState()).toMatchObject({ status: 'connected', connected: true });
    client.disconnect();
  });

  it('marks stale connection when connected socket is not writable', async () => {
    server = net.createServer();
    const port = await listen(server);
    const client = new LpcTcpClient(options(port));

    client.connect();
    await new Promise<void>((resolve) => client.once('connected', () => resolve()));
    server.close();
    client.disconnect();
    expect(client.getState().connected).toBe(false);
  });

  it('schedules reconnect with nextReconnectAt after close', async () => {
    server = net.createServer((socket) => socket.destroy());
    const port = await listen(server);
    const client = new LpcTcpClient(options(port));

    const reconnecting = new Promise<void>((resolve) => client.once('reconnecting', () => resolve()));
    client.connect();
    await reconnecting;
    expect(client.getState().connected).toBe(false);
    expect(client.getState().nextReconnectAt).not.toBeNull();
    client.disconnect();
  });
});

describe('LpcTcpClient line splitting', () => {
  it('splits one packet containing two LF lines', () => {
    const client = new LpcTcpClient(options(23));
    const lines: string[] = [];
    client.on('line', (line) => lines.push(line));

    client.receiveTextForTest('first\nsecond\n');

    expect(lines).toEqual(['first', 'second']);
  });

  it('keeps a partial line until the next packet arrives', () => {
    const client = new LpcTcpClient(options(23));
    const lines: string[] = [];
    client.on('line', (line) => lines.push(line));

    client.receiveTextForTest('first ');
    client.receiveTextForTest('line\n');

    expect(lines).toEqual(['first line']);
  });

  it('splits CRLF lines', () => {
    const client = new LpcTcpClient(options(23));
    const lines: string[] = [];
    client.on('line', (line) => lines.push(line));

    client.receiveTextForTest('first\r\nsecond\r\n');

    expect(lines).toEqual(['first', 'second']);
  });

  it('splits CR-only lines', () => {
    const client = new LpcTcpClient(options(23));
    const lines: string[] = [];
    client.on('line', (line) => lines.push(line));

    client.receiveTextForTest('first\rsecond\r');

    expect(lines).toEqual(['first', 'second']);
  });

  it('flushes a complete stream frame even when LPC does not send a line delimiter', () => {
    const client = new LpcTcpClient(options(23));
    const lines: string[] = [];
    client.on('line', (line) => lines.push(line));

    client.receiveTextForTest('9369034 S C01,P01,PRF,ET 5.20 sec,T 19.80 sec,P -0.00011 bar');
    client.flushBufferedLineForTest();

    expect(lines).toEqual(['9369034 S C01,P01,PRF,ET 5.20 sec,T 19.80 sec,P -0.00011 bar']);
  });

  it('does not flush incomplete buffered text as an LPC frame', () => {
    const client = new LpcTcpClient(options(23));
    const lines: string[] = [];
    client.on('line', (line) => lines.push(line));

    client.receiveTextForTest('9369034 S C01,P01,PRF,ET');
    client.flushBufferedLineForTest();

    expect(lines).toEqual([]);
  });
});
