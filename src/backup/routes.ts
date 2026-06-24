import { Router } from 'express';

export function createBackupRouter(): Router {
  const router = Router();

  router.post('/run', (_req, res) => {
    // TODO: Execute configured backup command and report arguments.
    res.status(202).json({ status: 'accepted' });
  });

  router.get('/latest.csv', (_req, res) => {
    // TODO: Stream configured latest CSV path.
    res.status(501).json({ error: 'Backup CSV streaming not implemented yet' });
  });

  return router;
}
