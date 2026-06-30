import net from 'node:net';

export interface LpcPortCheckResult {
  ok: true;
  host: string;
  port: number;
  reachable: boolean;
  latencyMs: number;
  error?: string;
}

export function checkLpcPort(host: string, port: number, timeoutMs: number): Promise<LpcPortCheckResult> {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result: Omit<LpcPortCheckResult, 'ok' | 'host' | 'port' | 'latencyMs'>) => {
      if (settled) return;
      settled = true;
      const latencyMs = Date.now() - startedAt;
      socket.destroy();
      resolve({ ok: true, host, port, latencyMs, ...result });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ reachable: true }));
    socket.once('timeout', () => finish({ reachable: false, error: `connect ETIMEDOUT ${host}:${port}` }));
    socket.once('error', (error) => finish({ reachable: false, error: error.message }));
    socket.connect(port, host);
  });
}
