import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { checkLpcPort } from './checkLpcPort';

let server: net.Server | null = null;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
});

describe('checkLpcPort', () => {
  it('reports reachable true for an open TCP port', async () => {
    server = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

    const result = await checkLpcPort('127.0.0.1', address.port, 1000);

    expect(result.reachable).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports reachable false for a closed TCP port', async () => {
    const result = await checkLpcPort('127.0.0.1', 1, 200);

    expect(result.reachable).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
