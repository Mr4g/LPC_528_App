import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createDatabase, type AppDatabase } from '../db/database';
import { attachAuth, getSessionCookieName } from '../auth/authMiddleware';
import { AuthService } from '../auth/authService';
import { createUsersRouter } from './usersRouter';

async function listen(app: express.Express): Promise<{ server: Server; baseUrl: string }> {
  const server = await new Promise<Server>((resolve) => {
    const started = app.listen(0, () => resolve(started));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port.');
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function createApp(auth: AuthService): express.Express {
  const app = express();
  app.use(express.json());
  app.use(attachAuth(auth));
  app.use('/api/users', createUsersRouter(auth));
  return app;
}

async function setup(role: 'admin' | 'line_leader' | 'operator' = 'admin'): Promise<{ db: AppDatabase; auth: AuthService; baseUrl: string; cookie: string; close: () => Promise<void> }> {
  const db = createDatabase(':memory:');
  const auth = new AuthService(db, 'test-secret-with-at-least-16-chars');
  const actor = auth.createUser({ login: role === 'admin' ? 'ADM' : role === 'line_leader' ? 'LLA' : 'OPA', password: 'pass1234', role, createdBy: null });
  const { server, baseUrl } = await listen(createApp(auth));
  return {
    db,
    auth,
    baseUrl,
    cookie: `${getSessionCookieName()}=${auth.createSession({ id: actor.id, login: actor.login, role: actor.role })}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

describe('users router hard delete', () => {
  let closeServer: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (closeServer) await closeServer();
    closeServer = null;
  });

  it.each([
    { name: 'active user', patch: {} },
    { name: 'inactive user', patch: { isActive: 0 } },
    { name: 'legacy soft-deleted user', patch: { isActive: 0, deletedAt: '2026-07-14T13:28:19.103Z' } },
  ])('hard deletes and allows recreating $name through HTTP', async ({ patch }) => {
    const context = await setup('admin');
    closeServer = context.close;
    const target = context.auth.createUser({ login: 'WSAD', password: 'oldpass', role: 'operator', createdBy: 'ADM' });
    context.db.updateUserIncludingDeleted(target.id, patch);

    const listResponse = await fetch(`${context.baseUrl}/api/users`, { headers: { cookie: context.cookie } });
    const listPayload = await listResponse.json() as { users: Array<{ id: string; login: string }> };
    expect(listPayload.users).toContainEqual(expect.objectContaining({ id: target.id, login: 'WSAD' }));

    const deleteResponse = await fetch(`${context.baseUrl}/api/users/${target.id}`, { method: 'DELETE', headers: { cookie: context.cookie } });
    const deletePayload = await deleteResponse.json() as { ok: boolean; details?: { userDeleteChanges?: number } };
    expect(deleteResponse.status).toBe(200);
    expect(deletePayload).toMatchObject({ ok: true, details: { userDeleteChanges: 1 } });
    expect(context.db.findByIdIncludingDeleted(target.id)).toBeNull();

    const recreated = context.auth.createUser({ login: 'WSAD', password: 'newpass', role: 'line_leader', createdBy: 'ADM' });
    expect(recreated).toMatchObject({ login: 'WSAD', role: 'line_leader' });
    expect(recreated.id).not.toBe(target.id);
  });

  it.each([
    { login: 'SZPK', patch: { isActive: 0, deletedAt: '2026-07-10T10:22:43.491Z' } },
    { login: 'WOAA', patch: { isActive: 0, deletedAt: null } },
  ])('hard deletes exact legacy management record $login through HTTP', async ({ login, patch }) => {
    const context = await setup('admin');
    closeServer = context.close;
    const target = context.auth.createUser({ login, password: 'oldpass', role: 'operator', createdBy: 'ADM' });
    context.db.updateUserIncludingDeleted(target.id, patch);

    const listResponse = await fetch(`${context.baseUrl}/api/users`, { headers: { cookie: context.cookie } });
    const listPayload = await listResponse.json() as { users: Array<{ id: string; login: string }> };
    expect(listPayload.users).toContainEqual(expect.objectContaining({ id: target.id, login }));
    expect(context.auth.getUserForManagement(target.id)).toMatchObject({ id: target.id, login });

    const deleteResponse = await fetch(`${context.baseUrl}/api/users/${target.id}`, { method: 'DELETE', headers: { cookie: context.cookie } });
    const deletePayload = await deleteResponse.json() as { ok: boolean; details?: { userDeleteChanges?: number; existsAfterDelete?: boolean } };
    expect(deleteResponse.status).toBe(200);
    expect(deletePayload).toMatchObject({ ok: true, details: { userDeleteChanges: 1, existsAfterDelete: false } });
    expect(context.db.findByIdIncludingDeleted(target.id)).toBeNull();

    const recreated = context.auth.createUser({ login, password: 'newpass', role: 'line_leader', createdBy: 'ADM' });
    expect(recreated.id).not.toBe(target.id);
  });

  it.each(['line_leader', 'operator'] as const)('denies hard delete for %s through HTTP', async (role) => {
    const context = await setup(role);
    closeServer = context.close;
    const target = context.auth.createUser({ login: 'WSAD', password: 'oldpass', role: 'operator', createdBy: null });

    const response = await fetch(`${context.baseUrl}/api/users/${target.id}`, { method: 'DELETE', headers: { cookie: context.cookie } });
    expect(response.status).toBe(403);
    expect(context.db.findByIdIncludingDeleted(target.id)).toMatchObject({ id: target.id });
  });
});
