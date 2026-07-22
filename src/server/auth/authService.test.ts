import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/database';
import { AuthService } from './authService';
import type { LpcResult } from '../../shared/types';

function service() {
  return new AuthService(createDatabase(':memory:'), 'test-secret-with-at-least-16-chars');
}

function resultForOperator(login: string): LpcResult {
  return {
    source: 'test',
    receivedAt: '2026-07-21T13:00:00.000Z',
    messageId: 'msg-1',
    messageType: 'R',
    channel: null,
    port: null,
    program: null,
    programText: 'P1',
    linkInfo: null,
    result: 'ACCEPT',
    value: 'ACCEPT',
    testerTime: null,
    testerDate: null,
    uniqueId: 'UID-1',
    totalAbs: null,
    programEvaluation: null,
    spcFlag: null,
    barcode: 'BARCODE1',
    barcodeFromResult: null,
    testType: null,
    testEvaluation: null,
    leakType: null,
    leakValue: null,
    leakUnit: null,
    resultDetailsRaw: null,
    measurements: {},
    RL: null,
    RL_unit: null,
    Pt: null,
    Pt_unit: null,
    EDC: null,
    EDC_unit: null,
    PL: null,
    PL_unit: null,
    LLR: null,
    LLR_unit: null,
    HLR: null,
    HLR_unit: null,
    FPR: null,
    FPR_unit: null,
    raw: 'raw',
    normalized: 'normalized',
    operatorLogin: login,
    operatorRole: 'operator',
  };
}

