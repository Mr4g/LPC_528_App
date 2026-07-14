import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Router } from 'express';
import { requireRole, type AuthenticatedRequest } from './auth/authMiddleware';

export type SpawnLogoutProcess = (command: 'shutdown.exe', args: ['/l']) => ChildProcessWithoutNullStreams;

export interface WindowsLogoutDependencies {
  platform?: NodeJS.Platform;
  spawnProcess?: SpawnLogoutProcess;
  now?: () => Date;
  logger?: Pick<Console, 'info' | 'error'>;
}

export type WindowsLogoutResult =
  | { ok: true }
  | { ok: false; status: number; error: string; message: string };

export function requestWindowsLogout(adminLogin: string, dependencies: WindowsLogoutDependencies = {}): Promise<WindowsLogoutResult> {
  const platform = dependencies.platform ?? process.platform;
  const logger = dependencies.logger ?? console;
  const now = dependencies.now ?? (() => new Date());
  const spawnProcess = dependencies.spawnProcess ?? spawn;

  if (platform !== 'win32') {
    return Promise.resolve({
      ok: false,
      status: 400,
      error: 'WINDOWS_ONLY',
      message: 'Wylogowanie użytkownika Windows jest dostępne tylko na systemie Windows.',
    });
  }

  logger.info(`[ADMIN] ${now().toISOString()} admin=${adminLogin} Windows logout requested`);

  return new Promise((resolve) => {
    let settled = false;

    const finish = (result: WindowsLogoutResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      const child = spawnProcess('shutdown.exe', ['/l']);
      child.once('error', (error) => {
        logger.error(`[ADMIN] Windows logout failed admin=${adminLogin}: ${error.message}`);
        finish({ ok: false, status: 500, error: 'WINDOWS_LOGOUT_FAILED', message: 'Nie można uruchomić polecenia wylogowania Windows.' });
      });
      child.once('spawn', () => finish({ ok: true }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[ADMIN] Windows logout failed admin=${adminLogin}: ${message}`);
      finish({ ok: false, status: 500, error: 'WINDOWS_LOGOUT_FAILED', message: 'Nie można uruchomić polecenia wylogowania Windows.' });
    }
  });
}

export function createAdminWindowsRouter(dependencies: WindowsLogoutDependencies = {}): Router {
  const router = Router();
  router.use(requireRole(['admin']));

  router.post('/logout', async (req: AuthenticatedRequest, res) => {
    const result = await requestWindowsLogout(req.user?.login ?? 'unknown', dependencies);
    if (!result.ok) return res.status(result.status).json({ ok: false, error: result.error, message: result.message });
    return res.json({ ok: true });
  });

  return router;
}
