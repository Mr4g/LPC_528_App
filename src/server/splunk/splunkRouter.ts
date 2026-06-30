import { Router } from 'express';
import { requireRole } from '../auth/authMiddleware';
import type { SplunkBuffer } from './splunkBuffer';
import type { SplunkClient } from './splunkClient';

export function createSplunkRouter(client: SplunkClient, buffer: SplunkBuffer): Router {
  const router = Router();
  router.use(requireRole(['admin', 'line_leader']));

  router.get('/status', (_req, res) => {
    res.json({ ok: true, ...client.getStatus(), ...buffer.getStatus() });
  });

  router.post('/retry-buffer', async (_req, res) => {
    const retry = await buffer.retryPending();
    res.json({ ok: true, retry, ...buffer.getStatus() });
  });

  return router;
}
