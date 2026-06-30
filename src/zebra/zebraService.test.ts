import { describe, expect, it, vi } from 'vitest';
import { ZebraService, formatLeakText, isAutoPrintAllowed, mapResultStatus, resolveOperatorLogin } from './zebraService';
import type { ZebraConfig } from './zebraConfig';
import type { ZebraClient } from './zebraClient';

const config: ZebraConfig = { enabled: true, host: '127.0.0.1', port: 9100, printOnResult: true, widthDots: 240, heightDots: 96, dpi: 203, labelOffsetX: 0, labelOffsetY: 0, textX: 0, textWidthDots: 240, copies: 1, testPressureLabel: '6 Bar', connectTimeoutMs: 5000, fontLine1Height: 14, fontLine1Width: 14, fontLine2Height: 14, fontLine2Width: 14, fontLine3Height: 12, fontLine3Width: 12, line1Y: 4, line2Y: 30, line3Y: 56 };

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

describe('labelPrintMode policy', () => {
  it('allows and skips statuses according to mode', () => {
    expect(isAutoPrintAllowed('ok_only', 'OK')).toBe(true);
    expect(isAutoPrintAllowed('ok_only', 'NOK')).toBe(false);
    expect(isAutoPrintAllowed('ok_and_nok', 'OK')).toBe(true);
    expect(isAutoPrintAllowed('ok_and_nok', 'NOK')).toBe(true);
    expect(isAutoPrintAllowed('disabled', 'OK')).toBe(false);
    expect(isAutoPrintAllowed('disabled', 'NOK')).toBe(false);
  });
});

describe('ZebraService printing', () => {
  it('prevents duplicate automatic prints by uniqueId', async () => {
    const { zebra, client } = service();
    await zebra.printResultLabel({ result: 'ACCEPT', uniqueId: 'u1', leakValue: 1, leakUnit: 'pa/s' }, { auto: true, labelPrintMode: 'ok_only' });
    const second = await zebra.printResultLabel({ result: 'ACCEPT', uniqueId: 'u1', leakValue: 1, leakUnit: 'pa/s' }, { auto: true, labelPrintMode: 'ok_only' });
    expect(second.status).toBe('duplicate');
    expect(client.sendZpl).toHaveBeenCalledTimes(1);
  });

  it('skips automatic print when policy disallows the result', async () => {
    const { zebra, client } = service();
    const result = await zebra.printResultLabel({ result: 'REJECT', uniqueId: 'u3' }, { auto: true, labelPrintMode: 'ok_only' });
    expect(result.status).toBe('skipped');
    expect(client.sendZpl).not.toHaveBeenCalled();
  });

  it('skips printing when Zebra is disabled', async () => {
    const { zebra, client } = service({ enabled: false });
    const result = await zebra.printResultLabel({ result: 'ACCEPT', uniqueId: 'u2' });
    expect(result.status).toBe('skipped');
    expect(client.sendZpl).not.toHaveBeenCalled();
  });
});
