import { Router } from 'express';
import { requireRole, type AuthenticatedRequest } from '../server/auth/authMiddleware';
import type { ProgramMappingService } from './programMappingStore';

export function createProgramMappingsRouter(service: ProgramMappingService): Router {
  const router = Router();
  router.use(requireRole(['admin', 'line_leader']));

  router.get('/', (_req, res) => {
    res.json({ ok: true, mappings: service.list().map((mapping) => ({
      ...mapping,
      instructionPdf: service.getInstructionMetadata(mapping.id),
    })) });
  });

  router.post('/', (req: AuthenticatedRequest, res) => {
    try {
      const mapping = service.create(req.body ?? {}, req.user?.login ?? null);
      return res.status(201).json({ ok: true, mapping });
    } catch (error) {
      return res.status(400).json({ ok: false, error: 'INVALID_MAPPING', message: error instanceof Error ? error.message : 'Nie udało się zapisać mapowania.' });
    }
  });

  router.patch('/:id', (req: AuthenticatedRequest, res) => {
    try {
      const mapping = service.update(String(req.params.id), req.body ?? {}, req.user?.login ?? null);
      return mapping ? res.json({ ok: true, mapping }) : res.status(404).json({ ok: false, error: 'MAPPING_NOT_FOUND' });
    } catch (error) {
      return res.status(400).json({ ok: false, error: 'INVALID_MAPPING', message: error instanceof Error ? error.message : 'Nie udało się zapisać mapowania.' });
    }
  });

  router.patch('/:id/disable', (req: AuthenticatedRequest, res) => {
    const mapping = service.setActive(String(req.params.id), false, req.user?.login ?? null);
    return mapping ? res.json({ ok: true, mapping }) : res.status(404).json({ ok: false, error: 'MAPPING_NOT_FOUND' });
  });

  router.patch('/:id/enable', (req: AuthenticatedRequest, res) => {
    const mapping = service.setActive(String(req.params.id), true, req.user?.login ?? null);
    return mapping ? res.json({ ok: true, mapping }) : res.status(404).json({ ok: false, error: 'MAPPING_NOT_FOUND' });
  });

  router.delete('/:id', requireRole(['admin']), (req: AuthenticatedRequest, res) => {
    const mapping = service.setActive(String(req.params.id), false, req.user?.login ?? null);
    return mapping ? res.json({ ok: true, mapping }) : res.status(404).json({ ok: false, error: 'MAPPING_NOT_FOUND' });
  });

  return router;
}
