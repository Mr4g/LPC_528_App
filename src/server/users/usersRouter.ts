import crypto from 'node:crypto';
import { Router } from 'express';
import { CardAssignmentError, type AuthService } from '../auth/authService';
import { requireRole, type AuthenticatedRequest } from '../auth/authMiddleware';
import { normalizeOperatorLogin, validateOperatorLogin } from '../auth/operatorLogin';
import type { UserRole } from '../auth/types';

const MANAGER_ROLES: UserRole[] = ['admin', 'line_leader'];

function isUserRole(value: unknown): value is UserRole {
  return value === 'operator' || value === 'line_leader' || value === 'admin';
}

export function canCreateUser(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === 'admin') return true;
  if (actorRole === 'line_leader') return targetRole === 'line_leader' || targetRole === 'operator';
  return false;
}

export type DeleteUserPermission =
  | { ok: true }
  | { ok: false; code: 'CANNOT_DELETE_SELF' | 'CANNOT_DELETE_LAST_ADMIN' | 'INSUFFICIENT_ROLE'; message: string };

export function canDeleteUser(
  actorRole: UserRole,
  targetRole: UserRole,
  actorId: string,
  targetId: string,
  options: { adminCount?: number } = {},
): DeleteUserPermission {
  if (actorId === targetId) return { ok: false, code: 'CANNOT_DELETE_SELF', message: 'Nie możesz usunąć własnego konta.' };
  if (actorRole === 'admin') {
    if (targetRole === 'admin' && (options.adminCount ?? 0) <= 1) {
      return { ok: false, code: 'CANNOT_DELETE_LAST_ADMIN', message: 'Nie można usunąć ostatniego administratora.' };
    }
    return { ok: true };
  }
  return { ok: false, code: 'INSUFFICIENT_ROLE', message: 'Brak uprawnień do usunięcia tego użytkownika.' };
}

export function canManageTarget(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === 'admin') return targetRole !== 'admin';
  if (actorRole === 'line_leader') return targetRole === 'operator';
  return false;
}

export function canChangeUserRole(actorRole: UserRole, currentTargetRole: UserRole, nextTargetRole: UserRole): boolean {
  if (actorRole === 'admin') return currentTargetRole !== 'admin';
  if (actorRole === 'line_leader') return currentTargetRole === 'operator' && nextTargetRole !== 'admin';
  return false;
}

