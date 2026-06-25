import { Router } from 'express';
import type { AuthService } from './authService';
import { clearSessionCookie, setSessionCookie, type AuthenticatedRequest } from './authMiddleware';
import { normalizeOperatorLogin, validateOperatorLogin } from './operatorLogin';

export function createAuthRouter(authService: AuthService): Router {
  const router = Router();

  router.post('/login', (req, res) => {
    const login = typeof req.body?.login === 'string' ? normalizeOperatorLogin(req.body.login) : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!validateOperatorLogin(login) || password.length < 4) {
      return res.status(401).json({ ok: false, error: 'Nieprawidłowy login lub hasło' });
    }

    const user = authService.login(login, password);
    if (!user) return res.status(401).json({ ok: false, error: 'Nieprawidłowy login lub hasło' });

    setSessionCookie(res, authService.createSession(user));
    return res.json({ ok: true, user });
  });

  router.post('/logout', (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  router.get('/me', (req: AuthenticatedRequest, res) => {
    res.json({ ok: true, user: req.user ?? null });
  });

  return router;
}
