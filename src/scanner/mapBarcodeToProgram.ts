import type { BarcodeScan, CurrentTest, ProgramStartRequest } from '../shared/types';

export interface BarcodeProgramMappingError {
  ok: false;
  error: 'NO_MAPPING';
  barcode: string;
  scannedAt: string;
}

export interface BarcodeProgramMappingSuccess {
  ok: true;
  currentTest: CurrentTest;
  programStartRequest: ProgramStartRequest;
}

export type BarcodeProgramMappingResult = BarcodeProgramMappingSuccess | BarcodeProgramMappingError;

function formatProgramText(program: number): string {
  return `P${String(program).padStart(2, '0')}`;
}

export function mapBarcodeToProgram(
  scan: BarcodeScan,
  barcodeProgramMap: Record<string, number>,
): BarcodeProgramMappingResult {
  const exactProgram = barcodeProgramMap[scan.barcode];
  const matchedKey = exactProgram === undefined
    ? Object.keys(barcodeProgramMap).find((key) => scan.barcode.includes(key))
    : scan.barcode;

  if (!matchedKey) {
    return {
      ok: false,
      error: 'NO_MAPPING',
      barcode: scan.barcode,
      scannedAt: scan.scannedAt,
    };
  }

  const program = barcodeProgramMap[matchedKey];
  const selectedAt = new Date().toISOString();
  const programText = formatProgramText(program);
  const currentTest: CurrentTest = {
    type: 'current_test',
    barcode: scan.barcode,
    matchedKey,
    program,
    programText,
    selectedAt,
  };

  return {
    ok: true,
    currentTest,
    programStartRequest: {
      type: 'program_start_request',
      barcode: scan.barcode,
      matchedKey,
      program,
      programText,
      selectedAt,
    },
  };
}
