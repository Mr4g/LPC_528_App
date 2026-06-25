import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database, { type Database as BetterSqliteDatabase } from 'better-sqlite3';
import type { UserRecord } from '../auth/types';
import type { ProgramMappingRecord } from '../../programs/programMappingStore';
import type { LpcResult } from '../../shared/types';

export interface TestResultQuery {
  limit?: number;
  offset?: number;
  result?: string;
  barcode?: string;
  operatorLogin?: string;
  programText?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface StoredTestSession {
  id: string;
  status: string;
  barcode: string | null;
  programNumber: number | null;
  programText: string | null;
  operatorLogin: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastStreamAt: string | null;
  timeoutAt: string | null;
  message: string | null;
}

function boolToInt(value: boolean | number): number {
  return typeof value === 'number' ? value : value ? 1 : 0;
}

function rowToUser(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    login: String(row.login),
    passwordHash: String(row.passwordHash),
    role: row.role as UserRecord['role'],
    isActive: Number(row.isActive),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    lastLoginAt: row.lastLoginAt === null ? null : String(row.lastLoginAt),
    createdBy: row.createdBy === null ? null : String(row.createdBy),
  };
}

function rowToProgramMapping(row: Record<string, unknown>): ProgramMappingRecord {
  return {
    id: String(row.id),
    barcodePattern: String(row.barcodePattern),
    programNumber: Number(row.programNumber),
    programText: String(row.programText),
    description: row.description === null ? null : String(row.description),
    isActive: Boolean(row.isActive),
    matchType: row.matchType as ProgramMappingRecord['matchType'],
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    createdBy: row.createdBy === null ? null : String(row.createdBy),
    updatedBy: row.updatedBy === null ? null : String(row.updatedBy),
  };
}

function rowToSession(row: Record<string, unknown>): StoredTestSession {
  return {
    id: String(row.id),
    status: String(row.status),
    barcode: row.barcode === null ? null : String(row.barcode),
    programNumber: row.programNumber === null ? null : Number(row.programNumber),
    programText: row.programText === null ? null : String(row.programText),
    operatorLogin: row.operatorLogin === null ? null : String(row.operatorLogin),
    startedAt: row.startedAt === null ? null : String(row.startedAt),
    completedAt: row.completedAt === null ? null : String(row.completedAt),
    lastStreamAt: row.lastStreamAt === null ? null : String(row.lastStreamAt),
    timeoutAt: row.timeoutAt === null ? null : String(row.timeoutAt),
    message: row.message === null ? null : String(row.message),
  };
}

function rowToResult(row: Record<string, unknown>): LpcResult {
  return {
    source: String(row.source ?? ''),
    receivedAt: String(row.receivedAt),
    messageId: row.messageId === null ? null : String(row.messageId),
    messageType: row.messageType === null ? null : String(row.messageType),
    channel: row.channel === null ? null : String(row.channel),
    port: row.port === null ? null : String(row.port),
    program: row.program === null ? null : String(row.program),
    programText: row.programText === null ? null : String(row.programText),
    linkInfo: row.linkInfo === null ? null : String(row.linkInfo),
    result: row.result as LpcResult['result'],
    value: row.result as LpcResult['value'],
    testerTime: row.testerTime === null ? null : String(row.testerTime),
    testerDate: row.testerDate === null ? null : String(row.testerDate),
    uniqueId: row.uniqueId === null ? null : String(row.uniqueId),
    totalAbs: row.totalAbs === null ? null : String(row.totalAbs),
    programEvaluation: row.programEvaluation === null ? null : String(row.programEvaluation),
    spcFlag: row.spcFlag === null ? null : String(row.spcFlag),
    barcode: String(row.barcode ?? ''),
    barcodeFromResult: row.barcodeFromResult === null ? null : String(row.barcodeFromResult),
    testType: row.testType === null ? null : String(row.testType),
    testEvaluation: row.testEvaluation === null ? null : String(row.testEvaluation),
    leakType: row.leakType === null ? null : String(row.leakType),
    leakValue: row.leakValue === null ? null : Number(row.leakValue),
    leakUnit: row.leakUnit === null ? null : String(row.leakUnit),
    resultDetailsRaw: null,
    measurements: row.measurementsJson ? JSON.parse(String(row.measurementsJson)) as LpcResult['measurements'] : {},
    RL: row.RL === null ? null : Number(row.RL),
    RL_unit: row.RL_unit === null ? null : String(row.RL_unit),
    Pt: row.Pt === null ? null : Number(row.Pt),
    Pt_unit: row.Pt_unit === null ? null : String(row.Pt_unit),
    EDC: row.EDC === null ? null : Number(row.EDC),
    EDC_unit: row.EDC_unit === null ? null : String(row.EDC_unit),
    PL: row.PL === null ? null : Number(row.PL),
    PL_unit: row.PL_unit === null ? null : String(row.PL_unit),
    LLR: row.LLR === null ? null : Number(row.LLR),
    LLR_unit: row.LLR_unit === null ? null : String(row.LLR_unit),
    HLR: row.HLR === null ? null : Number(row.HLR),
    HLR_unit: row.HLR_unit === null ? null : String(row.HLR_unit),
    FPR: row.FPR === null ? null : Number(row.FPR),
    FPR_unit: row.FPR_unit === null ? null : String(row.FPR_unit),
    raw: String(row.raw ?? ''),
    normalized: String(row.normalized ?? ''),
    operatorLogin: row.operatorLogin === null ? null : String(row.operatorLogin),
    operatorRole: row.operatorRole === null ? null : String(row.operatorRole),
  };
}

