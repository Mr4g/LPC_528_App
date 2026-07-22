import path from 'node:path';
import { createDatabase } from '../src/server/db/database';

const [, , dbPathArg, userIdArg] = process.argv;

if (!dbPathArg || !userIdArg) {
  console.error('Usage: npx tsx scripts/diagnose-user-delete.ts <dbPath> <userId>');
  process.exit(1);
}

const resolvedPath = dbPathArg === ':memory:' ? ':memory:' : path.resolve(dbPathArg);
const database = createDatabase(resolvedPath);
const identity = database.getDebugIdentity();
const users = database.listUsers();
const listMatch = users.find((user) => user.id === userIdArg) ?? null;
const safeListMatch = listMatch ? {
  id: listMatch.id,
  login: listMatch.login,
  role: listMatch.role,
  isActive: listMatch.isActive,
  deletedAt: listMatch.deletedAt,
  createdAt: listMatch.createdAt,
  updatedAt: listMatch.updatedAt,
} : null;
const inspection = database.inspectUser(userIdArg);
const rawDatabase = database.getRawDatabaseForDiagnostics();
let deleteChanges = 0;
let selectAfterDelete: Record<string, unknown> | null = null;
let rollbackConfirmed: Record<string, unknown> | null = null;

rawDatabase.prepare('BEGIN').run();
try {
  deleteChanges = rawDatabase.prepare('DELETE FROM users WHERE id = ?').run(userIdArg).changes;
  selectAfterDelete = (rawDatabase.prepare('SELECT id, login, isActive, deleted_at FROM users WHERE id = ?').get(userIdArg) as Record<string, unknown> | undefined) ?? null;
  rawDatabase.prepare('ROLLBACK').run();
  rollbackConfirmed = (rawDatabase.prepare('SELECT id, login, isActive, deleted_at FROM users WHERE id = ?').get(userIdArg) as Record<string, unknown> | undefined) ?? null;
} catch (error) {
  rawDatabase.prepare('ROLLBACK').run();
  throw error;
}

console.log(JSON.stringify({
  resolvedPath,
  databaseInstanceId: identity.instanceId,
  databaseList: identity.databases,
  listUsersCount: users.length,
  listMatch: safeListMatch,
  inspection,
  deleteChanges,
  selectAfterDelete,
  rollbackConfirmed,
}, null, 2));
