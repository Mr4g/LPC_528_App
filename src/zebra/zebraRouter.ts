import { Router } from 'express';
import type { LastResultStore } from '../lpc/LastResultStore';
import type { ResultHistoryStore } from '../lpc/ResultHistoryStore';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../server/auth/authMiddleware';
import type { AppDatabase } from '../server/db/database';
import type { ZebraService } from './zebraService';

export function createZebraRouter(options: { zebraService: ZebraService; lastResultStore: LastResultStore; resultHistoryStore: ResultHistoryStore; database?: AppDatabase }): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/status', requireRole(['admin', 'line_leader']), (_req, res) => res.json({ ok: true, ...options.zebraService.getStatus() }));

  router.post('/test-print', requireRole(['admin', 'line_leader']), async (req: AuthenticatedRequest, res) => {
    const result = await options.zebraService.printTestLabel(req.user?.login ?? 'TEST');
    res.status(result.ok ? 200 : 503).json(result);
  });

  router.post('/print-last-result', async (req: AuthenticatedRequest, res) => {
    const last = options.lastResultStore.get() ?? options.database?.getLastTestResult() ?? null;
    if (!last) return res.status(404).json({ ok: false, message: 'Brak ostatniego wyniku do wydruku' });
    const result = await options.zebraService.printResultLabel(last, { operatorLogin: req.user?.login, allowDuplicate: true });
    res.status(result.ok ? 200 : 503).json(result);
  });

  router.post('/print-result/:id', async (req: AuthenticatedRequest, res) => {
    const id = req.params.id;
    const result = (options.database?.listTestResults({ limit: 200 }).results ?? options.resultHistoryStore.getAll())
      .find((item) => item.uniqueId === id || `${item.receivedAt}-${item.uniqueId}` === id);
    if (!result) return res.status(404).json({ ok: false, message: 'Nie znaleziono wyniku do wydruku' });
    const print = await options.zebraService.printResultLabel(result, { operatorLogin: req.user?.login, allowDuplicate: true });
    res.status(print.ok ? 200 : 503).json(print);
  });

  return router;
}
