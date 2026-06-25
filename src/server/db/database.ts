import fs from 'node:fs';
import path from 'node:path';
import type { UserRecord } from '../auth/types';

interface UserDatabaseFile {
  users: UserRecord[];
}

export class UserStore {
  private data: UserDatabaseFile = { users: [] };

  constructor(private readonly dbPath: string) {
    this.load();
  }

  countUsers(): number {
    return this.data.users.length;
  }

  countAdmins(): number {
    return this.data.users.filter((user) => user.role === 'admin').length;
  }

  listUsers(): UserRecord[] {
    return [...this.data.users].sort((a, b) => a.login.localeCompare(b.login));
  }

  findByLogin(login: string): UserRecord | null {
    return this.data.users.find((user) => user.login === login) ?? null;
  }

  findById(id: string): UserRecord | null {
    return this.data.users.find((user) => user.id === id) ?? null;
  }

  insertUser(user: UserRecord): void {
    if (this.findByLogin(user.login)) throw new Error('Login already exists');
    this.data.users.push(user);
    this.save();
  }

  updateUser(id: string, patch: Partial<UserRecord>): UserRecord | null {
    const index = this.data.users.findIndex((user) => user.id === id);
    if (index < 0) return null;
    this.data.users[index] = { ...this.data.users[index], ...patch };
    this.save();
    return this.data.users[index];
  }

  private load(): void {
    if (this.dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    }

    if (this.dbPath === ':memory:' || !fs.existsSync(this.dbPath)) {
      this.data = { users: [] };
      return;
    }

    const raw = fs.readFileSync(this.dbPath, 'utf8').trim();
    if (!raw) {
      this.data = { users: [] };
      return;
    }

    try {
      this.data = JSON.parse(raw) as UserDatabaseFile;
    } catch {
      const backupPath = `${this.dbPath}.invalid-${Date.now()}`;
      fs.renameSync(this.dbPath, backupPath);
      console.warn(`Auth user database was not readable and was moved to ${backupPath}. A new user database will be created.`);
      this.data = { users: [] };
      this.save();
    }
  }

  private save(): void {
    if (this.dbPath === ':memory:') return;
    fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2));
  }
}

export type AppDatabase = UserStore;

export function createDatabase(dbPath: string): AppDatabase {
  return new UserStore(dbPath);
}
