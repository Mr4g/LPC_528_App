import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { AppDatabase } from '../db/database';
import { normalizeOperatorLogin, validateOperatorLogin } from './operatorLogin';
import type { AuthUser, PublicUser, UserRecord, UserRole } from './types';

const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const ALLOWED_ROLES: UserRole[] = ['operator', 'line_leader', 'admin'];

export interface SessionPayload extends AuthUser {
  exp: number;
}

export class AuthService {
  constructor(private readonly db: AppDatabase, private readonly sessionSecret: string) {}

  seedDefaultAdmin(login: string, password: string): void {
    const count = this.db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    if (count.count > 0) return;

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
      passwordHash: bcrypt.hashSync(input.password, 10),
      role: input.role,
      isActive: 1,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      createdBy: input.createdBy,
    };

    this.db.prepare(`
      INSERT INTO users (id, login, passwordHash, role, isActive, createdAt, updatedAt, lastLoginAt, createdBy)
      VALUES (@id, @login, @passwordHash, @role, @isActive, @createdAt, @updatedAt, @lastLoginAt, @createdBy)
    `).run(user);

    return this.toPublicUser(user);
  }

  login(loginInput: string, password: string): AuthUser | null {
    const login = normalizeOperatorLogin(loginInput);
    if (!validateOperatorLogin(login) || password.length < 4) return null;

    const user = this.findUserByLogin(login);
    if (!user || !user.isActive) return null;
    if (!bcrypt.compareSync(password, user.passwordHash)) return null;

    const lastLoginAt = new Date().toISOString();
    this.db.prepare('UPDATE users SET lastLoginAt = @lastLoginAt, updatedAt = @lastLoginAt WHERE id = @id').run({ id: user.id, lastLoginAt });
    return { id: user.id, login: user.login, role: user.role };
  }

  listUsers(): PublicUser[] {
    return (this.db.prepare('SELECT * FROM users ORDER BY login ASC').all() as UserRecord[]).map((user) => this.toPublicUser(user));
  }

  getUserById(id: string): PublicUser | null {
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRecord | undefined;
    return user ? this.toPublicUser(user) : null;
  }

  findUserByLogin(login: string): UserRecord | null {
    return (this.db.prepare('SELECT * FROM users WHERE login = ?').get(normalizeOperatorLogin(login)) as UserRecord | undefined) ?? null;
  }

  setRole(id: string, role: UserRole): PublicUser | null {
    this.assertValidRole(role);
    const updatedAt = new Date().toISOString();
    this.db.prepare('UPDATE users SET role = @role, updatedAt = @updatedAt WHERE id = @id').run({ id, role, updatedAt });
    return this.getUserById(id);
  }

  setActive(id: string, active: boolean): PublicUser | null {
    const updatedAt = new Date().toISOString();
    this.db.prepare('UPDATE users SET isActive = @isActive, updatedAt = @updatedAt WHERE id = @id').run({ id, isActive: active ? 1 : 0, updatedAt });
    return this.getUserById(id);
  }

  resetPassword(id: string, password: string): PublicUser | null {
    this.assertValidPassword(password);
    const passwordHash = bcrypt.hashSync(password, 10);
    const updatedAt = new Date().toISOString();
    this.db.prepare('UPDATE users SET passwordHash = @passwordHash, updatedAt = @updatedAt WHERE id = @id').run({ id, passwordHash, updatedAt });
    return this.getUserById(id);
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
