import { describe, expect, it } from 'vitest';
import type { ProgramStartRequest } from '../shared/types';
import { MockProgramStarter } from './ProgramStarter';

const request: ProgramStartRequest = {
  type: 'program_start_request',
  barcode: '7472475',
  matchedKey: '7472475',
  program: 1,
  programText: 'P01',
  selectedAt: '2026-06-24T10:00:00.000Z',
};

describe('MockProgramStarter', () => {
  it('returns success without launching a process', async () => {
    const result = await new MockProgramStarter().startProgram(request);

    expect(result.attempted).toBe(true);
    expect(result.success).toBe(true);
    expect(result.mode).toBe('mock');
    expect(result.command).toBeUndefined();
  });
});
