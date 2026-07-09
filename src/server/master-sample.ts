import { Router } from 'express';
import type { AppDatabase } from './db/database';
import { requireAuth, requireRole, type AuthenticatedRequest } from './auth/authMiddleware';

export interface MasterSampleStatus {
  enabled: boolean;
  requestedByUserId: string | null;
  requestedByLogin: string | null;
  requestedByRole: string | null;
  requestedAt: string | null;
  labelCopiesOnOk?: number;
}

export interface MasterSampleResultMetadata extends MasterSampleStatus {
  labelCopiesRequested?: number;
  labelCopiesPrinted?: number;
  printTriggered?: boolean;
  resetAfterTest?: boolean;
  printError?: string | null;
}

const SETTING_KEY = 'masterSample.status';
export const MASTER_SAMPLE_LABEL_COPIES = 2;

export function disabledMasterSample(): MasterSampleStatus {
  return { enabled: false, requestedByUserId: null, requestedByLogin: null, requestedByRole: null, requestedAt: null };
}

export class MasterSampleService {
  constructor(private readonly database: AppDatabase, private readonly onChange?: (status: MasterSampleStatus) => void) {}

  getStatus(): MasterSampleStatus {
    const raw = this.database.getSetting(SETTING_KEY);
    if (!raw) return disabledMasterSample();
    try {
      const parsed = JSON.parse(raw) as Partial<MasterSampleStatus>;
      return parsed.enabled ? { enabled: true, requestedByUserId: parsed.requestedByUserId ?? null, requestedByLogin: parsed.requestedByLogin ?? null, requestedByRole: parsed.requestedByRole ?? null, requestedAt: parsed.requestedAt ?? null, labelCopiesOnOk: MASTER_SAMPLE_LABEL_COPIES } : disabledMasterSample();
    } catch {
      return disabledMasterSample();
    }
  }

  enable(user: { id: string; login: string; role: string }): MasterSampleStatus {
    const status: MasterSampleStatus = { enabled: true, requestedByUserId: user.id, requestedByLogin: user.login, requestedByRole: user.role, requestedAt: new Date().toISOString(), labelCopiesOnOk: MASTER_SAMPLE_LABEL_COPIES };
    this.database.setSetting(SETTING_KEY, JSON.stringify(status), user.login);
    this.onChange?.(status);
    return status;
  }

  disable(login: string | null = null): MasterSampleStatus {
    const status = disabledMasterSample();
    this.database.setSetting(SETTING_KEY, JSON.stringify(status), login);
    this.onChange?.(status);
    return status;
  }

  snapshot(): MasterSampleResultMetadata {
    const status = this.getStatus();
    if (!status.enabled) return { ...status };
    return { ...status, labelCopiesOnOk: MASTER_SAMPLE_LABEL_COPIES, labelCopiesRequested: MASTER_SAMPLE_LABEL_COPIES, labelCopiesPrinted: 0, printTriggered: false, resetAfterTest: false, printError: null };
  }
}

export function createMasterSampleRouter(service: MasterSampleService): Router {
  const router = Router();
  router.use(requireAuth);
  router.get('/status', (_req, res) => res.json({ ok: true, ...service.getStatus() }));
  router.post('/enable', requireRole(['admin', 'line_leader']), (req: AuthenticatedRequest, res) => res.json({ ok: true, ...service.enable({ id: req.user!.id, login: req.user!.login, role: req.user!.role }) }));
  router.post('/disable', requireRole(['admin', 'line_leader']), (req: AuthenticatedRequest, res) => res.json({ ok: true, ...service.disable(req.user?.login ?? null) }));
  return router;
}
