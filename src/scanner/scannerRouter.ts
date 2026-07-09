import { Router } from 'express';
import type { Server } from 'socket.io';
import type { AppConfig } from '../config';
import type { ProgramStarter } from '../programs/ProgramStarter';
import { requireAuth, type AuthenticatedRequest } from '../server/auth/authMiddleware';
import { parseBarcodeScan } from './parseBarcodeScan';
import { mapBarcodeToProgram } from './mapBarcodeToProgram';
import type { ProgramMappingService } from '../programs/programMappingStore';
import type { TestSessionManager } from '../server/test-session/testSessionManager';
import type { AuthService } from '../server/auth/authService';
import { CurrentTestStore } from './currentTestStore';
import type { AppDatabase } from '../server/db/database';
import type { SplunkBuffer } from '../server/splunk/splunkBuffer';
import type { SplunkRuntimeConfig } from '../server/splunk/splunkTypes';
import { emitLlBlocked, hasLlRole, LL_REQUIRED_MESSAGE } from '../server/ll-control';
import type { MasterSampleService } from '../server/master-sample';

export function createScannerRouter(options: {
  config: AppConfig;
  io: Server;
  programStarter: ProgramStarter;
  currentTestStore: CurrentTestStore;
  programMappingService?: ProgramMappingService;
  testSessionManager?: TestSessionManager;
  authService?: AuthService;
  database?: AppDatabase;
  splunkBuffer?: SplunkBuffer;
  splunkConfig?: SplunkRuntimeConfig;
  masterSampleService?: MasterSampleService;
}): Router {
  const router = Router();

  router.use(requireAuth);

  router.post('/scan', async (req: AuthenticatedRequest, res) => {
    const rawBarcode = typeof req.body?.barcode === 'string' ? req.body.barcode : '';
    const normalizedInput = rawBarcode.trim().replace(/[\r\n]/g, '');
    const cardUidRegex = new RegExp(options.config.CARD_UID_PATTERN);
    if (cardUidRegex.test(normalizedInput)) {
      return res.status(400).json({
        ok: false,
        code: 'CARD_UID_NOT_BARCODE',
        error: 'CARD_UID_NOT_BARCODE',
        message: 'Odczytano kartę operatora. To nie jest barcode produktu.',
      });
    }
    const lock = options.testSessionManager?.assertCanStart();
    if (lock && !lock.ok) {
      console.log(`[ACTIVE_TEST] scan rejected reason=TEST_IN_PROGRESS barcode=${rawBarcode}`);
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

    const openLlFlag = options.database?.findOpenLlControlFlag(mapping.currentTest.barcode) ?? null;
    if (openLlFlag && !hasLlRole(req.user?.role)) {
      emitLlBlocked(options.splunkBuffer, options.splunkConfig, openLlFlag, { login: req.user?.login, role: req.user?.role });
      options.io.emit('scan:rejected', { barcode: mapping.currentTest.barcode, error: 'LL_CONTROL_REQUIRED', code: 'LL_CONTROL_REQUIRED', errorCode: 'LL_CONTROL_REQUIRED', message: LL_REQUIRED_MESSAGE, llControl: { flagId: openLlFlag.id } });
      return res.status(403).json({ ok: false, error: 'LL_CONTROL_REQUIRED', code: 'LL_CONTROL_REQUIRED', errorCode: 'LL_CONTROL_REQUIRED', barcode: mapping.currentTest.barcode, message: LL_REQUIRED_MESSAGE, llControl: { flagId: openLlFlag.id } });
    }

    const operatorContext = {
      operatorUserId: req.user?.id,
      operatorLogin: req.user?.login,
      operatorRole: req.user?.role,
    };
    const masterSample = options.masterSampleService?.snapshot() ?? { enabled: false };
    const currentTest = { ...mapping.currentTest, ...operatorContext, masterSample, llControl: { requiredAtStart: Boolean(openLlFlag), flagId: openLlFlag?.id ?? null, testAllowedByRole: true, performedByRequiredRole: openLlFlag ? hasLlRole(req.user?.role) : false, resolvedByThisTest: false } };
    const programStartRequest = { ...mapping.programStartRequest, ...operatorContext, masterSample };

    options.currentTestStore.set(currentTest);
    const activeTest = options.testSessionManager?.start(currentTest) ?? null;
    options.authService?.markTestActivity(req.user?.id);
    const programStart = await options.programStarter.startProgram(programStartRequest);
    if (!programStart.success) {
      options.testSessionManager?.fail(programStart.message, 'PROGRAM_START_FAILED');
    }
    const payload = {
      scan,
      currentTest,
      programStartRequest,
      programStart,
      activeTest: options.testSessionManager?.getStatus() ?? activeTest,
    };

    options.io.emit('scan:accepted', payload);
    return res.json({ ok: true, ...payload });
  });

  router.get('/current-test', (_req, res) => {
    res.json({ ok: true, currentTest: options.currentTestStore.get() });
  });

  return router;
}
