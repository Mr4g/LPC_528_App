import { Router } from 'express';
import type { LastResultStore } from '../lpc/LastResultStore';
import type { ResultHistoryStore } from '../lpc/ResultHistoryStore';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../server/auth/authMiddleware';
import type { AppDatabase } from '../server/db/database';
import { calibrationPresets } from './zebraConfig';
import type { ZebraService } from './zebraService';
import type { ZebraCalibrationPreset, ZebraLayoutConfig, ZebraResultLabelInput } from './zebraTypes';

function numberBody(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
}

function testPrintBodyToInput(body: Record<string, unknown>, defaultPressure: string): Partial<ZebraResultLabelInput> {
  return {
    resultStatus: body.status === 'NOK' || body.status === 'ERROR' || body.status === 'UNKNOWN' ? body.status : 'OK',
    testPressureLabel: typeof body.pressure === 'string' && body.pressure.trim() ? body.pressure.trim() : defaultPressure,
    leakText: typeof body.leak === 'string' && body.leak.trim() ? body.leak.trim() : '7,253 pa/s',
    operatorLogin: typeof body.operator === 'string' && body.operator.trim() ? body.operator.trim().toUpperCase() : 'GAZD',
    dateText: typeof body.date === 'string' && body.date.trim() ? body.date.trim() : '30.06.2026',
  };
}

function testPrintBodyToLayout(body: Record<string, unknown>): Partial<ZebraLayoutConfig> {
  return {
    widthDots: numberBody(body.widthDots),
    heightDots: numberBody(body.heightDots),
    labelOffsetX: numberBody(body.offsetX) ?? undefined,
    labelOffsetY: numberBody(body.offsetY) ?? undefined,
    fontLine1Height: numberBody(body.fontLine1),
    fontLine1Width: numberBody(body.fontLine1),
    fontLine2Height: numberBody(body.fontLine2),
    fontLine2Width: numberBody(body.fontLine2),
    fontLine3Height: numberBody(body.fontLine3),
    fontLine3Width: numberBody(body.fontLine3),
  };
}

export function createZebraRouter(options: { zebraService: ZebraService; lastResultStore: LastResultStore; resultHistoryStore: ResultHistoryStore; database?: AppDatabase }): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/status', requireRole(['admin', 'line_leader']), (_req, res) => res.json({ ok: true, ...options.zebraService.getStatus() }));

  router.post('/test-print', requireRole(['admin', 'line_leader']), async (req: AuthenticatedRequest, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
    const input = testPrintBodyToInput(body, options.zebraService.buildLabelInput({ result: 'ACCEPT' }).testPressureLabel);
    const layout = testPrintBodyToLayout(body);
    const result = await options.zebraService.printTestLabel(input, layout);
    res.status(result.ok ? 200 : 503).json(result);
  });

  router.post('/test-print-calibration', requireRole(['admin', 'line_leader']), async (req: AuthenticatedRequest, res) => {
    const preset = (req.body?.preset ?? 'custom') as ZebraCalibrationPreset;
    const layout = calibrationPresets[preset] ?? calibrationPresets.custom;
    const mergedLayout = options.zebraService.getLayout(layout);
    console.info(`[ZEBRA] calibration preset=${preset} PW=${mergedLayout.widthDots} LL=${mergedLayout.heightDots} font=${mergedLayout.fontLine1Height}/${mergedLayout.fontLine2Height}/${mergedLayout.fontLine3Height} y=${mergedLayout.line1Y}/${mergedLayout.line2Y}/${mergedLayout.line3Y} border=false`);
    const result = await options.zebraService.printTestLabel({}, layout);
    res.status(result.ok ? 200 : 503).json({ ...result, preset, layout: mergedLayout });
  });

  router.post('/preview-zpl', requireRole(['admin', 'line_leader']), (req: AuthenticatedRequest, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
    const input = testPrintBodyToInput(body, options.zebraService.buildLabelInput({ result: 'ACCEPT' }).testPressureLabel);
    const layout = testPrintBodyToLayout(body);
    const preview = options.zebraService.previewResultLabel({ result: input.resultStatus === 'NOK' ? 'REJECT' : input.resultStatus === 'OK' ? 'ACCEPT' : input.resultStatus, operatorLogin: input.operatorLogin, leakValue: 7.253, leakUnit: 'pa/s' }, { inputOverride: input, layout });
    res.json({ ok: true, zpl: preview.zpl, layout: preview.layout });
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