export class AppDatabase {
  private readonly db: BetterSqliteDatabase;

  constructor(private readonly dbPath: string) {
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  getPath(): string { return this.dbPath; }
  dbExists(): boolean { return this.dbPath === ':memory:' || fs.existsSync(this.dbPath); }
  tableExists(tableName: string): boolean {
    const row = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName) as Record<string, unknown> | undefined;
    return Boolean(row);
  }
  private count(sql: string): number {
    const row = this.db.prepare(sql).get() as { count?: number } | undefined;
    return Number(row?.count ?? 0);
  }
  countUsers(): number { return this.count('SELECT COUNT(*) AS count FROM users'); }
  countActiveUsers(): number { return this.count('SELECT COUNT(*) AS count FROM users WHERE isActive = 1'); }
  countAdmins(): number { return this.countAdminUsers(); }
  countAdminUsers(): number { return this.count("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'"); }
  countActiveAdminUsers(): number { return this.count("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND isActive = 1"); }
  listUsers(): UserRecord[] { return (this.db.prepare('SELECT * FROM users ORDER BY login ASC').all() as Record<string, unknown>[]).map(rowToUser); }
  findByLogin(login: string): UserRecord | null { const row = this.db.prepare('SELECT * FROM users WHERE login = ?').get(login) as Record<string, unknown> | undefined; return row ? rowToUser(row) : null; }
  findById(id: string): UserRecord | null { const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined; return row ? rowToUser(row) : null; }

