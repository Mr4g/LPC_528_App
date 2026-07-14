import { EventEmitter } from 'node:events';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdminWindowsRouter, requestWindowsLogout, type SpawnLogoutProcess } from './adminWindowsRouter';
import type { AuthUser } from './auth/types';

function createFakeChild() {
  const child = new EventEmitter() as ReturnType<SpawnLogoutProcess>;
  return child;
}

describe('admin Windows logout', () => {
  afterEach(() => vi.restoreAllMocks());

  it('denies access for non-admin users', async () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as typeof req & { user: AuthUser }).user = { id: 'op-1', login: 'OPR', role: 'operator' };
      next();
    });
    app.use('/api/admin/windows', createAdminWindowsRouter({ platform: 'win32' }));

    const server = app.listen(0);
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not expose a port');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/windows/logout`, { method: 'POST' });
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'FORBIDDEN' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('spawns shutdown.exe with /l on Windows', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const spawnProcess: SpawnLogoutProcess = (command, args) => {
      calls.push({ command, args });
      const child = createFakeChild();
      queueMicrotask(() => child.emit('spawn'));
      return child;
    };

    await expect(requestWindowsLogout('ADM', { platform: 'win32', spawnProcess, logger: console })).resolves.toEqual({ ok: true });
    expect(calls).toEqual([{ command: 'shutdown.exe', args: ['/l'] }]);
  });

  it('rejects non-Windows platforms without spawning a process', async () => {
    const spawnProcess = vi.fn<SpawnLogoutProcess>();
    await expect(requestWindowsLogout('ADM', { platform: 'linux', spawnProcess })).resolves.toMatchObject({ ok: false, status: 400, error: 'WINDOWS_ONLY' });
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('returns an error when the logout process cannot start', async () => {
    const spawnProcess: SpawnLogoutProcess = () => {
      const child = createFakeChild();
      queueMicrotask(() => child.emit('error', new Error('spawn failed')));
      return child;
    };
    const logger = { info: vi.fn(), error: vi.fn() };

    await expect(requestWindowsLogout('ADM', { platform: 'win32', spawnProcess, logger })).resolves.toMatchObject({ ok: false, status: 500, error: 'WINDOWS_LOGOUT_FAILED' });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('spawn failed'));
  });
});
