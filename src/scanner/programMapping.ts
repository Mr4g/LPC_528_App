import type { ProgramStartRequest } from '../shared/types';

export const defaultBarcodeProgramMap: Record<string, number> = {
  '5901234123457': 1,
  '7472475': 1,
  '7472476': 2,
  '7472477': 3,
};

export function matchProgramRequest(barcode: string, map = defaultBarcodeProgramMap): ProgramStartRequest | null {
  const matchedKey = Object.keys(map).find((key) => barcode.includes(key));
  if (!matchedKey) return null;

  const program = map[matchedKey];
  return {
    type: 'program_start_request',
    barcode,
    matchedKey,
    program,
    programText: `P${String(program).padStart(2, '0')}`,
    selectedAt: new Date().toISOString(),
  };
}
