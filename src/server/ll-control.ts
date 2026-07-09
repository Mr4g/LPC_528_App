import crypto from 'node:crypto';
import { Router } from 'express';
import type { AppDatabase, LlControlFlag } from './db/database';
import { requireAuth, requireRole, type AuthenticatedRequest } from './auth/authMiddleware';
import type { SplunkBuffer } from './splunk/splunkBuffer';
import type { SplunkRuntimeConfig } from './splunk/splunkTypes';

export const LL_OPEN = 'OPEN';
export const LL_RESOLVED = 'RESOLVED';
export const LL_REQUIRED_MESSAGE = 'Ta sztuka wymaga kontroli LL. Zaloguj lidera linii, aby kontynuować.';
const NEEDS_LL = new Set(['NOK', 'REJECT', 'UNKNOWN']);
const RESOLVES_LL = new Set(['OK', 'ACCEPT', 'PASS']);
const REQUIRED_ROLES = new Set(['line_leader', 'admin']);
const blockedDebounce = new Map<string, number>();

export function normalizeResultStatus(value: string | null | undefined): string {
  const raw = String(value ?? '').trim().toUpperCase();
  if (raw === 'ACCEPT' || raw === 'PASS') return 'OK';
  if (raw === 'REJECT') return 'NOK';
  if (raw === 'ERROR') return 'NOK';
  return raw || 'UNKNOWN';
}
export function requiresLlControl(value: string | null | undefined): boolean { return NEEDS_LL.has(normalizeResultStatus(value)); }
export function resolvesLlControl(value: string | null | undefined): boolean { return RESOLVES_LL.has(normalizeResultStatus(value)); }
export function hasLlRole(role: string | null | undefined): boolean { return REQUIRED_ROLES.has(String(role ?? '')); }

function station(config: SplunkRuntimeConfig) { return { site: config.site, line: config.line, workplace: config.workplace, device: config.device }; }
function sendQuality(buffer: SplunkBuffer | undefined, config: SplunkRuntimeConfig | undefined, eventType: string, payload: object, testId: string | null = null) {
  if (!buffer || !config) return;
  void buffer.sendOrQueue({ time: Date.now() / 1000, index: config.index, source: config.source, sourcetype: config.sourcetype, event: payload as Record<string, unknown>, fields: { site: config.site ?? '', line: config.line ?? '', workplace: config.workplace, device: config.device } }).catch(() => undefined);
}

export function emitLlFlagged(buffer: SplunkBuffer | undefined, config: SplunkRuntimeConfig | undefined, flag: LlControlFlag) {
  sendQuality(buffer, config, 'lpc_ll_control_flagged', { eventType: 'lpc_ll_control_flagged', schemaVersion: 1, station: config ? station(config) : undefined, barcode: flag.barcode, flag: { status: flag.status, createdAt: flag.createdAt, createdByLogin: flag.createdByLogin, createdByRole: flag.createdByRole, reason: flag.reason }, sourceTest: { testId: flag.createdFromTestId, programText: flag.createdFromProgramText, programNumber: flag.createdFromProgramNumber, resultStatus: flag.createdFromResultStatus, resultRawStatus: flag.createdFromResultRawStatus, leakValue: flag.createdFromLeakValue, leakUnit: flag.createdFromLeakUnit, uniqueId: flag.createdFromUniqueId } }, flag.createdFromTestId);
}
export function emitLlBlocked(buffer: SplunkBuffer | undefined, config: SplunkRuntimeConfig | undefined, flag: LlControlFlag, user: { login?: string; role?: string }) {
  const key = `${flag.barcode}|${user.login ?? ''}`; const nowMs = Date.now();
  if (nowMs - (blockedDebounce.get(key) ?? 0) < 30_000) return;
  blockedDebounce.set(key, nowMs);
  sendQuality(buffer, config, 'lpc_ll_control_blocked', { eventType: 'lpc_ll_control_blocked', schemaVersion: 1, barcode: flag.barcode, operatorLogin: user.login ?? null, operatorRole: user.role ?? null, flagId: flag.id, blockedAt: new Date(nowMs).toISOString(), reason: 'LL_CONTROL_REQUIRED' });
}
export function emitLlResolved(buffer: SplunkBuffer | undefined, config: SplunkRuntimeConfig | undefined, flag: LlControlFlag) {
  sendQuality(buffer, config, 'lpc_ll_control_resolved', { eventType: 'lpc_ll_control_resolved', schemaVersion: 1, barcode: flag.barcode, flag: { status: flag.status, createdAt: flag.createdAt, resolvedAt: flag.resolvedAt, createdByLogin: flag.createdByLogin, resolvedByLogin: flag.resolvedByLogin, resolvedByRole: flag.resolvedByRole }, resolvedByTest: { testId: flag.resolvedByTestId, programText: flag.resolvedByProgramText, programNumber: flag.resolvedByProgramNumber, resultStatus: 'OK', leakValue: null, leakUnit: null, uniqueId: flag.resolvedByUniqueId } }, flag.resolvedByTestId);
}

export function createLlControlRouter(options: { database: AppDatabase; splunkBuffer?: SplunkBuffer; splunkConfig?: SplunkRuntimeConfig }): Router {
  const router = Router(); router.use(requireAuth);
  router.post('/flag', async (req: AuthenticatedRequest, res) => {
    const barcode = String(req.body?.barcode ?? '').trim(); const testId = String(req.body?.testId ?? '').trim();
    if (!barcode || !testId) return res.status(400).json({ ok: false, error: 'INVALID_REQUEST' });
    const result = options.database.findTestResultById(testId);
    if (!result || result.barcode !== barcode) return res.status(404).json({ ok: false, error: 'TEST_NOT_FOUND' });
    if (!requiresLlControl(result.result)) return res.status(400).json({ ok: false, error: 'RESULT_NOT_ELIGIBLE' });
    const existing = options.database.findOpenLlControlFlag(barcode);
    if (existing) return res.json({ ok: true, existing: true, flag: existing });
    const flag = options.database.insertLlControlFlag({ id: crypto.randomUUID(), barcode, status: LL_OPEN, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdByUserId: req.user?.id ?? null, createdByLogin: req.user?.login ?? null, createdByRole: req.user?.role ?? null, createdFromTestId: testId, createdFromProgramText: result.programText, createdFromProgramNumber: result.programText?.startsWith('P') ? Number(result.programText.slice(1)) : null, createdFromResultStatus: normalizeResultStatus(result.result), createdFromResultRawStatus: result.resultRawStatus ?? result.result, createdFromLeakValue: result.leakValue ?? result.RL, createdFromLeakUnit: result.leakUnit ?? result.RL_unit, createdFromUniqueId: result.uniqueId, reason: String(req.body?.reason ?? 'Operator requested LL control after NOK') });
    emitLlFlagged(options.splunkBuffer, options.splunkConfig, flag); res.json({ ok: true, existing: false, flag });
  });
  router.get('/open', (_req, res) => res.json({ ok: true, flags: options.database.listOpenLlControlFlags() }));
  router.get('/history', requireRole(['admin', 'line_leader']), (req, res) => res.json({ ok: true, flags: options.database.listLlControlHistory(typeof req.query.barcode === 'string' ? req.query.barcode : undefined) }));
  return router;
}
