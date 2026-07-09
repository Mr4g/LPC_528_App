import { describe, expect, it } from 'vitest';
import { createDatabase } from './db/database';
import { MASTER_SAMPLE_LABEL_COPIES, MasterSampleService } from './master-sample';

describe('MasterSampleService', () => {
  it('enables, persists status and disables master sample mode', () => {
    const db = createDatabase(':memory:');
    const service = new MasterSampleService(db);
    const enabled = service.enable({ id: 'll-1', login: 'LLA', role: 'line_leader' });
    expect(enabled.enabled).toBe(true);
    expect(enabled.requestedByLogin).toBe('LLA');
    expect(enabled.labelCopiesOnOk).toBe(MASTER_SAMPLE_LABEL_COPIES);
    expect(new MasterSampleService(db).getStatus().requestedByLogin).toBe('LLA');
    expect(service.disable('LLA').enabled).toBe(false);
  });

  it('creates a per-test snapshot with requested label copies', () => {
    const service = new MasterSampleService(createDatabase(':memory:'));
    service.enable({ id: 'adm-1', login: 'ADM', role: 'admin' });
    expect(service.snapshot()).toMatchObject({ enabled: true, requestedByLogin: 'ADM', labelCopiesRequested: 2, labelCopiesPrinted: 0, printTriggered: false, resetAfterTest: false });
    service.disable('ADM');
    expect(service.snapshot()).toEqual({ enabled: false, requestedByUserId: null, requestedByLogin: null, requestedByRole: null, requestedAt: null });
  });
});
