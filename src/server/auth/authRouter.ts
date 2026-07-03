import { Router } from 'express';
import type { AuthService } from './authService';
import type { TestSessionManager } from '../test-session/testSessionManager';
import { clearSessionCookie, getAuthCookieOptions, setSessionCookie, type AuthenticatedRequest } from './authMiddleware';
import { normalizeOperatorLogin, validateOperatorLogin } from './operatorLogin';

export interface AuthRouterOptions {
  dbPath: string;
  defaultAdminLogin: string;
  nodeEnv: string;
  authDebug: boolean;
  resetDefaultAdmin: boolean;
  cardLoginEnabled: boolean;
  testSessionManager?: TestSessionManager;
  testIdleLogoutMinutes: number;
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

  router.post('/card-login', (req, res) => {
    if (!options.cardLoginEnabled) return res.status(404).json({ ok: false, error: 'CARD_LOGIN_DISABLED', message: 'Logowanie kartą jest wyłączone.' });
    const cardUid = typeof req.body?.cardUid === 'string' ? req.body.cardUid : '';
    const result = authService.loginByCard(cardUid);
    if (!result.ok) return res.status(401).json({ ok: false, error: result.reason, message: 'Nieznana karta. Przyłóż przypisaną kartę lub zaloguj hasłem.' });
    setSessionCookie(res, authService.createSession(result.user));
    return res.json({ ok: true, user: result.user });
  });

  router.post('/card-action', (req: AuthenticatedRequest, res) => {
    if (!options.cardLoginEnabled) return res.status(404).json({ ok: false, error: 'CARD_LOGIN_DISABLED', message: 'Logowanie kartą jest wyłączone.' });
    const cardUid = typeof req.body?.cardUid === 'string' ? req.body.cardUid : '';
    const result = authService.handleCardAction(cardUid, req.user, options.testSessionManager?.getStatus().locked ?? false);
    if (req.user && !options.testSessionManager?.getStatus().locked) authService.markTestActivity(req.user.id);
    if (!result.ok) return res.status(result.action === 'TEST_IN_PROGRESS' ? 409 : 404).json({ ok: false, action: result.action, message: result.message });
    if (result.action === 'LOGGED_OUT') {
      clearSessionCookie(res);
      return res.json({ ok: true, action: result.action, message: result.message, user: null });
    }
    if (result.user) setSessionCookie(res, authService.createSession(result.user));
    return res.json({ ok: true, action: result.action, message: result.message, user: result.user });
  });

  router.post('/logout', (req: AuthenticatedRequest, res) => {
    if (options.testSessionManager?.getStatus().locked) return res.status(409).json({ ok: false, error: 'TEST_IN_PROGRESS', message: 'Nie można wylogować operatora podczas trwania testu.' });
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  router.get('/me', (req: AuthenticatedRequest, res) => {
    if (req.user) authService.markTestActivity(req.user.id);
    res.json({ ok: true, user: req.user ?? null, idleLogoutMinutes: options.testIdleLogoutMinutes });
  });

  router.post('/activity', (req: AuthenticatedRequest, res) => {
    if (!req.user) return res.status(401).json({ ok: false, error: 'AUTH_REQUIRED', message: 'Sesja wygasła. Przyłóż kartę lub zaloguj hasłem.' });
    if (!options.testSessionManager?.getStatus().locked) authService.markTestActivity(req.user.id);
    res.json({ ok: true });
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
      cardLoginEnabled: options.cardLoginEnabled,
    });
  });

  return router;
}