  insertUser(user: UserRecord): void {
    this.db.prepare(`INSERT INTO users (id, login, passwordHash, role, isActive, createdAt, updatedAt, lastLoginAt, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(user.id, user.login, user.passwordHash, user.role, user.isActive, user.createdAt, user.updatedAt, user.lastLoginAt, user.createdBy);
  }

  updateUser(id: string, patch: Partial<UserRecord>): UserRecord | null {
    const existing = this.findById(id);
    if (!existing) return null;
    const next = { ...existing, ...patch };
    this.db.prepare(`UPDATE users SET login = ?, passwordHash = ?, role = ?, isActive = ?, createdAt = ?, updatedAt = ?, lastLoginAt = ?, createdBy = ? WHERE id = ?`)
      .run(next.login, next.passwordHash, next.role, next.isActive, next.createdAt, next.updatedAt, next.lastLoginAt, next.createdBy, id);
    return this.findById(id);
  }

  countProgramMappings(): number { return this.count('SELECT COUNT(*) AS count FROM program_mappings'); }
  listProgramMappings(): ProgramMappingRecord[] { return (this.db.prepare('SELECT * FROM program_mappings ORDER BY updatedAt DESC').all() as Record<string, unknown>[]).map(rowToProgramMapping); }
  findProgramMappingById(id: string): ProgramMappingRecord | null { const row = this.db.prepare('SELECT * FROM program_mappings WHERE id = ?').get(id) as Record<string, unknown> | undefined; return row ? rowToProgramMapping(row) : null; }

  insertProgramMapping(mapping: ProgramMappingRecord): void {
    this.db.prepare(`INSERT INTO program_mappings (id, barcodePattern, programNumber, programText, description, isActive, matchType, createdAt, updatedAt, createdBy, updatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(mapping.id, mapping.barcodePattern, mapping.programNumber, mapping.programText, mapping.description, boolToInt(mapping.isActive), mapping.matchType, mapping.createdAt, mapping.updatedAt, mapping.createdBy, mapping.updatedBy);
  }

  updateProgramMapping(id: string, patch: Partial<ProgramMappingRecord>): ProgramMappingRecord | null {
    const existing = this.findProgramMappingById(id);
    if (!existing) return null;
    const next = { ...existing, ...patch };
    this.db.prepare(`UPDATE program_mappings SET barcodePattern = ?, programNumber = ?, programText = ?, description = ?, isActive = ?, matchType = ?, createdAt = ?, updatedAt = ?, createdBy = ?, updatedBy = ? WHERE id = ?`)
      .run(next.barcodePattern, next.programNumber, next.programText, next.description, boolToInt(next.isActive), next.matchType, next.createdAt, next.updatedAt, next.createdBy, next.updatedBy, id);
    return this.findProgramMappingById(id);
  }

  insertTestResult(result: LpcResult, currentTestId: string | null): void {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare(`INSERT INTO test_results (
      id, receivedAt, source, messageId, messageType, channel, port, program, programText, programNumber, linkInfo, result,
      testerTime, testerDate, uniqueId, totalAbs, programEvaluation, spcFlag, barcode, barcodeFromResult, operatorLogin, operatorRole,
      testType, testEvaluation, leakType, leakValue, leakUnit, RL, RL_unit, Pt, Pt_unit, EDC, EDC_unit, PL, PL_unit, LLR, LLR_unit,
      HLR, HLR_unit, FPR, FPR_unit, measurementsJson, raw, normalized, currentTestId, createdAt
    ) VALUES (${Array.from({ length: 46 }, () => '?').join(', ')})`).run(
      id, result.receivedAt, result.source, result.messageId, result.messageType, result.channel, result.port, result.program, result.programText,
      result.programText?.startsWith('P') ? Number(result.programText.slice(1)) : null, result.linkInfo, result.result,
      result.testerTime, result.testerDate, result.uniqueId, result.totalAbs, result.programEvaluation, result.spcFlag, result.barcode,
      result.barcodeFromResult, result.operatorLogin ?? null, result.operatorRole ?? null, result.testType, result.testEvaluation, result.leakType,
      result.leakValue, result.leakUnit, result.RL, result.RL_unit, result.Pt, result.Pt_unit, result.EDC, result.EDC_unit, result.PL,
      result.PL_unit, result.LLR, result.LLR_unit, result.HLR, result.HLR_unit, result.FPR, result.FPR_unit, JSON.stringify(result.measurements ?? {}),
      result.raw, result.normalized, currentTestId, createdAt,
    );
  }

  listTestResults(query: TestResultQuery = {}): { results: LpcResult[]; total: number } {
    const where: string[] = [];
    const params: Array<string | number> = [];
    const addLike = (field: string, value?: string) => { if (value) { where.push(`${field} LIKE ?`); params.push(`%${value}%`); } };
    if (query.result) { where.push('result = ?'); params.push(query.result); }
    addLike('barcode', query.barcode);
    addLike('operatorLogin', query.operatorLogin);
    addLike('programText', query.programText);
    if (query.dateFrom) { where.push('receivedAt >= ?'); params.push(query.dateFrom); }
    if (query.dateTo) { where.push('receivedAt <= ?'); params.push(query.dateTo); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = this.db.prepare(`SELECT COUNT(*) AS count FROM test_results ${whereSql}`).get(...params) as { count?: number } | undefined;
    const total = Number(totalRow?.count ?? 0);
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);
    const rows = this.db.prepare(`SELECT * FROM test_results ${whereSql} ORDER BY receivedAt DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as Record<string, unknown>[];
    return { total, results: rows.map(rowToResult) };
  }

  getLastTestResult(): LpcResult | null {
    const row = this.db.prepare('SELECT * FROM test_results ORDER BY receivedAt DESC LIMIT 1').get() as Record<string, unknown> | undefined;
    return row ? rowToResult(row) : null;
  }

  upsertTestSession(session: StoredTestSession): void {
    this.db.prepare(`INSERT INTO test_sessions (id, status, barcode, programNumber, programText, operatorLogin, startedAt, completedAt, lastStreamAt, timeoutAt, message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, barcode = excluded.barcode, programNumber = excluded.programNumber, programText = excluded.programText,
      operatorLogin = excluded.operatorLogin, startedAt = excluded.startedAt, completedAt = excluded.completedAt, lastStreamAt = excluded.lastStreamAt,
      timeoutAt = excluded.timeoutAt, message = excluded.message`)
      .run(session.id, session.status, session.barcode, session.programNumber, session.programText, session.operatorLogin, session.startedAt, session.completedAt, session.lastStreamAt, session.timeoutAt, session.message);
  }

  getLatestTestSession(): StoredTestSession | null {
    const row = this.db.prepare('SELECT * FROM test_sessions ORDER BY COALESCE(startedAt, completedAt, timeoutAt) DESC LIMIT 1').get() as Record<string, unknown> | undefined;
    return row ? rowToSession(row) : null;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, login TEXT UNIQUE NOT NULL, passwordHash TEXT NOT NULL, role TEXT NOT NULL, isActive INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, lastLoginAt TEXT NULL, createdBy TEXT NULL);
      CREATE TABLE IF NOT EXISTS program_mappings (id TEXT PRIMARY KEY, barcodePattern TEXT NOT NULL, programNumber INTEGER NOT NULL, programText TEXT NOT NULL, description TEXT NULL, isActive INTEGER NOT NULL DEFAULT 1, matchType TEXT NOT NULL DEFAULT 'exact', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, createdBy TEXT NULL, updatedBy TEXT NULL);
      CREATE TABLE IF NOT EXISTS test_results (id TEXT PRIMARY KEY, receivedAt TEXT NOT NULL, source TEXT, messageId TEXT, messageType TEXT, channel TEXT, port TEXT, program TEXT, programText TEXT, programNumber INTEGER, linkInfo TEXT, result TEXT, testerTime TEXT, testerDate TEXT, uniqueId TEXT, totalAbs TEXT, programEvaluation TEXT, spcFlag TEXT, barcode TEXT, barcodeFromResult TEXT, operatorLogin TEXT, operatorRole TEXT, testType TEXT, testEvaluation TEXT, leakType TEXT, leakValue REAL, leakUnit TEXT, RL REAL, RL_unit TEXT, Pt REAL, Pt_unit TEXT, EDC REAL, EDC_unit TEXT, PL REAL, PL_unit TEXT, LLR REAL, LLR_unit TEXT, HLR REAL, HLR_unit TEXT, FPR REAL, FPR_unit TEXT, measurementsJson TEXT, raw TEXT, normalized TEXT, currentTestId TEXT NULL, createdAt TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_test_results_receivedAt ON test_results(receivedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_test_results_barcode ON test_results(barcode);
      CREATE INDEX IF NOT EXISTS idx_test_results_uniqueId ON test_results(uniqueId);
      CREATE INDEX IF NOT EXISTS idx_test_results_operatorLogin ON test_results(operatorLogin);
      CREATE INDEX IF NOT EXISTS idx_test_results_result ON test_results(result);
      CREATE INDEX IF NOT EXISTS idx_test_results_programText ON test_results(programText);
      CREATE TABLE IF NOT EXISTS test_sessions (id TEXT PRIMARY KEY, status TEXT NOT NULL, barcode TEXT, programNumber INTEGER, programText TEXT, operatorLogin TEXT, startedAt TEXT, completedAt TEXT, lastStreamAt TEXT, timeoutAt TEXT, message TEXT);
    `);
  }
}

export function createDatabase(dbPath: string): AppDatabase {
  return new AppDatabase(dbPath);
}
