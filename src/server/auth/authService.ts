import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { AppDatabase } from '../db/database';
import { normalizeOperatorLogin, validateOperatorLogin } from './operatorLogin';
import { cardUidLast4, hashCardUid, hashPrefix, maskCardLast4, normalizeCardUid } from './cardUid';
import type { AuthUser, PublicUser, UserRecord, UserRole } from './types';

const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const ALLOWED_ROLES: UserRole[] = ['operator', 'line_leader', 'admin'];
const LEGACY_PASSWORD_HASH_PREFIX = 'scrypt';

function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

function verifyLegacyScryptPassword(password: string, storedHash: string): boolean {
  const [prefix, salt, hash] = storedHash.split('$');
  if (prefix !== LEGACY_PASSWORD_HASH_PREFIX || !salt || !hash) return false;
  const computed = crypto.scryptSync(password, salt, 64).toString('base64url');
  if (computed.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
}

function verifyPassword(password: string, storedHash: string): boolean {
  if (storedHash.startsWith(`${LEGACY_PASSWORD_HASH_PREFIX}$`)) {
    return verifyLegacyScryptPassword(password, storedHash);
  }
  return bcrypt.compareSync(password, storedHash);
}

export interface SessionPayload extends AuthUser {
  exp: number;
}

export interface AuthDebugUser {
  login: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface AuthDbStats {
  dbPath: string;
  dbExists: boolean;
  usersTableExists: boolean;
  usersCount: number;
  activeUsersCount: number;
  adminUsersCount: number;
  activeAdminUsersCount: number;
  users: AuthDebugUser[];
}

export type DefaultAdminSeedResult =
  | { action: 'none'; login: string; before: AuthDbStats; after: AuthDbStats }
  | { action: 'created' | 'repaired' | 'reset'; login: string; before: AuthDbStats; after: AuthDbStats };

export type LoginResult =
  | { ok: true; user: AuthUser }
  | { ok: false; reason: 'INVALID_CREDENTIALS' | 'INACTIVE' | 'UNKNOWN_CARD' | 'INVALID_CARD' };

export type CardActionResult =
  | { ok: true; action: 'LOGIN' | 'LOGGED_OUT' | 'SWITCHED_USER'; user: AuthUser | null; message: string }
  | { ok: false; action: 'UNKNOWN_CARD' | 'TEST_IN_PROGRESS' | 'INVALID_CARD'; message: string };

export class CardAssignmentError extends Error {
  constructor(message: string, readonly code: 'CARD_ALREADY_ASSIGNED' | 'INVALID_CARD') { super(message); }
}

export class AuthService {
  constructor(private readonly db: AppDatabase, private readonly sessionSecret: string, private readonly sessionMaxAgeMs = SESSION_MAX_AGE_MS, private readonly cardUidPattern = '^\\d{8}$', private readonly testIdleLogoutMs = 15 * 60 * 1000) {}

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
      dbExists: this.db.dbExists(),
      usersTableExists: this.db.tableExists('users'),
      usersCount: this.db.countUsers(),
      activeUsersCount: this.db.countActiveUsers(),
      adminUsersCount: this.db.countAdminUsers(),
      activeAdminUsersCount: this.db.countActiveAdminUsers(),
      users: this.db.listUsers().map((user) => ({
        login: user.login,
        role: user.role,
        isActive: Boolean(user.isActive),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastLoginAt: user.lastLoginAt,
      })),
    };
  }

  createUser(input: { login: string; password: string; role: UserRole; createdBy: string | null }): PublicUser {
    const login = normalizeOperatorLogin(input.login);
    this.assertValidLogin(login);
    this.assertValidPassword(input.password);
    this.assertValidRole(input.role);

    const existing = this.db.findByLoginIncludingDeleted(login);
    if (existing?.deletedAt === null && existing.isActive) throw new Error('Użytkownik z takim loginem już istnieje.');

    const now = new Date().toISOString();
    if (existing) {
      const reactivated = this.db.updateUserIncludingDeleted(existing.id, {
        passwordHash: hashPassword(input.password),
        role: input.role,
        isActive: 1,
        updatedAt: now,
        lastLoginAt: null,
        createdBy: input.createdBy,
        cardUidHash: null,
        cardUidLast4: null,
        cardAssignedAt: null,
        lastTestAt: null,
        deletedAt: null,
      });
      if (!reactivated) throw new Error('Nie udało się dodać użytkownika.');
      return this.toPublicUser(reactivated);
    }

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
      cardUidHash: null,
      cardUidLast4: null,
      cardAssignedAt: null,
      lastTestAt: new Date().toISOString(),
      deletedAt: null,
    };

    this.db.insertUser(user);

    return this.toPublicUser(user);
  }

  loginByCard(cardUidInput: string): LoginResult {
    const normalized = normalizeCardUid(cardUidInput);
    if (!this.isValidCardUid(normalized)) return { ok: false, reason: 'INVALID_CARD' };
    const hash = hashCardUid(normalized, this.sessionSecret);
    const user = this.db.findByCardUidHash(hash);
    if (!user) {
      console.info(`[CARD] action=UNKNOWN_CARD cardLast4=${cardUidLast4(normalized)} hashPrefix=${hashPrefix(hash)}`);
      return { ok: false, reason: 'UNKNOWN_CARD' };
    }
    const now = new Date().toISOString();
    this.db.updateUser(user.id, { lastLoginAt: now, lastTestAt: now, updatedAt: now });
    console.info(`[CARD] action=LOGIN login=${user.login} cardLast4=${user.cardUidLast4 ?? cardUidLast4(normalized)} hashPrefix=${hashPrefix(hash)}`);
    return { ok: true, user: { id: user.id, login: user.login, role: user.role } };
  }

  handleCardAction(cardUidInput: string, currentUser: AuthUser | undefined, testLocked: boolean): CardActionResult {
    if (!currentUser) {
      const login = this.loginByCard(cardUidInput);
      if (!login.ok) return { ok: false, action: login.reason === 'INVALID_CARD' ? 'INVALID_CARD' : 'UNKNOWN_CARD', message: 'Nieznana karta. Przyłóż przypisaną kartę lub zaloguj hasłem.' };
      return { ok: true, action: 'LOGIN', user: login.user, message: `Zalogowano: ${login.user.login}` };
    }
    const normalized = normalizeCardUid(cardUidInput);
    if (!this.isValidCardUid(normalized)) return { ok: false, action: 'INVALID_CARD', message: 'Nieznana karta' };
    const hash = hashCardUid(normalized, this.sessionSecret);
    const cardUser = this.db.findByCardUidHash(hash);
    if (!cardUser) {
      console.info(`[CARD] action=UNKNOWN_CARD cardLast4=${cardUidLast4(normalized)} hashPrefix=${hashPrefix(hash)}`);
      return { ok: false, action: 'UNKNOWN_CARD', message: 'Nieznana karta' };
    }
    if (testLocked) return { ok: false, action: 'TEST_IN_PROGRESS', message: 'Nie można zmienić operatora podczas trwania testu.' };
    if (cardUser.id === currentUser.id) {
      console.info(`[CARD] action=LOGOUT login=${currentUser.login} cardLast4=${cardUser.cardUidLast4 ?? cardUidLast4(normalized)} hashPrefix=${hashPrefix(hash)}`);
      return { ok: true, action: 'LOGGED_OUT', user: null, message: 'Wylogowano' };
    }
    const now = new Date().toISOString();
    this.db.updateUser(cardUser.id, { lastLoginAt: now, lastTestAt: now, updatedAt: now });
    console.info(`[CARD] action=SWITCHED_USER login=${cardUser.login} cardLast4=${cardUser.cardUidLast4 ?? cardUidLast4(normalized)} hashPrefix=${hashPrefix(hash)}`);
    return { ok: true, action: 'SWITCHED_USER', user: { id: cardUser.id, login: cardUser.login, role: cardUser.role }, message: `Przelogowano na: ${cardUser.login}` };
  }

  assignCard(id: string, cardUidInput: string): PublicUser | null {
    const normalized = normalizeCardUid(cardUidInput);
    if (!this.isValidCardUid(normalized)) throw new CardAssignmentError('Nieprawidłowy UID karty.', 'INVALID_CARD');
    const hash = hashCardUid(normalized, this.sessionSecret);
    const existing = this.db.findByCardUidHash(hash);
    if (existing && existing.id !== id) throw new CardAssignmentError('Ta karta jest już przypisana do innego użytkownika.', 'CARD_ALREADY_ASSIGNED');
    const now = new Date().toISOString();
    const user = this.db.updateUser(id, { cardUidHash: hash, cardUidLast4: cardUidLast4(normalized), cardAssignedAt: now, updatedAt: now });
    return user ? this.toPublicUser(user) : null;
  }

  removeCard(id: string): PublicUser | null {
    const user = this.db.updateUser(id, { cardUidHash: null, cardUidLast4: null, cardAssignedAt: null, updatedAt: new Date().toISOString() });
    return user ? this.toPublicUser(user) : null;
  }

  markTestActivity(userId: string | null | undefined, at = new Date().toISOString()): void {
    if (!userId) return;
    this.db.updateUser(userId, { lastTestAt: at, updatedAt: at });
  }

  isSessionIdleExpired(user: UserRecord): boolean {
    if (this.testIdleLogoutMs <= 0) return false;
    const last = user.lastTestAt ?? user.lastLoginAt ?? user.createdAt;
    return Date.now() - Date.parse(last) > this.testIdleLogoutMs;
  }

  isValidCardUid(uid: string): boolean {
    return new RegExp(this.cardUidPattern).test(uid);
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
    this.db.updateUser(user.id, { lastLoginAt, lastTestAt: lastLoginAt, updatedAt: lastLoginAt });
    return { ok: true, user: { id: user.id, login: user.login, role: user.role } };
  }

  countActiveAdmins(): number {
    return this.db.countActiveAdminUsers();
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

  softDeleteUser(id: string): PublicUser | null {
    const deletedAt = new Date().toISOString();
    const user = this.db.updateUser(id, { isActive: 0, deletedAt, updatedAt: deletedAt, cardUidHash: null, cardUidLast4: null, cardAssignedAt: null });
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

  verifySession(token: string | undefined, options: { allowIdleExpired?: boolean } = {}): AuthUser | null {
    if (!token) return null;
    const [body, signature] = token.split('.');
    if (!body || !signature) return null;

    const expected = crypto.createHmac('sha256', this.sessionSecret).update(body).digest('base64url');
    if (signature.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (payload.exp < Date.now()) return null;
    const user = this.db.findById(payload.id);
    if (!user || !user.isActive) return null;
    if (!options.allowIdleExpired && this.isSessionIdleExpired(user)) return null;
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
      cardUidLast4: user.cardUidLast4,
      cardMask: maskCardLast4(user.cardUidLast4),
      lastTestAt: user.lastTestAt,
      deletedAt: user.deletedAt,
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
