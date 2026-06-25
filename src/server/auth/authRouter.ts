import { Router } from 'express';
import type { AuthService } from './authService';
import { clearSessionCookie, getAuthCookieOptions, setSessionCookie, type AuthenticatedRequest } from './authMiddleware';
import { normalizeOperatorLogin, validateOperatorLogin } from './operatorLogin';

export interface AuthRouterOptions {
  dbPath: string;
  defaultAdminLogin: string;
  nodeEnv: string;
  authDebug: boolean;
  resetDefaultAdmin: boolean;
}

export function createAuthRouter(authService: AuthService, options: AuthRouterOptions): Router {
  const router = Router();

  router.post('/login', (req, res) => {
    const login = typeof req.body?.login === 'string' ? normalizeOperatorLogin(req.body.login.trim()) : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!validateOperatorLogin(login) || password.length < 4) {
      return res.status(401).json({ ok: false, error: 'Nieprawidłowy login lub hasło' });
    }

    const result = authService.loginDetailed(login, password);
    if (!result.ok) {
      const error = result.reason === 'INACTIVE' ? 'Użytkownik jest nieaktywny' : 'Nieprawidłowy login lub hasło';
      return res.status(401).json({ ok: false, error });
    }

    setSessionCookie(res, authService.createSession(result.user));
    return res.json({ ok: true, user: result.user });
  });

  router.post('/logout', (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  router.get('/me', (req: AuthenticatedRequest, res) => {
    res.json({ ok: true, user: req.user ?? null });
  });

  router.get('/debug', (_req, res) => {
    if (options.nodeEnv === 'production' && !options.authDebug) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    }
    const stats = authService.getDbStats();
    const cookie = getAuthCookieOptions();
    return res.json({
      ok: true,
      dbPath: options.dbPath,
      dbExists: stats.dbExists,
      usersTableExists: stats.usersTableExists,
      usersCount: stats.usersCount,
      activeUsersCount: stats.activeUsersCount,
      adminUsersCount: stats.adminUsersCount,
      activeAdminUsersCount: stats.activeAdminUsersCount,
      users: stats.users,
      defaultAdminLogin: normalizeOperatorLogin(options.defaultAdminLogin),
      cookieName: cookie.name,
      cookieSecure: cookie.secure,
      sameSite: cookie.sameSite,
      resetDefaultAdmin: options.resetDefaultAdmin,
    });
  });

  return router;
}
