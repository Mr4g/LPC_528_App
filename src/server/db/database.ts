import fs from 'node:fs';
import path from 'node:path';
import type { UserRecord } from '../auth/types';
import type { ProgramMappingRecord } from '../../programs/programMappingStore';

interface UserDatabaseFile {
  users: UserRecord[];
  programMappings: ProgramMappingRecord[];
}

export class UserStore {
  private data: UserDatabaseFile = { users: [], programMappings: [] };

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

  listProgramMappings(): ProgramMappingRecord[] {
    return [...this.data.programMappings].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  findProgramMappingById(id: string): ProgramMappingRecord | null {
    return this.data.programMappings.find((mapping) => mapping.id === id) ?? null;
  }

  insertProgramMapping(mapping: ProgramMappingRecord): void {
    this.data.programMappings.push(mapping);
    this.save();
  }

  updateProgramMapping(id: string, patch: Partial<ProgramMappingRecord>): ProgramMappingRecord | null {
    const index = this.data.programMappings.findIndex((mapping) => mapping.id === id);
    if (index < 0) return null;
    this.data.programMappings[index] = { ...this.data.programMappings[index], ...patch };
    this.save();
    return this.data.programMappings[index];
  }

  private load(): void {
    if (this.dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    }

    if (this.dbPath === ':memory:' || !fs.existsSync(this.dbPath)) {
      this.data = { users: [], programMappings: [] };
      return;
    }

    const raw = fs.readFileSync(this.dbPath, 'utf8').trim();
    if (!raw) {
      this.data = { users: [], programMappings: [] };
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<UserDatabaseFile>;
      this.data = {
        users: Array.isArray(parsed.users) ? parsed.users : [],
        programMappings: Array.isArray(parsed.programMappings) ? parsed.programMappings : [],
      };
    } catch {
      const backupPath = `${this.dbPath}.invalid-${Date.now()}`;
      fs.renameSync(this.dbPath, backupPath);
      console.warn(`Auth user database was not readable and was moved to ${backupPath}. A new user database will be created.`);
      this.data = { users: [], programMappings: [] };
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
