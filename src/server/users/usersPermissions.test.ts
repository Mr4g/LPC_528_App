import { describe, expect, it } from 'vitest';
import { canManageTarget } from './usersRouter';

describe('users permissions', () => {
  it('line_leader can create/manage operator only', () => {
    expect(canManageTarget('line_leader', 'operator')).toBe(true);
    expect(canManageTarget('line_leader', 'admin')).toBe(false);
  });

  it('admin can create/manage line_leader but not another admin from UI/API', () => {
    expect(canManageTarget('admin', 'line_leader')).toBe(true);
    expect(canManageTarget('admin', 'admin')).toBe(false);
  });

  it('operator cannot manage users', () => {
    expect(canManageTarget('operator', 'operator')).toBe(false);
  });
});
