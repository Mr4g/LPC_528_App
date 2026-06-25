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

export class AuthService {
  constructor(private readonly db: AppDatabase, private readonly sessionSecret: string) {}

  seedDefaultAdmin(login: string, password: string): void {
    const count = this.db.countUsers();
    const adminCount = this.db.countAdmins();
    if (count > 0 && adminCount > 0) return;

    const existingDefaultUser = this.findUserByLogin(login);
    if (existingDefaultUser) {
      this.setRole(existingDefaultUser.id, 'admin');
      this.setActive(existingDefaultUser.id, true);
      this.resetPassword(existingDefaultUser.id, password);
      console.warn('Default admin user was repaired. Change DEFAULT_ADMIN_PASSWORD after deployment.');
      return;
    }

    this.createUser({ login, password, role: 'admin', createdBy: null });
    console.warn('Default admin user was created. Change DEFAULT_ADMIN_PASSWORD after deployment.');
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
    const login = normalizeOperatorLogin(loginInput);
    if (!validateOperatorLogin(login) || password.length < 4) return null;

    const user = this.findUserByLogin(login);
    if (!user || !user.isActive) return null;
    if (!verifyPassword(password, user.passwordHash)) return null;

    const lastLoginAt = new Date().toISOString();
    this.db.updateUser(user.id, { lastLoginAt, updatedAt: lastLoginAt });
    return { id: user.id, login: user.login, role: user.role };
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
    const payload: SessionPayload = { ...user, exp: Date.now() + SESSION_MAX_AGE_MS };
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
