import { Router } from 'express';
import type { AppDatabase, TestResultQuery } from '../db/database';
import { requireAuth } from '../auth/authMiddleware';

function parseLimit(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function createTestResultsRouter(database: AppDatabase): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    const query: TestResultQuery = {
      limit: parseLimit(req.query.limit, 50),
      offset: parseLimit(req.query.offset, 0),
      result: typeof req.query.result === 'string' ? req.query.result : undefined,
      barcode: typeof req.query.barcode === 'string' ? req.query.barcode : undefined,
      operatorLogin: typeof req.query.operatorLogin === 'string' ? req.query.operatorLogin : undefined,
      programText: typeof req.query.programText === 'string' ? req.query.programText : undefined,
      dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
      dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
    };
    const { results, total } = database.listTestResults(query);
    res.json({ ok: true, results, total });
  });

  return router;
}
