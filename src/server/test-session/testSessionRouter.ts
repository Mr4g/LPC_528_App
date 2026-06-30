import { Router } from 'express';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/authMiddleware';
import type { TestSessionManager } from './testSessionManager';

export function createTestSessionRouter(testSessionManager: TestSessionManager): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/status', (_req, res) => {
    res.json(testSessionManager.getStatus());
  });

  router.post('/unlock', requireRole(['admin', 'line_leader']), (req: AuthenticatedRequest, res) => {
    res.json(testSessionManager.unlock(req.user?.login ?? null));
  });

  return router;
}
