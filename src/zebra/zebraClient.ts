import net from 'node:net';

export interface ZebraClientOptions { host: string; port: number; timeoutMs: number; }

export class ZebraClient {
  constructor(private readonly options: ZebraClientOptions) {}

  sendZpl(zpl: string): Promise<{ ok: true; bytes: number } | { ok: false; error: string }> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let finished = false;
      const finish = (result: { ok: true; bytes: number } | { ok: false; error: string }) => {
        if (finished) return;
        finished = true;
        socket.removeAllListeners();
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(this.options.timeoutMs);
      socket.once('timeout', () => finish({ ok: false, error: `Timeout po ${this.options.timeoutMs} ms` }));
      socket.once('error', (error) => finish({ ok: false, error: error.message }));
      socket.connect(this.options.port, this.options.host, () => {
        const payload = Buffer.from(zpl, 'utf8');
        socket.write(payload, (error) => {
          if (error) return finish({ ok: false, error: error.message });
          socket.end(() => finish({ ok: true, bytes: payload.length }));
        });
      });
    });
  }
}
