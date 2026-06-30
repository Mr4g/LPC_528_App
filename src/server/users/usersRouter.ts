import { Router } from 'express';
import type { AuthService } from '../auth/authService';
import { requireRole, type AuthenticatedRequest } from '../auth/authMiddleware';
import { normalizeOperatorLogin, validateOperatorLogin } from '../auth/operatorLogin';
import type { UserRole } from '../auth/types';

const MANAGER_ROLES: UserRole[] = ['admin', 'line_leader'];

function isUserRole(value: unknown): value is UserRole {
  return value === 'operator' || value === 'line_leader' || value === 'admin';
}

export function canManageTarget(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === 'admin') return targetRole !== 'admin';
  if (actorRole === 'line_leader') return targetRole === 'operator';
  return false;
}

export function createUsersRouter(authService: AuthService): Router {
  const router = Router();
  router.use(requireRole(MANAGER_ROLES));

  router.get('/', (req: AuthenticatedRequest, res) => {
    const users = authService.listUsers().filter((user) => {
      if (req.user?.role === 'line_leader') return user.role === 'operator';
      return user.role !== 'admin';
    });
    res.json({ ok: true, users });
  });

  router.post('/', (req: AuthenticatedRequest, res) => {
    const login = typeof req.body?.login === 'string' ? normalizeOperatorLogin(req.body.login) : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const role = req.body?.role;

    if (!isUserRole(role)) return res.status(400).json({ ok: false, error: 'INVALID_ROLE', message: 'Nieprawidłowa rola.' });
    if (!validateOperatorLogin(login)) return res.status(400).json({ ok: false, error: 'INVALID_LOGIN', message: 'Skrót musi mieć 3–5 liter A-Z, bez cyfr i znaków specjalnych.' });
    if (password.length < 4) return res.status(400).json({ ok: false, error: 'INVALID_PASSWORD', message: 'Hasło musi mieć minimum 4 znaki.' });
    if (!canManageTarget(req.user?.role ?? 'operator', role)) return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'Brak uprawnień do utworzenia tej roli.' });

    try {
      const user = authService.createUser({ login, password, role, createdBy: req.user?.login ?? null });
      return res.status(201).json({ ok: true, user });
    } catch (error) {
      return res.status(400).json({ ok: false, error: 'CREATE_USER_FAILED', message: error instanceof Error ? error.message : 'Nie udało się dodać użytkownika.' });
    }
  });

  router.patch('/:id', (req: AuthenticatedRequest, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'Tylko admin może zmieniać rolę.' });
    const role = req.body?.role;
    if (!isUserRole(role)) return res.status(400).json({ ok: false, error: 'INVALID_ROLE', message: 'Nieprawidłowa rola.' });
    if (!canManageTarget('admin', role)) return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'Nie można ustawić tej roli.' });
    const target = authService.getUserById(String(req.params.id));
    if (!target || !canManageTarget('admin', target.role)) return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'Brak uprawnień.' });
    const user = authService.setRole(String(req.params.id), role);
    return user ? res.json({ ok: true, user }) : res.status(404).json({ ok: false, error: 'USER_NOT_FOUND' });
  });

  router.post('/:id/reset-password', (req: AuthenticatedRequest, res) => {
    const target = authService.getUserById(String(req.params.id));
    if (!target) return res.status(404).json({ ok: false, error: 'USER_NOT_FOUND' });
    if (!canManageTarget(req.user?.role ?? 'operator', target.role)) return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'Brak uprawnień.' });
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    try {
      const user = authService.resetPassword(String(req.params.id), password);
      return res.json({ ok: true, user });
    } catch (error) {
      return res.status(400).json({ ok: false, error: 'RESET_PASSWORD_FAILED', message: error instanceof Error ? error.message : 'Nie udało się zresetować hasła.' });
    }
  });

  router.patch('/:id/disable', (req: AuthenticatedRequest, res) => {
    const target = authService.getUserById(String(req.params.id));
    if (!target) return res.status(404).json({ ok: false, error: 'USER_NOT_FOUND' });
    if (!canManageTarget(req.user?.role ?? 'operator', target.role)) return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'Brak uprawnień.' });
    return res.json({ ok: true, user: authService.setActive(String(req.params.id), false) });
  });

  router.patch('/:id/enable', (req: AuthenticatedRequest, res) => {
    const target = authService.getUserById(String(req.params.id));
    if (!target) return res.status(404).json({ ok: false, error: 'USER_NOT_FOUND' });
    if (!canManageTarget(req.user?.role ?? 'operator', target.role)) return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'Brak uprawnień.' });
    return res.json({ ok: true, user: authService.setActive(String(req.params.id), true) });
  });

  return router;
}
