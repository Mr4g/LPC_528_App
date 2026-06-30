import type { LpcMeasurementMap, MeasurementValue } from '../shared/types';
import { normalizeLpcLine } from './normalizeLpcLine';

export interface ParsedResultDetails {
  barcodeFromResult: string | null;
  barcode: string;
  testType: string | null;
  testEvaluation: string | null;
  leakType: string | null;
  leakValue: number | null;
  leakUnit: string | null;
  measurements: LpcMeasurementMap;
  RL: MeasurementValue;
  RL_unit: string | null;
  Pt: MeasurementValue;
  Pt_unit: string | null;
  EDC: MeasurementValue;
  EDC_unit: string | null;
  PL: MeasurementValue;
  PL_unit: string | null;
  LLR: MeasurementValue;
  LLR_unit: string | null;
  HLR: MeasurementValue;
  HLR_unit: string | null;
  FPR: MeasurementValue;
  FPR_unit: string | null;
}

const MEASUREMENT_KEYS = ['RL', 'Pt', 'EDC', 'PL', 'LLR', 'HLR', 'FPR'] as const;
const MEASUREMENT_KEY_SET = new Set<string>(MEASUREMENT_KEYS);

function parseNumber(value: string): number {
  return Number(value.replace(',', '.'));
}

function normalizeMeasurementUnit(unit: string): string {
  return unit.toLowerCase() === 'pa/s' ? 'Pa/s' : unit;
}

function emptyDetails(): ParsedResultDetails {
  return {
    barcodeFromResult: null,
    barcode: '',
    testType: null,
    testEvaluation: null,
    leakType: null,
    leakValue: null,
    leakUnit: null,
    measurements: {},
    RL: null,
    RL_unit: null,
    Pt: null,
    Pt_unit: null,
    EDC: null,
    EDC_unit: null,
    PL: null,
    PL_unit: null,
    LLR: null,
    LLR_unit: null,
    HLR: null,
    HLR_unit: null,
    FPR: null,
    FPR_unit: null,
  };
}

export function parseResultDetails(rawDetails: string | null | undefined): ParsedResultDetails {
  const details = emptyDetails();
  const normalized = normalizeLpcLine(rawDetails ?? '');
  if (!normalized) return details;

  const tokens = normalized.split(' ');
  details.barcodeFromResult = tokens[0] ?? null;
  details.barcode = details.barcodeFromResult ?? '';
  details.testType = tokens[1] ?? null;
  details.testEvaluation = tokens[2] ?? null;

  for (let index = 3; index < tokens.length - 2; index += 1) {
    const key = tokens[index];
    if (!MEASUREMENT_KEY_SET.has(key)) continue;

    const value = parseNumber(tokens[index + 1]);
    const unit = normalizeMeasurementUnit(tokens[index + 2]);
    if (!Number.isFinite(value) || !unit) continue;

    details.measurements[key] = { value, unit };
    if (details.leakType === null) {
      details.leakType = key;
      details.leakValue = value;
      details.leakUnit = unit;
    }

    switch (key) {
      case 'RL':
        details.RL = value;
        details.RL_unit = unit;
        break;
      case 'Pt':
        details.Pt = value;
        details.Pt_unit = unit;
        break;
      case 'EDC':
        details.EDC = value;
        details.EDC_unit = unit;
        break;
      case 'PL':
        details.PL = value;
        details.PL_unit = unit;
        break;
      case 'LLR':
        details.LLR = value;
        details.LLR_unit = unit;
        break;
      case 'HLR':
        details.HLR = value;
        details.HLR_unit = unit;
        break;
      case 'FPR':
        details.FPR = value;
        details.FPR_unit = unit;
        break;
    }
  }

  return details;
}
