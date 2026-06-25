import crypto from 'node:crypto';
import type { AppDatabase } from '../db/database';
import { normalizeOperatorLogin, validateOperatorLogin } from './operatorLogin';
import type { AuthUser, PublicUser, UserRecord, UserRole } from './types';

const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const ALLOWED_ROLES: UserRole[] = ['operator', 'line_leader', 'admin'];
const PASSWORD_HASH_PREFIX = 'scrypt';

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(password, salt, 64).toString('base64url');
  return `${PASSWORD_HASH_PREFIX}$${salt}$${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [prefix, salt, hash] = storedHash.split('$');
  if (prefix !== PASSWORD_HASH_PREFIX || !salt || !hash) return false;
  const computed = crypto.scryptSync(password, salt, 64).toString('base64url');
  if (computed.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
}

export interface SessionPayload extends AuthUser {
  exp: number;
}

export interface AuthDbStats {
  dbPath: string;
  usersCount: number;
  activeUsersCount: number;
  adminUsersCount: number;
  activeAdminUsersCount: number;
}

export type DefaultAdminSeedResult =
  | { action: 'none'; login: string; before: AuthDbStats; after: AuthDbStats }
  | { action: 'created' | 'repaired' | 'reset'; login: string; before: AuthDbStats; after: AuthDbStats };

export type LoginResult =
  | { ok: true; user: AuthUser }
  | { ok: false; reason: 'INVALID_CREDENTIALS' | 'INACTIVE' };

export class AuthService {
  constructor(private readonly db: AppDatabase, private readonly sessionSecret: string, private readonly sessionMaxAgeMs = SESSION_MAX_AGE_MS) {}

  seedDefaultAdmin(loginInput: string, password: string): DefaultAdminSeedResult {
    const login = normalizeOperatorLogin(loginInput);
    const before = this.getDbStats();
    if (before.usersCount > 0 && before.activeAdminUsersCount > 0) {
      return { action: 'none', login, before, after: before };
    }

    const existingDefaultUser = this.findUserByLogin(login);
    if (existingDefaultUser) {
      this.setRole(existingDefaultUser.id, 'admin');
      this.setActive(existingDefaultUser.id, true);
      this.resetPassword(existingDefaultUser.id, password);
      return { action: 'repaired', login, before, after: this.getDbStats() };
    }

    this.createUser({ login, password, role: 'admin', createdBy: null });
    return { action: 'created', login, before, after: this.getDbStats() };
  }

  resetDefaultAdminFromEnv(loginInput: string, password: string): DefaultAdminSeedResult {
    const login = normalizeOperatorLogin(loginInput);
    const before = this.getDbStats();
    const existingDefaultUser = this.findUserByLogin(login);
    if (existingDefaultUser) {
      this.db.updateUser(existingDefaultUser.id, {
        passwordHash: hashPassword(password),
        role: 'admin',
        isActive: 1,
        updatedAt: new Date().toISOString(),
      });
      return { action: 'reset', login, before, after: this.getDbStats() };
    }

    this.createUser({ login, password, role: 'admin', createdBy: null });
    return { action: 'reset', login, before, after: this.getDbStats() };
  }

  getDbStats(): AuthDbStats {
    return {
      dbPath: this.db.getPath(),
      usersCount: this.db.countUsers(),
      activeUsersCount: this.db.countActiveUsers(),
      adminUsersCount: this.db.countAdminUsers(),
      activeAdminUsersCount: this.db.countActiveAdminUsers(),
    };
  }

  createUser(input: { login: string; password: string; role: UserRole; createdBy: string | null }): PublicUser {
    const login = normalizeOperatorLogin(input.login);
    this.assertValidLogin(login);
    this.assertValidPassword(input.password);
    this.assertValidRole(input.role);

    const now = new Date().toISOString();
    const user: UserRecord = {
      id: crypto.randomUUID(),
      login,
      passwordHash: hashPassword(input.password),
      role: input.role,
      isActive: 1,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      createdBy: input.createdBy,
    };

    this.db.insertUser(user);

    return this.toPublicUser(user);
  }

  login(loginInput: string, password: string): AuthUser | null {
    const result = this.loginDetailed(loginInput, password);
    return result.ok ? result.user : null;
  }

  loginDetailed(loginInput: string, password: string): LoginResult {
    const login = normalizeOperatorLogin(loginInput);
    if (!validateOperatorLogin(login) || password.length < 4) return { ok: false, reason: 'INVALID_CREDENTIALS' };

    const user = this.findUserByLogin(login);
    if (!user) return { ok: false, reason: 'INVALID_CREDENTIALS' };
    if (!user.isActive) return { ok: false, reason: 'INACTIVE' };
    if (!verifyPassword(password, user.passwordHash)) return { ok: false, reason: 'INVALID_CREDENTIALS' };

    const lastLoginAt = new Date().toISOString();
    this.db.updateUser(user.id, { lastLoginAt, updatedAt: lastLoginAt });
    return { ok: true, user: { id: user.id, login: user.login, role: user.role } };
  }

  listUsers(): PublicUser[] {
    return this.db.listUsers().map((user) => this.toPublicUser(user));
  }

  getUserById(id: string): PublicUser | null {
    const user = this.db.findById(id);
    return user ? this.toPublicUser(user) : null;
  }

  findUserByLogin(login: string): UserRecord | null {
    return this.db.findByLogin(normalizeOperatorLogin(login));
  }

  setRole(id: string, role: UserRole): PublicUser | null {
    this.assertValidRole(role);
    const updatedAt = new Date().toISOString();
    const user = this.db.updateUser(id, { role, updatedAt });
    return user ? this.toPublicUser(user) : null;
  }

  setActive(id: string, active: boolean): PublicUser | null {
    const updatedAt = new Date().toISOString();
    const user = this.db.updateUser(id, { isActive: active ? 1 : 0, updatedAt });
    return user ? this.toPublicUser(user) : null;
  }

  resetPassword(id: string, password: string): PublicUser | null {
    this.assertValidPassword(password);
    const passwordHash = hashPassword(password);
    const updatedAt = new Date().toISOString();
    const user = this.db.updateUser(id, { passwordHash, updatedAt });
    return user ? this.toPublicUser(user) : null;
  }

  createSession(user: AuthUser): string {
    const payload: SessionPayload = { ...user, exp: Date.now() + this.sessionMaxAgeMs };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', this.sessionSecret).update(body).digest('base64url');
    return `${body}.${signature}`;
  }

  verifySession(token: string | undefined): AuthUser | null {
    if (!token) return null;
    const [body, signature] = token.split('.');
    if (!body || !signature) return null;

    const expected = crypto.createHmac('sha256', this.sessionSecret).update(body).digest('base64url');
    if (signature.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (payload.exp < Date.now()) return null;
    const user = this.getUserById(payload.id);
    if (!user || !user.isActive) return null;
    return { id: user.id, login: user.login, role: user.role };
  }

  toPublicUser(user: UserRecord): PublicUser {
    return {
      id: user.id,
      login: user.login,
      role: user.role,
      isActive: Boolean(user.isActive),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
      createdBy: user.createdBy,
    };
  }

  private assertValidLogin(login: string): void {
    if (!validateOperatorLogin(login)) throw new Error('Skrót musi mieć 3–5 liter A-Z, bez cyfr i znaków specjalnych.');
  }

  private assertValidPassword(password: string): void {
    if (password.length < 4) throw new Error('Hasło musi mieć minimum 4 znaki.');
  }

  private assertValidRole(role: UserRole): void {
    if (!ALLOWED_ROLES.includes(role)) throw new Error('Nieprawidłowa rola użytkownika.');
  }
}
