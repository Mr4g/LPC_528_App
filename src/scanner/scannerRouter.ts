import { Router } from 'express';
import type { Server } from 'socket.io';
import type { AppConfig } from '../config';
import type { ProgramStarter } from '../programs/ProgramStarter';
import { requireAuth, type AuthenticatedRequest } from '../server/auth/authMiddleware';
import { parseBarcodeScan } from './parseBarcodeScan';
import { mapBarcodeToProgram } from './mapBarcodeToProgram';
import type { ProgramMappingService } from '../programs/programMappingStore';
import type { TestSessionManager } from '../server/test-session/testSessionManager';
import { CurrentTestStore } from './currentTestStore';

export function createScannerRouter(options: {
  config: AppConfig;
  io: Server;
  programStarter: ProgramStarter;
  currentTestStore: CurrentTestStore;
  programMappingService?: ProgramMappingService;
  testSessionManager?: TestSessionManager;
}): Router {
  const router = Router();

  router.use(requireAuth);

  router.post('/scan', async (req: AuthenticatedRequest, res) => {
    const rawBarcode = typeof req.body?.barcode === 'string' ? req.body.barcode : '';
    const lock = options.testSessionManager?.assertCanStart();
    if (lock && !lock.ok) {
      return res.status(409).json({ ...(lock.response as object), barcode: rawBarcode, error: 'TEST_IN_PROGRESS' });
    }

    const scan = parseBarcodeScan(rawBarcode);

    if (!scan) {
      const message = 'Brak programu dla barcode';
      options.io.emit('scan:rejected', { barcode: rawBarcode, error: 'NO_MAPPING', message });
      return res.status(400).json({ ok: false, error: 'NO_MAPPING', barcode: rawBarcode, message });
    }

    const mapping = options.programMappingService
      ? options.programMappingService.mapBarcode(scan, options.config.BARCODE_PROGRAM_MAP)
      : mapBarcodeToProgram(scan, options.config.BARCODE_PROGRAM_MAP);
    if (!mapping.ok) {
      const message = 'Brak programu dla barcode';
      options.io.emit('scan:rejected', { barcode: mapping.barcode, error: mapping.error, message });
      return res.status(400).json({ ok: false, error: mapping.error, barcode: mapping.barcode, message });
    }

    const operatorContext = {
      operatorLogin: req.user?.login,
      operatorRole: req.user?.role,
    };
    const currentTest = { ...mapping.currentTest, ...operatorContext };
    const programStartRequest = { ...mapping.programStartRequest, ...operatorContext };

    options.currentTestStore.set(currentTest);
    options.testSessionManager?.start(currentTest);
    const programStart = await options.programStarter.startProgram(programStartRequest);
    if (!programStart.success) {
      options.testSessionManager?.fail(programStart.message);
    }
    const payload = {
      scan,
      currentTest,
      programStartRequest,
      programStart,
    };

    options.io.emit('scan:accepted', payload);
    return res.json({ ok: true, ...payload });
  });

  router.get('/current-test', (_req, res) => {
    res.json({ ok: true, currentTest: options.currentTestStore.get() });
  });

  return router;
}
