import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/database';
import { AuthService, CardAssignmentError } from './authService';
import { hashCardUid, normalizeCardUid } from './cardUid';

function service(idleMs = 15 * 60 * 1000) {
  return new AuthService(createDatabase(':memory:'), 'test-secret-with-at-least-16-chars', 12 * 60 * 60 * 1000, '^\\d{8}$', idleMs);
}

describe('card UID auth', () => {
  it('normalizes UID without dropping leading zeroes', () => {
    expect(normalizeCardUid('05389148\r\n')).toBe('05389148');
  });

  it('stores card hash and last4 without storing full UID', () => {
    const auth = service();
    const user = auth.createUser({ login: 'ABC', password: 'pass1234', role: 'operator', createdBy: null });
    auth.assignCard(user.id, '05389148');
    const stored = auth.findUserByLogin('ABC');
    expect(stored?.cardUidHash).toBe(hashCardUid('05389148', 'test-secret-with-at-least-16-chars'));
    expect(stored?.cardUidHash).not.toContain('05389148');
    expect(stored?.cardUidLast4).toBe('9148');
  });

  it('logs in with a known card and rejects an unknown card', () => {
    const auth = service();
    const user = auth.createUser({ login: 'ABC', password: 'pass1234', role: 'operator', createdBy: null });
    auth.assignCard(user.id, '05389148');
    expect(auth.loginByCard('05389148')).toMatchObject({ ok: true, user: { login: 'ABC' } });
    expect(auth.loginByCard('00000000')).toMatchObject({ ok: false, reason: 'UNKNOWN_CARD' });
  });

  it('prevents assigning the same card to two users', () => {
    const auth = service();
    const first = auth.createUser({ login: 'ABC', password: 'pass1234', role: 'operator', createdBy: null });
    const second = auth.createUser({ login: 'DEF', password: 'pass1234', role: 'operator', createdBy: null });
    auth.assignCard(first.id, '05389148');
    expect(() => auth.assignCard(second.id, '05389148')).toThrow(CardAssignmentError);
  });

  it('handles same-card logout, switched user, unknown card and active test lock', () => {
    const auth = service();
    const first = auth.createUser({ login: 'ABC', password: 'pass1234', role: 'operator', createdBy: null });
    const second = auth.createUser({ login: 'DEF', password: 'pass1234', role: 'operator', createdBy: null });
    auth.assignCard(first.id, '05389148');
    auth.assignCard(second.id, '12345678');
    expect(auth.handleCardAction('05389148', { id: first.id, login: 'ABC', role: 'operator' }, false)).toMatchObject({ ok: true, action: 'LOGGED_OUT' });
    expect(auth.handleCardAction('12345678', { id: first.id, login: 'ABC', role: 'operator' }, false)).toMatchObject({ ok: true, action: 'SWITCHED_USER', user: { login: 'DEF' } });
    expect(auth.handleCardAction('99999999', { id: first.id, login: 'ABC', role: 'operator' }, false)).toMatchObject({ ok: false, action: 'UNKNOWN_CARD' });
    expect(auth.handleCardAction('12345678', { id: first.id, login: 'ABC', role: 'operator' }, true)).toMatchObject({ ok: false, action: 'TEST_IN_PROGRESS' });
  });

  it('expires sessions by production/test activity, not UI clicks', () => {
    const auth = service(100);
    const user = auth.createUser({ login: 'ABC', password: 'pass1234', role: 'operator', createdBy: null });
    const session = auth.createSession({ id: user.id, login: 'ABC', role: 'operator' });
    expect(auth.verifySession(session)?.login).toBe('ABC');
    const old = new Date(Date.now() - 1000).toISOString();
    auth.markTestActivity(user.id, old);
    expect(auth.verifySession(session)).toBeNull();
    auth.markTestActivity(user.id, new Date().toISOString());
    expect(auth.verifySession(session)?.login).toBe('ABC');
  });
});
