import { describe, expect, it, vi } from 'vitest';
import { ZebraService, formatLeakText, mapResultStatus, resolveOperatorLogin } from './zebraService';
import type { ZebraConfig } from './zebraConfig';
import type { ZebraClient } from './zebraClient';

const config: ZebraConfig = { enabled: true, host: '127.0.0.1', port: 9100, printOnResult: true, labelWidthMm: 30, labelHeightMm: 8, dpi: 203, orientation: 'landscape', copies: 1, testPressureLabel: '6 Bar', connectTimeoutMs: 5000, fontLine1: 16, fontLine2: 16, fontLine3: 13, line1Y: 7, line2Y: 25, line3Y: 43, offsetX: 0, offsetY: 0, frameThickness: 2 };

function service(overrides: Partial<ZebraConfig> = {}) {
  const client = { sendZpl: vi.fn().mockResolvedValue({ ok: true, bytes: 10 }) } as unknown as ZebraClient;
  return { zebra: new ZebraService({ ...config, ...overrides }, client), client };
}

describe('ZebraService formatting', () => {
  it('maps LPC statuses and formats leak/operator', () => {
    expect(mapResultStatus('ACCEPT')).toBe('OK');
    expect(mapResultStatus('REJECT')).toBe('NOK');
    expect(formatLeakText(7.253, 'pa/s')).toBe('7,253 pa/s');
    expect(resolveOperatorLogin({}, null)).toBe('OP');
  });
});

describe('ZebraService printing', () => {
  it('prevents duplicate automatic prints by uniqueId', async () => {
    const { zebra, client } = service();
    await zebra.printResultLabel({ result: 'ACCEPT', uniqueId: 'u1', leakValue: 1, leakUnit: 'pa/s' }, { auto: true });
    const second = await zebra.printResultLabel({ result: 'ACCEPT', uniqueId: 'u1', leakValue: 1, leakUnit: 'pa/s' }, { auto: true });
    expect(second.status).toBe('duplicate');
    expect(client.sendZpl).toHaveBeenCalledTimes(1);
  });

  it('skips printing when Zebra is disabled', async () => {
    const { zebra, client } = service({ enabled: false });
    const result = await zebra.printResultLabel({ result: 'ACCEPT', uniqueId: 'u2' });
    expect(result.status).toBe('skipped');
    expect(client.sendZpl).not.toHaveBeenCalled();
  });
});
