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

  it('logs in valid user and rejects bad password or inactive user', () => {
    const auth = service();
    const user = auth.createUser({ login: 'abc', password: 'test123', role: 'operator', createdBy: null });
    expect(auth.login('ABC', 'test123')).toMatchObject({ login: 'ABC', role: 'operator' });
    expect(auth.login('ABC', 'bad-password')).toBeNull();
    auth.setActive(user.id, false);
    expect(auth.login('ABC', 'test123')).toBeNull();
  });
});
