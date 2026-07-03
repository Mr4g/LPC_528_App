import { describe, expect, it } from 'vitest';
import { canCreateUser, canDeleteUser } from './usersRouter';

describe('users permissions', () => {
  it('admin can create every role', () => {
    expect(canCreateUser('admin', 'operator')).toBe(true);
    expect(canCreateUser('admin', 'line_leader')).toBe(true);
    expect(canCreateUser('admin', 'admin')).toBe(true);
  });

  it('line_leader can create operator and line_leader but not admin', () => {
    expect(canCreateUser('line_leader', 'operator')).toBe(true);
    expect(canCreateUser('line_leader', 'line_leader')).toBe(true);
    expect(canCreateUser('line_leader', 'admin')).toBe(false);
  });

  it('operator cannot create users', () => {
    expect(canCreateUser('operator', 'operator')).toBe(false);
    expect(canCreateUser('operator', 'line_leader')).toBe(false);
    expect(canCreateUser('operator', 'admin')).toBe(false);
  });

  it('admin can delete operator, line_leader and another admin when it is not the last active admin', () => {
    expect(canDeleteUser('admin', 'operator', 'admin-1', 'op-1', { activeAdminCount: 2 })).toEqual({ ok: true });
    expect(canDeleteUser('admin', 'line_leader', 'admin-1', 'll-1', { activeAdminCount: 2 })).toEqual({ ok: true });
    expect(canDeleteUser('admin', 'admin', 'admin-1', 'admin-2', { targetIsActive: true, activeAdminCount: 2 })).toEqual({ ok: true });
  });

  it('admin cannot delete self', () => {
    expect(canDeleteUser('admin', 'admin', 'admin-1', 'admin-1', { targetIsActive: true, activeAdminCount: 2 })).toMatchObject({ ok: false, code: 'CANNOT_DELETE_SELF' });
  });

  it('admin cannot delete last active admin', () => {
    expect(canDeleteUser('admin', 'admin', 'admin-1', 'admin-2', { targetIsActive: true, activeAdminCount: 1 })).toMatchObject({ ok: false, code: 'CANNOT_DELETE_LAST_ADMIN' });
  });

  it('line_leader can delete operator only', () => {
    expect(canDeleteUser('line_leader', 'operator', 'll-1', 'op-1', { activeAdminCount: 1 })).toEqual({ ok: true });
    expect(canDeleteUser('line_leader', 'line_leader', 'll-1', 'll-2', { activeAdminCount: 1 })).toMatchObject({ ok: false, code: 'INSUFFICIENT_ROLE' });
    expect(canDeleteUser('line_leader', 'admin', 'll-1', 'admin-1', { activeAdminCount: 1 })).toMatchObject({ ok: false, code: 'INSUFFICIENT_ROLE' });
  });

  it('operator cannot delete users', () => {
    expect(canDeleteUser('operator', 'operator', 'op-1', 'op-2', { activeAdminCount: 1 })).toMatchObject({ ok: false, code: 'INSUFFICIENT_ROLE' });
  });
});
