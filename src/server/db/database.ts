import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database, { type Database as BetterSqliteDatabase } from 'better-sqlite3';
import type { UserRecord } from '../auth/types';
import type { ProgramMappingRecord } from '../../programs/programMappingStore';
import type { LpcResult, ProgramLimitCacheEntry, ProgramLimitSnapshot } from '../../shared/types';
import type { SplunkBufferStatus, SplunkEventBufferRecord } from '../splunk/splunkTypes';

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

export interface LlControlFlag {
  id: string; barcode: string; status: string; createdAt: string; updatedAt: string;
  createdByUserId: string | null; createdByLogin: string | null; createdByRole: string | null;
  createdFromTestId: string | null; createdFromProgramText: string | null; createdFromProgramNumber: number | null; createdFromResultStatus: string | null; createdFromResultRawStatus: string | null; createdFromLeakValue: number | null; createdFromLeakUnit: string | null; createdFromUniqueId: string | null;
  resolvedAt: string | null; resolvedByUserId: string | null; resolvedByLogin: string | null; resolvedByRole: string | null; resolvedByTestId: string | null; resolvedByProgramText: string | null; resolvedByProgramNumber: number | null; resolvedByUniqueId: string | null;
  reason: string | null;
}

export interface StoredTestSession {
  id: string;
  status: string;
  barcode: string | null;
  programNumber: number | null;
  programText: string | null;
  operatorUserId: string | null;
  operatorLogin: string | null;
  startedAt: string | null;
  completedAt: string | null;
  firstLpcDataAt: string | null;
  lastLpcDataAt: string | null;
  lastStreamAt: string | null;
  finalResultAt: string | null;
  timeoutAt: string | null;
  message: string | null;
}

function boolToInt(value: boolean | number): number {
  return typeof value === 'number' ? value : value ? 1 : 0;
}

function isSqliteNotDatabaseError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'SQLITE_NOTADB';
}

function invalidDatabaseBackupPath(dbPath: string): string {
  return `${dbPath}.invalid-${new Date().toISOString().replace(/[:.]/g, '-')}`;
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
    cardUidHash: row.card_uid_hash === null || row.card_uid_hash === undefined ? null : String(row.card_uid_hash),
    cardUidLast4: row.card_uid_last4 === null || row.card_uid_last4 === undefined ? null : String(row.card_uid_last4),
    cardAssignedAt: row.card_assigned_at === null || row.card_assigned_at === undefined ? null : String(row.card_assigned_at),
    lastTestAt: row.last_test_at === null || row.last_test_at === undefined ? null : String(row.last_test_at),
    deletedAt: row.deleted_at === null || row.deleted_at === undefined ? null : String(row.deleted_at),
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
    labelPrintMode: (row.labelPrintMode === 'ok_and_nok' ? 'ok_and_nok' : 'ok_only'),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    createdBy: row.createdBy === null ? null : String(row.createdBy),
    updatedBy: row.updatedBy === null ? null : String(row.updatedBy),
    instructionPdfStoredName: row.instructionPdfStoredName === null || row.instructionPdfStoredName === undefined ? null : String(row.instructionPdfStoredName),
    instructionPdfOriginalName: row.instructionPdfOriginalName === null || row.instructionPdfOriginalName === undefined ? null : String(row.instructionPdfOriginalName),
    instructionPdfMimeType: row.instructionPdfMimeType === null || row.instructionPdfMimeType === undefined ? null : String(row.instructionPdfMimeType),
    instructionPdfSizeBytes: row.instructionPdfSizeBytes === null || row.instructionPdfSizeBytes === undefined ? null : Number(row.instructionPdfSizeBytes),
    instructionPdfUploadedAt: row.instructionPdfUploadedAt === null || row.instructionPdfUploadedAt === undefined ? null : String(row.instructionPdfUploadedAt),
    instructionPdfUploadedBy: row.instructionPdfUploadedBy === null || row.instructionPdfUploadedBy === undefined ? null : String(row.instructionPdfUploadedBy),
  };
}

function rowToLlFlag(row: Record<string, unknown>): LlControlFlag {
  const str = (name: string) => row[name] === null || row[name] === undefined ? null : String(row[name]);
  const num = (name: string) => row[name] === null || row[name] === undefined ? null : Number(row[name]);
  return { id: String(row.id), barcode: String(row.barcode), status: String(row.status), createdAt: String(row.createdAt), updatedAt: String(row.updatedAt), createdByUserId: str('createdByUserId'), createdByLogin: str('createdByLogin'), createdByRole: str('createdByRole'), createdFromTestId: str('createdFromTestId'), createdFromProgramText: str('createdFromProgramText'), createdFromProgramNumber: num('createdFromProgramNumber'), createdFromResultStatus: str('createdFromResultStatus'), createdFromResultRawStatus: str('createdFromResultRawStatus'), createdFromLeakValue: num('createdFromLeakValue'), createdFromLeakUnit: str('createdFromLeakUnit'), createdFromUniqueId: str('createdFromUniqueId'), resolvedAt: str('resolvedAt'), resolvedByUserId: str('resolvedByUserId'), resolvedByLogin: str('resolvedByLogin'), resolvedByRole: str('resolvedByRole'), resolvedByTestId: str('resolvedByTestId'), resolvedByProgramText: str('resolvedByProgramText'), resolvedByProgramNumber: num('resolvedByProgramNumber'), resolvedByUniqueId: str('resolvedByUniqueId'), reason: str('reason') };
}

