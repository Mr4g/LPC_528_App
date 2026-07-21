import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/database';
import { AuthService } from './authService';

function service() {
  return new AuthService(createDatabase(':memory:'), 'test-secret-with-at-least-16-chars');
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



  it('creates default admin when there is no active admin', () => {
    const auth = service();
    const admin = auth.createUser({ login: 'ADM', password: 'oldpass', role: 'admin', createdBy: null });
    auth.setActive(admin.id, false);
    const seed = auth.seedDefaultAdmin('ADM', 'admin123');
    expect(seed.action).toBe('repaired');
    expect(auth.login('adm', 'admin123')).toMatchObject({ login: 'ADM', role: 'admin' });
  });

  it('resets default admin password in development helper', () => {
    const auth = service();
    auth.seedDefaultAdmin('ADM', 'oldpass');
    const reset = auth.resetDefaultAdminFromEnv('adm', 'admin123');
    expect(reset.action).toBe('reset');
    expect(auth.login('ADM', 'admin123')).toMatchObject({ login: 'ADM', role: 'admin' });
  });

  it('logs in valid user and rejects bad password or inactive user', () => {
    const auth = service();
    const user = auth.createUser({ login: 'abc', password: 'test123', role: 'operator', createdBy: null });
    expect(auth.login('ABC', 'test123')).toMatchObject({ login: 'ABC', role: 'operator' });
    expect(auth.login('ABC', 'bad-password')).toBeNull();
    auth.setActive(user.id, false);
    expect(auth.login('ABC', 'test123')).toBeNull();
  });

  it('keeps deactivated users visible so managers can edit or remove them', () => {
    const auth = service();
    const user = auth.createUser({ login: 'WSAD', password: 'test123', role: 'operator', createdBy: null });

    auth.setActive(user.id, false);

    expect(auth.listUsers()).toContainEqual(expect.objectContaining({ id: user.id, login: 'WSAD', isActive: false }));
  });

  it('reactivates a soft-deleted user when the same login is created again', () => {
    const auth = service();
    const user = auth.createUser({ login: 'OPR', password: 'oldpass', role: 'operator', createdBy: null });
    auth.softDeleteUser(user.id);

    const recreated = auth.createUser({ login: 'opr', password: 'newpass', role: 'line_leader', createdBy: 'ADM' });

    expect(recreated).toMatchObject({ id: user.id, login: 'OPR', role: 'line_leader', isActive: true, deletedAt: null });
    expect(auth.login('OPR', 'oldpass')).toBeNull();
    expect(auth.login('OPR', 'newpass')).toMatchObject({ id: user.id, role: 'line_leader' });
    expect(auth.listUsers().filter((item) => item.login === 'OPR')).toHaveLength(1);
  });

  it('reactivates hidden users whose stored login casing or whitespace differs', () => {
    const db = createDatabase(':memory:');
    const auth = new AuthService(db, 'test-secret-with-at-least-16-chars');
    const user = auth.createUser({ login: 'WSAD', password: 'oldpass', role: 'operator', createdBy: null });
    db.updateUser(user.id, { login: ' wsad ' });
    auth.softDeleteUser(user.id);

    const recreated = auth.createUser({ login: 'WSAD', password: 'newpass', role: 'line_leader', createdBy: 'ADM' });

    expect(recreated).toMatchObject({ id: user.id, login: 'WSAD', role: 'line_leader', isActive: true, deletedAt: null });
    expect(auth.login('WSAD', 'newpass')).toMatchObject({ id: user.id, role: 'line_leader' });
  });

  it('rejects creating a second active user with a readable duplicate-login message', () => {
    const auth = service();
    auth.createUser({ login: 'OPR', password: 'test123', role: 'operator', createdBy: null });

    expect(() => auth.createUser({ login: 'opr', password: 'test123', role: 'operator', createdBy: null })).toThrow('Użytkownik z takim loginem już istnieje.');
  });

  it('soft deletes users, keeps them manageable, and blocks login/card lookup', () => {
    const auth = service();
    const user = auth.createUser({ login: 'OPR', password: 'test123', role: 'operator', createdBy: null });

    const deleted = auth.softDeleteUser(user.id);

    expect(deleted).toMatchObject({ id: user.id, isActive: false });
    expect(deleted?.deletedAt).toEqual(expect.any(String));
    expect(auth.listUsers()).toContainEqual(expect.objectContaining({ id: user.id, login: 'OPR', isActive: false, deletedAt: expect.any(String) }));
    expect(auth.getUserById(user.id)).toMatchObject({ id: user.id, deletedAt: expect.any(String) });
    expect(auth.login('OPR', 'test123')).toBeNull();

    const restored = auth.setActive(user.id, true);
    expect(restored).toMatchObject({ id: user.id, isActive: true, deletedAt: null });
    expect(auth.login('OPR', 'test123')).toMatchObject({ id: user.id });
  });
});
