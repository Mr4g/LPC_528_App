import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type AppDatabase = Database.Database;

export function createDatabase(dbPath: string): AppDatabase {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      login TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL,
      isActive INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      lastLoginAt TEXT NULL,
      createdBy TEXT NULL
    );
  `);
  return db;
}