function rowToProgramLimit(row: Record<string, unknown>): ProgramLimitCacheEntry {
  const str = (name: string) => row[name] === null || row[name] === undefined ? null : String(row[name]);
  const num = (name: string) => row[name] === null || row[name] === undefined ? null : Number(row[name]);
  return { id: String(row.id), programText: String(row.programText), programNumber: num('programNumber'), testType: String(row.testType), HLR: num('HLR'), HLR_unit: str('HLR_unit'), LLR: num('LLR'), LLR_unit: str('LLR_unit'), sourceUniqueId: str('sourceUniqueId'), sourceResultMessageId: str('sourceResultMessageId'), sourceTesterDate: str('sourceTesterDate'), sourceTesterTime: str('sourceTesterTime'), sourceResultAt: str('sourceResultAt'), createdAt: String(row.createdAt), updatedAt: String(row.updatedAt) };
}

function rowToSession(row: Record<string, unknown>): StoredTestSession {
  return {
    id: String(row.id),
    status: String(row.status),
    barcode: row.barcode === null ? null : String(row.barcode),
    programNumber: row.programNumber === null ? null : Number(row.programNumber),
    programText: row.programText === null ? null : String(row.programText),
    operatorUserId: row.operatorUserId === null || row.operatorUserId === undefined ? null : String(row.operatorUserId),
    operatorLogin: row.operatorLogin === null ? null : String(row.operatorLogin),
    startedAt: row.startedAt === null ? null : String(row.startedAt),
    completedAt: row.completedAt === null ? null : String(row.completedAt),
    firstLpcDataAt: row.firstLpcDataAt === null || row.firstLpcDataAt === undefined ? null : String(row.firstLpcDataAt),
    lastLpcDataAt: row.lastLpcDataAt === null || row.lastLpcDataAt === undefined ? null : String(row.lastLpcDataAt),
    lastStreamAt: row.lastStreamAt === null ? null : String(row.lastStreamAt),
    finalResultAt: row.finalResultAt === null || row.finalResultAt === undefined ? null : String(row.finalResultAt),
    timeoutAt: row.timeoutAt === null ? null : String(row.timeoutAt),
    message: row.message === null ? null : String(row.message),
  };
}


