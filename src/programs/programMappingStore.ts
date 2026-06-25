import crypto from 'node:crypto';
import type { BarcodeScan } from '../shared/types';
import type { AppDatabase } from '../server/db/database';
import { mapBarcodeToProgram, type BarcodeProgramMappingResult } from '../scanner/mapBarcodeToProgram';

export type ProgramMappingMatchType = 'exact' | 'contains';

export interface ProgramMappingRecord {
  id: string;
  barcodePattern: string;
  programNumber: number;
  programText: string;
  description: string | null;
  isActive: boolean;
  matchType: ProgramMappingMatchType;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ProgramMappingInput {
  barcodePattern?: unknown;
  programNumber?: unknown;
  description?: unknown;
  isActive?: unknown;
  matchType?: unknown;
}

export function formatProgramText(programNumber: number): string {
  return `P${String(programNumber).padStart(2, '0')}`;
}

function isMatchType(value: unknown): value is ProgramMappingMatchType {
  return value === 'exact' || value === 'contains';
}

function validateProgramMappingInput(input: ProgramMappingInput, partial = false): {
  barcodePattern?: string;
  programNumber?: number;
  description?: string | null;
  isActive?: boolean;
  matchType?: ProgramMappingMatchType;
} {
  const output: {
    barcodePattern?: string;
    programNumber?: number;
    description?: string | null;
    isActive?: boolean;
    matchType?: ProgramMappingMatchType;
  } = {};

  if (!partial || input.barcodePattern !== undefined) {
    const barcodePattern = typeof input.barcodePattern === 'string' ? input.barcodePattern.trim() : '';
    if (barcodePattern.length < 3 || barcodePattern.length > 100) throw new Error('Barcode musi mieć od 3 do 100 znaków.');
    output.barcodePattern = barcodePattern;
  }

  if (!partial || input.programNumber !== undefined) {
    const programNumber = Number(input.programNumber);
    if (!Number.isInteger(programNumber) || programNumber < 1 || programNumber > 31) throw new Error('Program musi być w zakresie 1–31.');
    output.programNumber = programNumber;
  }

  if (!partial || input.matchType !== undefined) {
    const matchType = input.matchType ?? 'exact';
    if (!isMatchType(matchType)) throw new Error('Typ dopasowania jest wymagany.');
    output.matchType = matchType;
  }

  if (input.description !== undefined) {
    output.description = typeof input.description === 'string' && input.description.trim() ? input.description.trim() : null;
  } else if (!partial) {
    output.description = null;
  }

  if (input.isActive !== undefined) output.isActive = Boolean(input.isActive);
  else if (!partial) output.isActive = true;

  return output;
}

export class ProgramMappingService {
  constructor(private readonly database: AppDatabase) {}

  list(): ProgramMappingRecord[] {
    return this.database.listProgramMappings();
  }

  create(input: ProgramMappingInput, actorLogin: string | null): ProgramMappingRecord {
    const data = validateProgramMappingInput(input, false);
    const now = new Date().toISOString();
    const programNumber = data.programNumber ?? 1;
    const mapping: ProgramMappingRecord = {
      id: crypto.randomUUID(),
      barcodePattern: data.barcodePattern ?? '',
      programNumber,
      programText: formatProgramText(programNumber),
      description: data.description ?? null,
      isActive: data.isActive ?? true,
      matchType: data.matchType ?? 'exact',
      createdAt: now,
      updatedAt: now,
      createdBy: actorLogin,
      updatedBy: actorLogin,
    };
    this.database.insertProgramMapping(mapping);
    return mapping;
  }

  update(id: string, input: ProgramMappingInput, actorLogin: string | null): ProgramMappingRecord | null {
    if (!this.database.findProgramMappingById(id)) return null;
    const data = validateProgramMappingInput(input, true);
    const patch: Partial<ProgramMappingRecord> = {
      ...data,
      updatedAt: new Date().toISOString(),
      updatedBy: actorLogin,
    };
    if (data.programNumber !== undefined) patch.programText = formatProgramText(data.programNumber);
    return this.database.updateProgramMapping(id, patch);
  }

  setActive(id: string, isActive: boolean, actorLogin: string | null): ProgramMappingRecord | null {
    return this.database.updateProgramMapping(id, {
      isActive,
      updatedAt: new Date().toISOString(),
      updatedBy: actorLogin,
    });
  }

  mapBarcode(scan: BarcodeScan, fallbackMap: Record<string, number>): BarcodeProgramMappingResult {
    const allMappings = this.list();
    if (allMappings.length === 0) return mapBarcodeToProgram(scan, fallbackMap);
    const activeMappings = allMappings.filter((mapping) => mapping.isActive);

    const candidates = activeMappings
      .filter((mapping) => mapping.matchType === 'exact' ? scan.barcode === mapping.barcodePattern : scan.barcode.includes(mapping.barcodePattern))
      .sort((a, b) => {
        if (a.matchType !== b.matchType) return a.matchType === 'exact' ? -1 : 1;
        if (a.barcodePattern.length !== b.barcodePattern.length) return b.barcodePattern.length - a.barcodePattern.length;
        return b.updatedAt.localeCompare(a.updatedAt);
      });

    const match = candidates[0];
    if (!match) {
      return {
        ok: false,
        error: 'NO_MAPPING',
        barcode: scan.barcode,
        scannedAt: scan.scannedAt,
      };
    }

    const selectedAt = new Date().toISOString();
    return {
      ok: true,
      currentTest: {
        type: 'current_test',
        barcode: scan.barcode,
        matchedKey: match.barcodePattern,
        program: match.programNumber,
        programText: match.programText,
        selectedAt,
        mappingId: match.id,
        matchType: match.matchType,
      },
      programStartRequest: {
        type: 'program_start_request',
        barcode: scan.barcode,
        matchedKey: match.barcodePattern,
        program: match.programNumber,
        programText: match.programText,
        selectedAt,
        mappingId: match.id,
        matchType: match.matchType,
      },
    };
  }
}
