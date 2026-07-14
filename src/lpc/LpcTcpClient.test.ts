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
    preferredInterface: 1,
    fallbackEnabled: false,
    fallbackInterfaces: [1, 2, 3, 4],
    startupCleanupEnabled: false,
    startupCleanupInterfaces: [1, 2],
    startupCleanupWaitMs: 2500,
    gracefulCloseWaitMs: 10,
    streamWatchdogMs: 5000,
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

  it('sets connected=true only after Interface 1 selection is confirmed', async () => {
    server = net.createServer((socket) => {
      socket.write('TCP/IP INTERFACE SELECTION\r\n1 Interface Connection1\r\n');
      socket.on('data', () => socket.write('* Interface Connection 1 has been established *\r\n'));
    });
    const port = await listen(server);
    const client = new LpcTcpClient(options(port));

    client.connect();
    expect(client.getState().connected).toBe(false);

    await new Promise<void>((resolve) => client.once('connected', () => resolve()));
    expect(client.getState()).toMatchObject({ status: 'connected', connected: true });
    client.disconnect();
  });

  it('marks stale connection when connected socket is not writable', async () => {
    server = net.createServer((socket) => {
      socket.write('TCP/IP INTERFACE SELECTION\r\n1 Interface Connection1\r\n');
      socket.on('data', () => socket.write('* Interface Connection 1 has been established *\r\n'));
    });
    const port = await listen(server);
    const client = new LpcTcpClient(options(port));

    client.connect();
    await new Promise<void>((resolve) => client.once('connected', () => resolve()));
    server.close();
    client.disconnect();
    expect(client.getState().connected).toBe(false);
  });

  it('runs startup cleanup once per interface even when LPC repeats established text', async () => {
    let connectionCount = 0;
    const selectionWrites: string[] = [];
    server = net.createServer((socket) => {
      connectionCount += 1;
      socket.write('TCP/IP INTERFACE SELECTION\r\n1 Interface Connection1\r\n');
      socket.on('data', (chunk) => {
        selectionWrites.push(chunk.toString());
        socket.write('* Interface Connection 1 has been established *\r\n* Interface Connection 1 has been established *\r\n');
      });
    });
    const port = await listen(server);
    const client = new LpcTcpClient({
      ...options(port),
      startupCleanupEnabled: true,
      startupCleanupInterfaces: [1],
      startupCleanupWaitMs: 0,
    });

    await client.connect();
    await new Promise<void>((resolve) => client.once('connected', () => resolve()));

    expect(connectionCount).toBe(2);
    expect(selectionWrites).toHaveLength(2);
    expect(client.getState().lastStartupCleanupResult).toMatchObject({ 1: 'success' });
    await client.disconnectGracefully('test_shutdown');
  });

  it('sends the preferred interface only once when the selection menu repeats in one connection attempt', async () => {
    const selectionWrites: string[] = [];
    server = net.createServer((socket) => {
      socket.write('TCP/IP INTERFACE SELECTION\r\n');
      socket.write('TCP/IP INTERFACE SELECTION\r\n');
      socket.on('data', (chunk) => {
        selectionWrites.push(chunk.toString());
      });
    });
    const port = await listen(server);
    const client = new LpcTcpClient({ ...options(port), reconnectEnabled: false });

    await client.connect();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(selectionWrites).toEqual(['1\r\n']);
    await client.disconnectGracefully('test_shutdown');
  });

  it('marks the interface unavailable and closes without another interface write', async () => {
    const selectionWrites: string[] = [];
    server = net.createServer((socket) => {
      socket.write('TCP/IP INTERFACE SELECTION\r\n');
      socket.on('data', (chunk) => {
        selectionWrites.push(chunk.toString());
        socket.write('* You have selected an unavailable Interface connection *\r\nTCP/IP INTERFACE SELECTION\r\n');
      });
    });
    const port = await listen(server);
    const client = new LpcTcpClient({ ...options(port), reconnectEnabled: false });
    const disconnected = new Promise<void>((resolve) => client.once('disconnected', () => resolve()));

    await client.connect();
    await disconnected;

    expect(selectionWrites).toEqual(['1\r\n']);
    expect(client.getState()).toMatchObject({
      lpcStatusCode: 'LPC_NO_AVAILABLE_INTERFACE',
      interfaceSelected: false,
      selectedInterface: null,
      lastInterfaceError: 'unavailable',
      lastInterfaceAttempt: 1,
    });
  });

  it('falls back to Interface 2 when Interface 1 is unavailable', async () => {
    const selectionWrites: string[] = [];
    server = net.createServer((socket) => {
      socket.write('TCP/IP INTERFACE SELECTION\r\n');
      socket.on('data', (chunk) => {
        const selected = chunk.toString();
        selectionWrites.push(selected);
        if (selected === '1\r\n') socket.write('* You have selected an unavailable Interface connection *\r\n');
        if (selected === '2\r\n') socket.write('* Interface Connection 2 has been established *\r\n');
      });
    });
    const port = await listen(server);
    const client = new LpcTcpClient({ ...options(port), fallbackEnabled: true, fallbackInterfaces: [1, 2, 3, 4] });

    await client.connect();
    await new Promise<void>((resolve) => client.once('connected', () => resolve()));

    expect(selectionWrites).toEqual(['1\r\n', '2\r\n']);
    expect(client.getState()).toMatchObject({
      selectedInterface: 2,
      usingFallbackInterface: true,
      lpcStatusCode: 'LPC_CONNECTED_FALLBACK_INTERFACE',
    });
    await client.disconnectGracefully('test_shutdown');
  });

  it('sets LPC_NO_AVAILABLE_INTERFACE when every fallback interface is unavailable', async () => {
    const selectionWrites: string[] = [];
    server = net.createServer((socket) => {
      socket.write('TCP/IP INTERFACE SELECTION\r\n');
      socket.on('data', (chunk) => {
        selectionWrites.push(chunk.toString());
        socket.write('* You have selected an unavailable Interface connection *\r\n');
      });
    });
    const port = await listen(server);
    const client = new LpcTcpClient({ ...options(port), fallbackEnabled: true, fallbackInterfaces: [1, 2, 3, 4] });
    const disconnected = new Promise<void>((resolve) => client.once('disconnected', () => resolve()));

    await client.connect();
    await disconnected;

    expect(selectionWrites).toEqual(['1\r\n', '2\r\n', '3\r\n', '4\r\n']);
    expect(client.getState()).toMatchObject({
      selectedInterface: null,
      interfaceSelected: false,
      lpcStatusCode: 'LPC_NO_AVAILABLE_INTERFACE',
      operatorMessage: 'Zresetuj LPC, następnie IPC.',
    });
    const startGate = client.canStartTest();
    expect(startGate.ok).toBe(false);
    if (!startGate.ok) expect(startGate.message).toContain('Zresetuj LPC, następnie IPC');
  });

  it('continues startup cleanup with the next interface when one cleanup interface is unavailable', async () => {
    let connectionCount = 0;
    server = net.createServer((socket) => {
      connectionCount += 1;
      socket.write('TCP/IP INTERFACE SELECTION\r\n');
      socket.on('data', () => {
        if (connectionCount === 1) socket.write('* You have selected an unavailable Interface connection *\r\n');
        else socket.write(`* Interface Connection ${connectionCount === 2 ? 2 : 1} has been established *\r\n`);
      });
    });
    const port = await listen(server);
    const client = new LpcTcpClient({
      ...options(port),
      startupCleanupEnabled: true,
      startupCleanupInterfaces: [1, 2],
      startupCleanupWaitMs: 0,
    });

    await client.connect();
    await new Promise<void>((resolve) => client.once('connected', () => resolve()));

    expect(client.getState().lastStartupCleanupResult).toMatchObject({ 1: 'unavailable', 2: 'success' });
    await client.disconnectGracefully('test_shutdown');
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

  it('filters multi-line LPC menu chunks before emitting parser pipeline lines', () => {
    const client = new LpcTcpClient(options(23));
    const lines: string[] = [];
    client.on('line', (line) => lines.push(line));

    client.receiveTextForTest('??????\r\n*************************************************************************\r\n* TCP/IP INTERFACE SELECTION *\r\n*************************************************************************\r\n*\r\n*Select from the following available connections..enter connection number\r\n* 1 Interface Connection1 *\r\n* 2 Interface Connection2 *\r\n1\r\n* Interface Connection 1 has been established *\r\n*************************************************************************\r\n* TREE ROOT CONTROLLER *\r\n*************************************************************************\r\n* <I\\>: Global config *\r\nB89C045 S C01,P17,DPT,ET 54.65 sec,T 1.35 sec,P 5.990978 bar,RL 3.788533 pa/s\r\nBD2A0D2 R C01 P17 15:58:45.620 07/03/26 0000294001 A - DPT P RL 2.664816 pa/s Pt 5.989275 bar\r\n');

    expect(lines).toEqual([
      'B89C045 S C01,P17,DPT,ET 54.65 sec,T 1.35 sec,P 5.990978 bar,RL 3.788533 pa/s',
      'BD2A0D2 R C01 P17 15:58:45.620 07/03/26 0000294001 A - DPT P RL 2.664816 pa/s Pt 5.989275 bar',
    ]);
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