function rowToSplunkBuffer(row: Record<string, unknown>): SplunkEventBufferRecord {
  return {
    id: Number(row.id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    nextAttemptAt: row.next_attempt_at === null ? null : String(row.next_attempt_at),
    sentAt: row.sent_at === null ? null : String(row.sent_at),
    attempts: Number(row.attempts),
    lastError: row.last_error === null ? null : String(row.last_error),
    status: row.status as SplunkBufferStatus,
    eventType: String(row.event_type),
    testId: row.test_id === null ? null : String(row.test_id),
    payloadJson: String(row.payload_json),
  };
}

function rowToResult(row: Record<string, unknown>): LpcResult {
  return {
    id: row.id === null || row.id === undefined ? undefined : String(row.id),
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
    masterSample: row.masterSampleEnabled === undefined ? undefined : { enabled: Boolean(row.masterSampleEnabled), requestedByLogin: row.masterSampleRequestedByLogin === null || row.masterSampleRequestedByLogin === undefined ? null : String(row.masterSampleRequestedByLogin), requestedAt: row.masterSampleRequestedAt === null || row.masterSampleRequestedAt === undefined ? null : String(row.masterSampleRequestedAt), labelCopiesPrinted: row.masterSampleLabelCopiesPrinted === null || row.masterSampleLabelCopiesPrinted === undefined ? 0 : Number(row.masterSampleLabelCopiesPrinted) },
  };
}

export class AppDatabase {
  private readonly db: BetterSqliteDatabase;

  constructor(private readonly dbPath: string) {
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = this.openDatabase(dbPath);
    this.migrate();
  }

  private openDatabase(dbPath: string): BetterSqliteDatabase {
    let db = new Database(dbPath);
    try {
      this.configureDatabase(db);
      return db;
    } catch (error) {
      try { db.close(); } catch { /* ignore close errors before recreating invalid DB */ }
      if (dbPath === ':memory:' || !isSqliteNotDatabaseError(error)) throw error;

      const backupPath = invalidDatabaseBackupPath(dbPath);
      fs.renameSync(dbPath, backupPath);
      console.warn(`[DB] Existing SQLite file was invalid and has been moved to: ${backupPath}`);
      db = new Database(dbPath);
      this.configureDatabase(db);
      return db;
    }
  }

  private configureDatabase(db: BetterSqliteDatabase): void {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
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
  countUsers(): number { return this.count('SELECT COUNT(*) AS count FROM users WHERE deleted_at IS NULL'); }
  countActiveUsers(): number { return this.count('SELECT COUNT(*) AS count FROM users WHERE isActive = 1 AND deleted_at IS NULL'); }
  countAdmins(): number { return this.countAdminUsers(); }
  countAdminUsers(): number { return this.count("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND deleted_at IS NULL"); }
  countActiveAdminUsers(): number { return this.count("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND isActive = 1 AND deleted_at IS NULL"); }
  listUsers(): UserRecord[] { return (this.db.prepare('SELECT * FROM users ORDER BY login ASC').all() as Record<string, unknown>[]).map(rowToUser); }
  findByLogin(login: string): UserRecord | null { const row = this.db.prepare('SELECT * FROM users WHERE login = ? AND deleted_at IS NULL').get(login) as Record<string, unknown> | undefined; return row ? rowToUser(row) : null; }
  findByLoginIncludingDeleted(login: string): UserRecord | null { const row = this.db.prepare('SELECT * FROM users WHERE login = ?').get(login) as Record<string, unknown> | undefined; return row ? rowToUser(row) : null; }
  findByNormalizedLoginIncludingDeleted(login: string): UserRecord | null {
    const row = this.db.prepare('SELECT * FROM users WHERE UPPER(TRIM(login)) = ? ORDER BY deleted_at IS NULL DESC, isActive DESC, updatedAt DESC LIMIT 1').get(login) as Record<string, unknown> | undefined;
    return row ? rowToUser(row) : null;
  }
  findById(id: string): UserRecord | null { const row = this.db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(id) as Record<string, unknown> | undefined; return row ? rowToUser(row) : null; }
  findByCardUidHash(hash: string): UserRecord | null { const row = this.db.prepare('SELECT * FROM users WHERE card_uid_hash = ? AND isActive = 1 AND deleted_at IS NULL').get(hash) as Record<string, unknown> | undefined; return row ? rowToUser(row) : null; }

  insertUser(user: UserRecord): void {
    this.db.prepare(`INSERT INTO users (id, login, passwordHash, role, isActive, createdAt, updatedAt, lastLoginAt, createdBy, card_uid_hash, card_uid_last4, card_assigned_at, last_test_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(user.id, user.login, user.passwordHash, user.role, user.isActive, user.createdAt, user.updatedAt, user.lastLoginAt, user.createdBy, user.cardUidHash, user.cardUidLast4, user.cardAssignedAt, user.lastTestAt, user.deletedAt);
  }

  updateUser(id: string, patch: Partial<UserRecord>): UserRecord | null {
    return this.updateUserRecord(id, patch, false);
  }

  updateUserIncludingDeleted(id: string, patch: Partial<UserRecord>): UserRecord | null {
    return this.updateUserRecord(id, patch, true);
  }

  private updateUserRecord(id: string, patch: Partial<UserRecord>, includeDeleted: boolean): UserRecord | null {
    const existing = includeDeleted ? this.findByIdIncludingDeleted(id) : this.findById(id);
    if (!existing) return null;
    const next = { ...existing, ...patch };
    this.db.prepare(`UPDATE users SET login = ?, passwordHash = ?, role = ?, isActive = ?, createdAt = ?, updatedAt = ?, lastLoginAt = ?, createdBy = ?, card_uid_hash = ?, card_uid_last4 = ?, card_assigned_at = ?, last_test_at = ?, deleted_at = ? WHERE id = ?`)
      .run(next.login, next.passwordHash, next.role, next.isActive, next.createdAt, next.updatedAt, next.lastLoginAt, next.createdBy, next.cardUidHash, next.cardUidLast4, next.cardAssignedAt, next.lastTestAt, next.deletedAt, id);
    return next;
  }

  findByIdIncludingDeleted(id: string): UserRecord | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToUser(row) : null;
  }

  findProgramLimitCache(programText: string, testType: string): ProgramLimitCacheEntry | null {
    const row = this.db.prepare('SELECT * FROM program_limit_cache WHERE programText = ? AND testType = ?').get(programText, testType) as Record<string, unknown> | undefined;
    return row ? rowToProgramLimit(row) : null;
  }

  findProgramLimitCacheForStart(programText: string, testType?: string | null): ProgramLimitCacheEntry | null {
    if (testType) return this.findProgramLimitCache(programText, testType);
    const rows = this.db.prepare('SELECT * FROM program_limit_cache WHERE programText = ? ORDER BY updatedAt DESC').all(programText) as Record<string, unknown>[];
    return rows.length === 1 ? rowToProgramLimit(rows[0]) : null;
  }

  listProgramLimitCache(): ProgramLimitCacheEntry[] {
    return (this.db.prepare('SELECT * FROM program_limit_cache ORDER BY programText ASC, testType ASC').all() as Record<string, unknown>[]).map(rowToProgramLimit);
  }

  upsertProgramLimitCache(input: ProgramLimitSnapshot): { entry: ProgramLimitCacheEntry; changed: boolean; created: boolean } | null {
    if (!input.programText || !input.testType || (input.HLR === null && input.LLR === null)) return null;
    const existing = this.findProgramLimitCache(input.programText, input.testType);
    const now = new Date().toISOString();
    if (existing) {
      const changed = existing.HLR !== input.HLR || existing.HLR_unit !== input.HLR_unit || existing.LLR !== input.LLR || existing.LLR_unit !== input.LLR_unit;
      if (changed) {
        this.db.prepare('UPDATE program_limit_cache SET programNumber = ?, HLR = ?, HLR_unit = ?, LLR = ?, LLR_unit = ?, sourceUniqueId = ?, sourceResultMessageId = ?, sourceTesterDate = ?, sourceTesterTime = ?, sourceResultAt = ?, updatedAt = ? WHERE id = ?')
          .run(input.programNumber, input.HLR, input.HLR_unit, input.LLR, input.LLR_unit, input.sourceUniqueId ?? input.uniqueId ?? null, input.sourceResultMessageId ?? input.messageId ?? null, input.sourceTesterDate ?? null, input.sourceTesterTime ?? null, input.sourceResultAt ?? null, now, existing.id);
      }
      const entry = this.findProgramLimitCache(input.programText, input.testType)!;
      return { entry, changed, created: false };
    }
    const id = crypto.randomUUID();
    this.db.prepare('INSERT INTO program_limit_cache (id, programText, programNumber, testType, HLR, HLR_unit, LLR, LLR_unit, sourceUniqueId, sourceResultMessageId, sourceTesterDate, sourceTesterTime, sourceResultAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.programText, input.programNumber, input.testType, input.HLR, input.HLR_unit, input.LLR, input.LLR_unit, input.sourceUniqueId ?? input.uniqueId ?? null, input.sourceResultMessageId ?? input.messageId ?? null, input.sourceTesterDate ?? null, input.sourceTesterTime ?? null, input.sourceResultAt ?? null, now, now);
    return { entry: this.findProgramLimitCache(input.programText, input.testType)!, changed: true, created: true };
  }

  countProgramMappings(): number { return this.count('SELECT COUNT(*) AS count FROM program_mappings'); }
  listProgramMappings(): ProgramMappingRecord[] { return (this.db.prepare('SELECT * FROM program_mappings ORDER BY updatedAt DESC').all() as Record<string, unknown>[]).map(rowToProgramMapping); }
  findProgramMappingById(id: string): ProgramMappingRecord | null { const row = this.db.prepare('SELECT * FROM program_mappings WHERE id = ?').get(id) as Record<string, unknown> | undefined; return row ? rowToProgramMapping(row) : null; }

  insertProgramMapping(mapping: ProgramMappingRecord): void {
    this.db.prepare(`INSERT INTO program_mappings (id, barcodePattern, programNumber, programText, description, isActive, matchType, labelPrintMode, createdAt, updatedAt, createdBy, updatedBy, instructionPdfStoredName, instructionPdfOriginalName, instructionPdfMimeType, instructionPdfSizeBytes, instructionPdfUploadedAt, instructionPdfUploadedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(mapping.id, mapping.barcodePattern, mapping.programNumber, mapping.programText, mapping.description, boolToInt(mapping.isActive), mapping.matchType, mapping.labelPrintMode, mapping.createdAt, mapping.updatedAt, mapping.createdBy, mapping.updatedBy, mapping.instructionPdfStoredName, mapping.instructionPdfOriginalName, mapping.instructionPdfMimeType, mapping.instructionPdfSizeBytes, mapping.instructionPdfUploadedAt, mapping.instructionPdfUploadedBy);
  }

  updateProgramMapping(id: string, patch: Partial<ProgramMappingRecord>): ProgramMappingRecord | null {
    const existing = this.findProgramMappingById(id);
    if (!existing) return null;
    const next = { ...existing, ...patch };
    this.db.prepare(`UPDATE program_mappings SET barcodePattern = ?, programNumber = ?, programText = ?, description = ?, isActive = ?, matchType = ?, labelPrintMode = ?, createdAt = ?, updatedAt = ?, createdBy = ?, updatedBy = ?, instructionPdfStoredName = ?, instructionPdfOriginalName = ?, instructionPdfMimeType = ?, instructionPdfSizeBytes = ?, instructionPdfUploadedAt = ?, instructionPdfUploadedBy = ? WHERE id = ?`)
      .run(next.barcodePattern, next.programNumber, next.programText, next.description, boolToInt(next.isActive), next.matchType, next.labelPrintMode, next.createdAt, next.updatedAt, next.createdBy, next.updatedBy, next.instructionPdfStoredName, next.instructionPdfOriginalName, next.instructionPdfMimeType, next.instructionPdfSizeBytes, next.instructionPdfUploadedAt, next.instructionPdfUploadedBy, id);
    return this.findProgramMappingById(id);
  }

  insertTestResult(result: LpcResult, currentTestId: string | null): void {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare(`INSERT INTO test_results (
      id, receivedAt, source, messageId, messageType, channel, port, program, programText, programNumber, linkInfo, result,
      testerTime, testerDate, uniqueId, totalAbs, programEvaluation, spcFlag, barcode, barcodeFromResult, operatorLogin, operatorRole,
      testType, testEvaluation, leakType, leakValue, leakUnit, RL, RL_unit, Pt, Pt_unit, EDC, EDC_unit, PL, PL_unit, LLR, LLR_unit,
      HLR, HLR_unit, FPR, FPR_unit, measurementsJson, raw, normalized, currentTestId, createdAt, masterSampleEnabled, masterSampleRequestedByLogin, masterSampleRequestedAt, masterSampleLabelCopiesPrinted
    ) VALUES (${Array.from({ length: 50 }, () => '?').join(', ')})`).run(
      id, result.receivedAt, result.source, result.messageId, result.messageType, result.channel, result.port, result.program, result.programText,
      result.programText?.startsWith('P') ? Number(result.programText.slice(1)) : null, result.linkInfo, result.result,
      result.testerTime, result.testerDate, result.uniqueId, result.totalAbs, result.programEvaluation, result.spcFlag, result.barcode,
      result.barcodeFromResult, result.operatorLogin ?? null, result.operatorRole ?? null, result.testType, result.testEvaluation, result.leakType,
      result.leakValue, result.leakUnit, result.RL, result.RL_unit, result.Pt, result.Pt_unit, result.EDC, result.EDC_unit, result.PL,
      result.PL_unit, result.LLR, result.LLR_unit, result.HLR, result.HLR_unit, result.FPR, result.FPR_unit, JSON.stringify(result.measurements ?? {}),
      result.raw, result.normalized, currentTestId, createdAt, result.masterSample?.enabled ? 1 : 0, result.masterSample?.requestedByLogin ?? null, result.masterSample?.requestedAt ?? null, result.masterSample?.labelCopiesPrinted ?? 0,
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

  findTestResultById(id: string): LpcResult | null {
    const row = this.db.prepare('SELECT * FROM test_results WHERE id = ? OR currentTestId = ? ORDER BY receivedAt DESC LIMIT 1').get(id, id) as Record<string, unknown> | undefined;
    return row ? rowToResult(row) : null;
  }

  findOpenLlControlFlag(barcode: string): LlControlFlag | null {
    const row = this.db.prepare("SELECT * FROM ll_control_flags WHERE barcode = ? AND status = 'OPEN' ORDER BY createdAt DESC LIMIT 1").get(barcode) as Record<string, unknown> | undefined;
    return row ? rowToLlFlag(row) : null;
  }

  insertLlControlFlag(flag: Omit<LlControlFlag, 'resolvedAt' | 'resolvedByUserId' | 'resolvedByLogin' | 'resolvedByRole' | 'resolvedByTestId' | 'resolvedByProgramText' | 'resolvedByProgramNumber' | 'resolvedByUniqueId'>): LlControlFlag {
    this.db.prepare(`INSERT INTO ll_control_flags (id, barcode, status, createdAt, updatedAt, createdByUserId, createdByLogin, createdByRole, createdFromTestId, createdFromProgramText, createdFromProgramNumber, createdFromResultStatus, createdFromResultRawStatus, createdFromLeakValue, createdFromLeakUnit, createdFromUniqueId, reason) VALUES (${Array.from({ length: 17 }, () => '?').join(', ')})`)
      .run(flag.id, flag.barcode, flag.status, flag.createdAt, flag.updatedAt, flag.createdByUserId, flag.createdByLogin, flag.createdByRole, flag.createdFromTestId, flag.createdFromProgramText, flag.createdFromProgramNumber, flag.createdFromResultStatus, flag.createdFromResultRawStatus, flag.createdFromLeakValue, flag.createdFromLeakUnit, flag.createdFromUniqueId, flag.reason);
    return this.findOpenLlControlFlag(flag.barcode)!;
  }

  listOpenLlControlFlags(): LlControlFlag[] {
    return (this.db.prepare("SELECT * FROM ll_control_flags WHERE status = 'OPEN' ORDER BY createdAt DESC").all() as Record<string, unknown>[]).map(rowToLlFlag);
  }

  listLlControlHistory(barcode?: string): LlControlFlag[] {
    const rows = barcode ? this.db.prepare('SELECT * FROM ll_control_flags WHERE barcode = ? ORDER BY createdAt DESC').all(barcode) : this.db.prepare('SELECT * FROM ll_control_flags ORDER BY createdAt DESC LIMIT 500').all();
    return (rows as Record<string, unknown>[]).map(rowToLlFlag);
  }

  resolveLlControlFlag(barcode: string, patch: { resolvedByUserId: string | null; resolvedByLogin: string | null; resolvedByRole: string | null; resolvedByTestId: string | null; resolvedByProgramText: string | null; resolvedByProgramNumber: number | null; resolvedByUniqueId: string | null }): LlControlFlag | null {
    const existing = this.findOpenLlControlFlag(barcode);
    if (!existing) return null;
    const now = new Date().toISOString();
    this.db.prepare("UPDATE ll_control_flags SET status = 'RESOLVED', updatedAt = ?, resolvedAt = ?, resolvedByUserId = ?, resolvedByLogin = ?, resolvedByRole = ?, resolvedByTestId = ?, resolvedByProgramText = ?, resolvedByProgramNumber = ?, resolvedByUniqueId = ? WHERE id = ?")
      .run(now, now, patch.resolvedByUserId, patch.resolvedByLogin, patch.resolvedByRole, patch.resolvedByTestId, patch.resolvedByProgramText, patch.resolvedByProgramNumber, patch.resolvedByUniqueId, existing.id);
    return this.listLlControlHistory(barcode).find((flag) => flag.id === existing.id) ?? null;
  }

  updateTestResultMasterSample(currentTestId: string | null, metadata: { enabled?: boolean; requestedByLogin?: string | null; requestedAt?: string | null; labelCopiesPrinted?: number }): void {
    if (!currentTestId) return;
    this.db.prepare('UPDATE test_results SET masterSampleEnabled = ?, masterSampleRequestedByLogin = ?, masterSampleRequestedAt = ?, masterSampleLabelCopiesPrinted = ? WHERE currentTestId = ?')
      .run(metadata.enabled ? 1 : 0, metadata.requestedByLogin ?? null, metadata.requestedAt ?? null, metadata.labelCopiesPrinted ?? 0, currentTestId);
  }

  upsertTestSession(session: StoredTestSession): void {
    this.db.prepare(`INSERT INTO test_sessions (id, status, barcode, programNumber, programText, operatorUserId, operatorLogin, startedAt, completedAt, firstLpcDataAt, lastLpcDataAt, lastStreamAt, finalResultAt, timeoutAt, message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, barcode = excluded.barcode, programNumber = excluded.programNumber, programText = excluded.programText, operatorUserId = excluded.operatorUserId,
      operatorLogin = excluded.operatorLogin, startedAt = excluded.startedAt, completedAt = excluded.completedAt, firstLpcDataAt = excluded.firstLpcDataAt, lastLpcDataAt = excluded.lastLpcDataAt, lastStreamAt = excluded.lastStreamAt,
      finalResultAt = excluded.finalResultAt, timeoutAt = excluded.timeoutAt, message = excluded.message`)
      .run(session.id, session.status, session.barcode, session.programNumber, session.programText, session.operatorUserId, session.operatorLogin, session.startedAt, session.completedAt, session.firstLpcDataAt, session.lastLpcDataAt, session.lastStreamAt, session.finalResultAt, session.timeoutAt, session.message);
  }

  getLatestTestSession(): StoredTestSession | null {
    const row = this.db.prepare('SELECT * FROM test_sessions ORDER BY COALESCE(startedAt, completedAt, timeoutAt) DESC LIMIT 1').get() as Record<string, unknown> | undefined;
    return row ? rowToSession(row) : null;
  }


  enqueueSplunkEvent(input: { eventType: string; testId: string | null; payloadJson: string; lastError?: string | null; nextAttemptAt?: string | null }): number {
    const now = new Date().toISOString();
    const info = this.db.prepare(`INSERT INTO splunk_event_buffer (created_at, updated_at, next_attempt_at, sent_at, attempts, last_error, status, event_type, test_id, payload_json)
      VALUES (?, ?, ?, NULL, 0, ?, 'pending', ?, ?, ?)`)
      .run(now, now, input.nextAttemptAt ?? null, input.lastError ?? null, input.eventType, input.testId, input.payloadJson);
    return Number(info.lastInsertRowid);
  }

  listPendingSplunkEvents(limit = 25): SplunkEventBufferRecord[] {
    const now = new Date().toISOString();
    const rows = this.db.prepare(`SELECT * FROM splunk_event_buffer
      WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY created_at ASC LIMIT ?`).all(now, limit) as Record<string, unknown>[];
    return rows.map(rowToSplunkBuffer);
  }

  markSplunkEventSending(id: number): boolean {
    const info = this.db.prepare("UPDATE splunk_event_buffer SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'pending'")
      .run(new Date().toISOString(), id);
    return info.changes > 0;
  }

  markSplunkEventSent(id: number): void {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE splunk_event_buffer SET status = 'sent', sent_at = ?, updated_at = ?, last_error = NULL WHERE id = ?")
      .run(now, now, id);
  }

  markSplunkEventFailed(id: number, error: string, nextAttemptAt: string | null, maxAttempts: number): void {
    const row = this.db.prepare('SELECT attempts FROM splunk_event_buffer WHERE id = ?').get(id) as { attempts?: number } | undefined;
    const attempts = Number(row?.attempts ?? 0) + 1;
    const status = maxAttempts > 0 && attempts >= maxAttempts ? 'failed' : 'pending';
    this.db.prepare('UPDATE splunk_event_buffer SET status = ?, attempts = ?, last_error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?')
      .run(status, attempts, error, nextAttemptAt, new Date().toISOString(), id);
  }

  getSplunkBufferStats(): { pending: number; sending: number; sent: number; failed: number; lastError: string | null } {
    const pending = this.count("SELECT COUNT(*) AS count FROM splunk_event_buffer WHERE status = 'pending'");
    const sending = this.count("SELECT COUNT(*) AS count FROM splunk_event_buffer WHERE status = 'sending'");
    const sent = this.count("SELECT COUNT(*) AS count FROM splunk_event_buffer WHERE status = 'sent'");
    const failed = this.count("SELECT COUNT(*) AS count FROM splunk_event_buffer WHERE status = 'failed'");
    const row = this.db.prepare("SELECT last_error FROM splunk_event_buffer WHERE last_error IS NOT NULL ORDER BY updated_at DESC LIMIT 1").get() as { last_error?: string } | undefined;
    return { pending, sending, sent, failed, lastError: row?.last_error ?? null };
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, login TEXT UNIQUE NOT NULL, passwordHash TEXT NOT NULL, role TEXT NOT NULL, isActive INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, lastLoginAt TEXT NULL, createdBy TEXT NULL);
      CREATE TABLE IF NOT EXISTS program_mappings (id TEXT PRIMARY KEY, barcodePattern TEXT NOT NULL, programNumber INTEGER NOT NULL, programText TEXT NOT NULL, description TEXT NULL, isActive INTEGER NOT NULL DEFAULT 1, matchType TEXT NOT NULL DEFAULT 'exact', labelPrintMode TEXT NOT NULL DEFAULT 'ok_only', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, createdBy TEXT NULL, updatedBy TEXT NULL);
      CREATE TABLE IF NOT EXISTS test_results (id TEXT PRIMARY KEY, receivedAt TEXT NOT NULL, source TEXT, messageId TEXT, messageType TEXT, channel TEXT, port TEXT, program TEXT, programText TEXT, programNumber INTEGER, linkInfo TEXT, result TEXT, testerTime TEXT, testerDate TEXT, uniqueId TEXT, totalAbs TEXT, programEvaluation TEXT, spcFlag TEXT, barcode TEXT, barcodeFromResult TEXT, operatorLogin TEXT, operatorRole TEXT, testType TEXT, testEvaluation TEXT, leakType TEXT, leakValue REAL, leakUnit TEXT, RL REAL, RL_unit TEXT, Pt REAL, Pt_unit TEXT, EDC REAL, EDC_unit TEXT, PL REAL, PL_unit TEXT, LLR REAL, LLR_unit TEXT, HLR REAL, HLR_unit TEXT, FPR REAL, FPR_unit TEXT, measurementsJson TEXT, raw TEXT, normalized TEXT, currentTestId TEXT NULL, createdAt TEXT NOT NULL, masterSampleEnabled INTEGER NOT NULL DEFAULT 0, masterSampleRequestedByLogin TEXT NULL, masterSampleRequestedAt TEXT NULL, masterSampleLabelCopiesPrinted INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS idx_test_results_receivedAt ON test_results(receivedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_test_results_barcode ON test_results(barcode);
      CREATE INDEX IF NOT EXISTS idx_test_results_uniqueId ON test_results(uniqueId);
      CREATE INDEX IF NOT EXISTS idx_test_results_operatorLogin ON test_results(operatorLogin);
      CREATE INDEX IF NOT EXISTS idx_test_results_result ON test_results(result);
      CREATE INDEX IF NOT EXISTS idx_test_results_programText ON test_results(programText);
      CREATE TABLE IF NOT EXISTS program_limit_cache (id TEXT PRIMARY KEY, programText TEXT NOT NULL, programNumber INTEGER NULL, testType TEXT NOT NULL, HLR REAL NULL, HLR_unit TEXT NULL, LLR REAL NULL, LLR_unit TEXT NULL, sourceUniqueId TEXT NULL, sourceResultMessageId TEXT NULL, sourceTesterDate TEXT NULL, sourceTesterTime TEXT NULL, sourceResultAt TEXT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, UNIQUE(programText, testType));
      CREATE INDEX IF NOT EXISTS idx_program_limit_cache_program ON program_limit_cache(programText);
      CREATE TABLE IF NOT EXISTS test_sessions (id TEXT PRIMARY KEY, status TEXT NOT NULL, barcode TEXT, programNumber INTEGER, programText TEXT, operatorUserId TEXT, operatorLogin TEXT, startedAt TEXT, completedAt TEXT, firstLpcDataAt TEXT, lastLpcDataAt TEXT, lastStreamAt TEXT, finalResultAt TEXT, timeoutAt TEXT, message TEXT);
      CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL, updatedBy TEXT NULL);
      CREATE TABLE IF NOT EXISTS ll_control_flags (id TEXT PRIMARY KEY, barcode TEXT NOT NULL, status TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, createdByUserId TEXT NULL, createdByLogin TEXT NULL, createdByRole TEXT NULL, createdFromTestId TEXT NULL, createdFromProgramText TEXT NULL, createdFromProgramNumber INTEGER NULL, createdFromResultStatus TEXT NULL, createdFromResultRawStatus TEXT NULL, createdFromLeakValue REAL NULL, createdFromLeakUnit TEXT NULL, createdFromUniqueId TEXT NULL, resolvedAt TEXT NULL, resolvedByUserId TEXT NULL, resolvedByLogin TEXT NULL, resolvedByRole TEXT NULL, resolvedByTestId TEXT NULL, resolvedByProgramText TEXT NULL, resolvedByProgramNumber INTEGER NULL, resolvedByUniqueId TEXT NULL, reason TEXT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ll_control_flags_open_barcode ON ll_control_flags(barcode) WHERE status = 'OPEN';
      CREATE INDEX IF NOT EXISTS idx_ll_control_flags_status_created ON ll_control_flags(status, createdAt);
      CREATE TABLE IF NOT EXISTS splunk_event_buffer (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, next_attempt_at TEXT, sent_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, status TEXT NOT NULL DEFAULT 'pending', event_type TEXT NOT NULL, test_id TEXT, payload_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_splunk_event_buffer_status_next ON splunk_event_buffer(status, next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_splunk_event_buffer_test_id ON splunk_event_buffer(test_id);
    `);
    const userColumns = this.db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
    const addUserColumn = (name: string, sql: string) => { if (!userColumns.some((column) => column.name === name)) this.db.prepare(sql).run(); };
    addUserColumn('card_uid_hash', 'ALTER TABLE users ADD COLUMN card_uid_hash TEXT');
    addUserColumn('card_uid_last4', 'ALTER TABLE users ADD COLUMN card_uid_last4 TEXT');
    addUserColumn('card_assigned_at', 'ALTER TABLE users ADD COLUMN card_assigned_at TEXT');
    addUserColumn('last_test_at', 'ALTER TABLE users ADD COLUMN last_test_at TEXT');
    addUserColumn('deleted_at', 'ALTER TABLE users ADD COLUMN deleted_at TEXT');
    const resultColumns = this.db.prepare('PRAGMA table_info(test_results)').all() as Array<{ name: string }>;
    const addResultColumn = (name: string, sql: string) => { if (!resultColumns.some((column) => column.name === name)) this.db.prepare(sql).run(); };
    addResultColumn('masterSampleEnabled', 'ALTER TABLE test_results ADD COLUMN masterSampleEnabled INTEGER NOT NULL DEFAULT 0');
    addResultColumn('masterSampleRequestedByLogin', 'ALTER TABLE test_results ADD COLUMN masterSampleRequestedByLogin TEXT');
    addResultColumn('masterSampleRequestedAt', 'ALTER TABLE test_results ADD COLUMN masterSampleRequestedAt TEXT');
    addResultColumn('masterSampleLabelCopiesPrinted', 'ALTER TABLE test_results ADD COLUMN masterSampleLabelCopiesPrinted INTEGER NOT NULL DEFAULT 0');
    const sessionColumns = this.db.prepare('PRAGMA table_info(test_sessions)').all() as Array<{ name: string }>;
    if (!sessionColumns.some((column) => column.name === 'operatorUserId')) this.db.prepare('ALTER TABLE test_sessions ADD COLUMN operatorUserId TEXT').run();
    const addSessionColumn = (name: string, sql: string) => { if (!sessionColumns.some((column) => column.name === name)) this.db.prepare(sql).run(); };
    addSessionColumn('firstLpcDataAt', 'ALTER TABLE test_sessions ADD COLUMN firstLpcDataAt TEXT');
    addSessionColumn('lastLpcDataAt', 'ALTER TABLE test_sessions ADD COLUMN lastLpcDataAt TEXT');
    addSessionColumn('finalResultAt', 'ALTER TABLE test_sessions ADD COLUMN finalResultAt TEXT');
    this.db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_card_uid_hash ON users(card_uid_hash) WHERE card_uid_hash IS NOT NULL').run();
    const programColumns = this.db.prepare('PRAGMA table_info(program_mappings)').all() as Array<{ name: string }>;
    const addProgramColumn = (name: string, sql: string) => { if (!programColumns.some((column) => column.name === name)) this.db.prepare(sql).run(); };
    addProgramColumn('labelPrintMode', "ALTER TABLE program_mappings ADD COLUMN labelPrintMode TEXT NOT NULL DEFAULT 'ok_only'");
    addProgramColumn('instructionPdfStoredName', 'ALTER TABLE program_mappings ADD COLUMN instructionPdfStoredName TEXT');
    addProgramColumn('instructionPdfOriginalName', 'ALTER TABLE program_mappings ADD COLUMN instructionPdfOriginalName TEXT');
    addProgramColumn('instructionPdfMimeType', 'ALTER TABLE program_mappings ADD COLUMN instructionPdfMimeType TEXT');
    addProgramColumn('instructionPdfSizeBytes', 'ALTER TABLE program_mappings ADD COLUMN instructionPdfSizeBytes INTEGER');
    addProgramColumn('instructionPdfUploadedAt', 'ALTER TABLE program_mappings ADD COLUMN instructionPdfUploadedAt TEXT');
    addProgramColumn('instructionPdfUploadedBy', 'ALTER TABLE program_mappings ADD COLUMN instructionPdfUploadedBy TEXT');
    this.db.prepare("INSERT OR IGNORE INTO app_settings (key, value, updatedAt, updatedBy) VALUES ('zebra.autoPrintEnabled', 'true', ?, NULL)").run(new Date().toISOString());
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value?: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string, updatedBy: string | null): void {
    this.db.prepare('INSERT INTO app_settings (key, value, updatedAt, updatedBy) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt, updatedBy = excluded.updatedBy')
      .run(key, value, new Date().toISOString(), updatedBy);
  }
}

export function createDatabase(dbPath: string): AppDatabase {
  return new AppDatabase(dbPath);
}
