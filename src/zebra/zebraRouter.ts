import { Router } from 'express';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../server/auth/authMiddleware';
import type { AppDatabase } from '../server/db/database';
import type { ZebraPrinter } from './ZebraPrinter';

export function createZebraRouter(database: AppDatabase, zebraPrinter: ZebraPrinter): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/settings', (_req, res) => {
    res.json({ ok: true, autoPrintEnabled: database.getSetting('zebra.autoPrintEnabled') !== 'false' });
  });

  router.patch('/settings', requireRole(['admin', 'line_leader']), (req: AuthenticatedRequest, res) => {
    const autoPrintEnabled = Boolean(req.body?.autoPrintEnabled);
    database.setSetting('zebra.autoPrintEnabled', String(autoPrintEnabled), req.user?.login ?? null);
    res.json({ ok: true, autoPrintEnabled });
  });

  router.post('/test-print', requireRole(['admin', 'line_leader']), async (_req, res) => {
    const zpl = zebraPrinter.buildTinyResultLabel('OK', 'P01', '5901234123457');
    res.json({ ok: true, zpl });
  });

  return router;
}