describe('AuthService', () => {
  it('creates default admin for empty database and does not expose passwordHash', () => {
    const auth = service();
    auth.seedDefaultAdmin('ADM', 'admin123');
    const users = auth.listUsers();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ login: 'ADM', role: 'admin', isActive: true });
    expect(users[0]).not.toHaveProperty('passwordHash');
  });

  it('repairs missing admin when a database has users but no admin', () => {
    const auth = service();
    auth.createUser({ login: 'OPR', password: 'test123', role: 'operator', createdBy: null });
    auth.seedDefaultAdmin('ADM', 'admin123');
    expect(auth.login('ADM', 'admin123')).toMatchObject({ login: 'ADM', role: 'admin' });
  });



  it('repairs default admin when existing admin has legacy inactive flags', () => {
    const db = createDatabase(':memory:');
    const auth = new AuthService(db, 'test-secret-with-at-least-16-chars');
    const admin = auth.createUser({ login: 'ADM', password: 'oldpass', role: 'admin', createdBy: null });
    db.updateUserIncludingDeleted(admin.id, { isActive: 0, deletedAt: '2026-07-14T13:28:19.103Z' });
    const seed = auth.seedDefaultAdmin('ADM', 'admin123');
    expect(seed.action).toBe('none');
    expect(auth.login('adm', 'oldpass')).toMatchObject({ login: 'ADM', role: 'admin' });
  });

  it('resets default admin password in development helper', () => {
    const auth = service();
    auth.seedDefaultAdmin('ADM', 'oldpass');
    const reset = auth.resetDefaultAdminFromEnv('adm', 'admin123');
    expect(reset.action).toBe('reset');
    expect(auth.login('ADM', 'admin123')).toMatchObject({ login: 'ADM', role: 'admin' });
  });

  it('logs in valid user and ignores legacy inactive/deleted flags', () => {
    const db = createDatabase(':memory:');
    const auth = new AuthService(db, 'test-secret-with-at-least-16-chars');
    const user = auth.createUser({ login: 'abc', password: 'test123', role: 'operator', createdBy: null });
    expect(auth.login('ABC', 'test123')).toMatchObject({ login: 'ABC', role: 'operator' });
    expect(auth.login('ABC', 'bad-password')).toBeNull();
    db.updateUserIncludingDeleted(user.id, { isActive: 0, deletedAt: '2026-07-14T13:28:19.103Z' });
    expect(auth.login('ABC', 'test123')).toMatchObject({ login: 'ABC', role: 'operator' });
  });

  it('returns legacy inactive and soft-deleted records in the administrative list', () => {
    const db = createDatabase(':memory:');
    const auth = new AuthService(db, 'test-secret-with-at-least-16-chars');
    const user = auth.createUser({ login: 'WSAD', password: 'test123', role: 'operator', createdBy: null });

    db.updateUserIncludingDeleted(user.id, { isActive: 0, deletedAt: '2026-07-14T13:28:19.103Z' });

    expect(auth.listUsers()).toContainEqual(expect.objectContaining({ id: user.id, login: 'WSAD', isActive: false, deletedAt: '2026-07-14T13:28:19.103Z' }));
  });

  it('requires hard delete before creating the same normalized login again', () => {
    const db = createDatabase(':memory:');
    const auth = new AuthService(db, 'test-secret-with-at-least-16-chars');
    const user = auth.createUser({ login: 'WSAD', password: 'oldpass', role: 'operator', createdBy: null });
    db.updateUser(user.id, { login: ' wsad ' });
    db.updateUserIncludingDeleted(user.id, { isActive: 0, deletedAt: '2026-07-14T13:28:19.103Z' });

    expect(() => auth.createUser({ login: 'WSAD', password: 'newpass', role: 'line_leader', createdBy: 'ADM' })).toThrow('Użytkownik z takim loginem już istnieje.');
  });

  it('rejects creating a second active user with a readable duplicate-login message', () => {
    const auth = service();
    auth.createUser({ login: 'OPR', password: 'test123', role: 'operator', createdBy: null });

    expect(() => auth.createUser({ login: 'opr', password: 'test123', role: 'operator', createdBy: null })).toThrow('Użytkownik z takim loginem już istnieje.');
  });

  it('hard deletes users so the same login and card can be created from scratch', () => {
    const db = createDatabase(':memory:');
    const auth = new AuthService(db, 'test-secret-with-at-least-16-chars');
    const user = auth.createUser({ login: 'WSAD', password: 'oldpass', role: 'operator', createdBy: null });
    auth.assignCard(user.id, '05389148');
    db.updateUserIncludingDeleted(user.id, { isActive: 0, deletedAt: '2026-07-14T13:28:19.103Z' });

    expect(auth.hardDeleteUser(user.id)).toBe(true);
    expect(auth.listUsers().some((item) => item.id === user.id)).toBe(false);
    expect(auth.findUserByLogin('WSAD')).toBeNull();

    const recreated = auth.createUser({ login: 'WSAD', password: 'newpass', role: 'line_leader', createdBy: 'ADM' });
    const withCard = auth.assignCard(recreated.id, '05389148');
    expect(recreated).toMatchObject({ login: 'WSAD', role: 'line_leader', isActive: true, deletedAt: null });
    expect(recreated.id).not.toBe(user.id);
    expect(withCard?.cardUidLast4).toBe('9148');
  });

  it('hard delete removes user sessions but preserves historical test results', () => {
    const db = createDatabase(':memory:');
    const auth = new AuthService(db, 'test-secret-with-at-least-16-chars');
    const user = auth.createUser({ login: 'WSAD', password: 'oldpass', role: 'operator', createdBy: null });
    db.upsertTestSession({ id: 'session-1', status: 'completed', barcode: 'BARCODE1', programNumber: 1, programText: 'P1', operatorUserId: user.id, operatorLogin: 'WSAD', startedAt: '2026-07-21T13:00:00.000Z', completedAt: '2026-07-21T13:01:00.000Z', firstLpcDataAt: null, lastLpcDataAt: null, lastStreamAt: null, finalResultAt: null, timeoutAt: null, message: null });
    db.insertTestResult(resultForOperator('WSAD'), 'session-1');

    expect(auth.hardDeleteUser(user.id)).toBe(true);

    expect(db.getLatestTestSession()).toBeNull();
    const results = db.listTestResults({ operatorLogin: 'WSAD' });
    expect(results.total).toBe(1);
    expect(results.results[0]).toMatchObject({ operatorLogin: 'WSAD', barcode: 'BARCODE1' });
  });
});