export function createUsersRouter(authService: AuthService): Router {
  const router = Router();
  const routerInstanceId = crypto.randomUUID();
  router.use(requireRole(MANAGER_ROLES));

  router.get('/', (req: AuthenticatedRequest, res) => {
    const users = authService.listUsers();
    const szpk = users.find((user) => user.login === 'SZPK') ?? null;
    console.info('[USERS GET IDENTITY]', {
      routerInstanceId,
      ...authService.getDebugIdentity(),
      userCount: users.length,
      szpkInspection: szpk ? authService.inspectUserDatabase(szpk.id) : null,
    });
    res.json({ ok: true, users });
  });

  router.post('/', (req: AuthenticatedRequest, res) => {
    const login = typeof req.body?.login === 'string' ? normalizeOperatorLogin(req.body.login) : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const role = req.body?.role;
    const cardUid = typeof req.body?.cardUid === 'string' && req.body.cardUid.trim() ? req.body.cardUid : null;

    if (!isUserRole(role)) return res.status(400).json({ ok: false, error: 'INVALID_ROLE', message: 'Nieprawidłowa rola.' });
    if (!validateOperatorLogin(login)) return res.status(400).json({ ok: false, error: 'INVALID_LOGIN', message: 'Skrót musi mieć 3–5 liter A-Z, bez cyfr i znaków specjalnych.' });
    if (password.length < 4) return res.status(400).json({ ok: false, error: 'INVALID_PASSWORD', message: 'Hasło musi mieć minimum 4 znaki.' });
    if (!canCreateUser(req.user?.role ?? 'operator', role)) {
      const message = req.user?.role === 'line_leader' && role === 'admin' ? 'Line Leader nie może tworzyć administratorów.' : 'Brak uprawnień do tej operacji.';
      return res.status(403).json({ ok: false, code: 'INSUFFICIENT_ROLE', error: 'FORBIDDEN', message });
    }

    try {
      const user = authService.createUser({ login, password, role, createdBy: req.user?.login ?? null });
      const userWithCard = cardUid ? authService.assignCard(user.id, cardUid) ?? user : user;
      return res.status(201).json({ ok: true, user: userWithCard });
    } catch (error) {
      const message = error instanceof CardAssignmentError ? error.message : error instanceof Error ? error.message : 'Nie udało się dodać użytkownika.';
      return res.status(400).json({ ok: false, error: error instanceof CardAssignmentError ? error.code : 'CREATE_USER_FAILED', message });
    }
  });


  router.delete('/:id', (req: AuthenticatedRequest, res) => {
    const id = String(req.params.id).trim();
    console.info('[USERS DELETE IDENTITY]', {
      routerInstanceId,
      requestedId: id,
      ...authService.getDebugIdentity(),
      inspection: authService.inspectUserDatabase(id),
    });
    const listTarget = authService.listUsers().find((user) => user.id === id) ?? null;
    const directTarget = authService.getUserById(id);
    console.info('[USER MANAGEMENT LOOKUP]', {
      requestedId: id,
      requestedIdLength: id.length,
      listTargetFound: Boolean(listTarget),
      directTargetFound: Boolean(directTarget),
      listTargetId: listTarget?.id ?? null,
      listTargetIdLength: listTarget?.id.length ?? null,
    });
    const target = authService.getUserForManagement(id);
    if (!target) return res.status(404).json({ ok: false, error: 'USER_NOT_FOUND_BEFORE_DELETE', message: 'Nie znaleziono użytkownika przed usunięciem.', details: { requestedId: id, existsInUsersList: Boolean(listTarget) } });
    if (req.user?.role !== 'admin') return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'Tylko admin może całkowicie usunąć użytkownika.' });
    const permission = canDeleteUser(req.user?.role ?? 'operator', target.role, req.user?.id ?? '', target.id, {
      adminCount: authService.countActiveAdmins(),
    });
    if (!permission.ok) return res.status(403).json({ ok: false, code: permission.code, error: permission.code, message: permission.message });
    try {
      const result = authService.hardDeleteUser(target.id);
      if (!result.existedBeforeDelete) return res.status(404).json({ ok: false, error: 'USER_NOT_FOUND_DURING_DELETE', message: 'Nie znaleziono użytkownika podczas usuwania.', details: result });
      if (!result.deleted) return res.status(404).json({ ok: false, error: 'USER_NOT_FOUND_DURING_DELETE', message: 'Nie udało się usunąć istniejącego użytkownika.', details: result });
      if (result.existsAfterDelete) return res.status(500).json({ ok: false, error: 'USER_STILL_EXISTS_AFTER_DELETE', message: 'Nie udało się całkowicie usunąć użytkownika: rekord nadal istnieje w bazie.', details: result });
      console.info(`[USERS] permanently deleted userId=${target.id} by=${req.user.login} sessionsDeleted=${result.sessionsDeleted}`);
      return res.json({ ok: true, deletedUserId: target.id, login: target.login, details: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Nie udało się całkowicie usunąć użytkownika.';
      const sqliteCode = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : '';
      if (sqliteCode.includes('CONSTRAINT')) {
        console.error(`[USERS] hard delete constraint failed userId=${target.id}: ${message}`);
        return res.status(409).json({ ok: false, error: 'DELETE_CONSTRAINT_FAILED', message: 'Nie można usunąć użytkownika, ponieważ istnieją zależne rekordy.', details: message });
      }
      console.error(`[USERS] hard delete failed userId=${target.id}: ${message}`);
      return res.status(500).json({ ok: false, error: 'DELETE_FAILED', message, details: message });
    }
  });

  router.patch('/:id', (req: AuthenticatedRequest, res) => {
    const role = req.body?.role;
    if (!isUserRole(role)) return res.status(400).json({ ok: false, error: 'INVALID_ROLE', message: 'Nieprawidłowa rola.' });
    const target = authService.getUserForManagement(String(req.params.id));
    if (!target) return res.status(404).json({ ok: false, error: 'USER_NOT_FOUND' });
    if (!canChangeUserRole(req.user?.role ?? 'operator', target.role, role)) {
      return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'Brak uprawnień do zmiany tej roli.' });
    }
    const user = authService.setRole(String(req.params.id), role);
    if (user) console.info(`[USERS] role changed userId=${target.id} ${target.role}->${role} by=${req.user?.login ?? 'unknown'}`);
    return user ? res.json({ ok: true, user }) : res.status(404).json({ ok: false, error: 'USER_NOT_FOUND' });
  });

  router.post('/:id/card', (req: AuthenticatedRequest, res) => {
    const target = authService.getUserForManagement(String(req.params.id));
    if (!target) return res.status(404).json({ ok: false, error: 'USER_NOT_FOUND' });
    if (!canManageTarget(req.user?.role ?? 'operator', target.role)) return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'Brak uprawnień.' });
    const cardUid = typeof req.body?.cardUid === 'string' ? req.body.cardUid : '';
    try {
      const user = authService.assignCard(String(req.params.id), cardUid);
      return user ? res.json({ ok: true, user }) : res.status(404).json({ ok: false, error: 'USER_NOT_FOUND' });
    } catch (error) {
      const message = error instanceof CardAssignmentError ? error.message : error instanceof Error ? error.message : 'Nie udało się przypisać karty.';
      return res.status(400).json({ ok: false, error: error instanceof CardAssignmentError ? error.code : 'ASSIGN_CARD_FAILED', message });
    }
  });

  router.delete('/:id/card', (req: AuthenticatedRequest, res) => {
    const target = authService.getUserForManagement(String(req.params.id));
    if (!target) return res.status(404).json({ ok: false, error: 'USER_NOT_FOUND' });
    if (!canManageTarget(req.user?.role ?? 'operator', target.role)) return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'Brak uprawnień.' });
    const user = authService.removeCard(String(req.params.id));
    return user ? res.json({ ok: true, user }) : res.status(404).json({ ok: false, error: 'USER_NOT_FOUND' });
  });

  router.post('/:id/reset-password', (req: AuthenticatedRequest, res) => {
    const target = authService.getUserForManagement(String(req.params.id));
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

  return router;
}
