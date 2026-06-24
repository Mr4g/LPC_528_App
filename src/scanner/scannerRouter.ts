import { Router } from 'express';
import type { Server } from 'socket.io';
import type { AppConfig } from '../config';
import type { ProgramStarter } from '../programs/ProgramStarter';
import { parseBarcodeScan } from './parseBarcodeScan';
import { mapBarcodeToProgram } from './mapBarcodeToProgram';
import { CurrentTestStore } from './currentTestStore';

export function createScannerRouter(options: {
  config: AppConfig;
  io: Server;
  programStarter: ProgramStarter;
  currentTestStore: CurrentTestStore;
}): Router {
  const router = Router();

  router.post('/scan', async (req, res) => {
    const rawBarcode = typeof req.body?.barcode === 'string' ? req.body.barcode : '';
    const scan = parseBarcodeScan(rawBarcode);

    if (!scan) {
      const message = 'Brak programu dla barcode';
      options.io.emit('scan:rejected', { barcode: rawBarcode, error: 'NO_MAPPING', message });
      return res.status(400).json({ ok: false, error: 'NO_MAPPING', barcode: rawBarcode, message });
    }

    const mapping = mapBarcodeToProgram(scan, options.config.BARCODE_PROGRAM_MAP);
    if (!mapping.ok) {
      const message = 'Brak programu dla barcode';
      options.io.emit('scan:rejected', { barcode: mapping.barcode, error: mapping.error, message });
      return res.status(400).json({ ok: false, error: mapping.error, barcode: mapping.barcode, message });
    }

    options.currentTestStore.set(mapping.currentTest);
    const programStart = await options.programStarter.startProgram(mapping.programStartRequest);
    const payload = {
      scan,
      currentTest: mapping.currentTest,
      programStartRequest: mapping.programStartRequest,
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
