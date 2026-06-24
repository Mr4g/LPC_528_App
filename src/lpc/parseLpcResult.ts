import type { LpcResult, LpcResultValue } from '../shared/types';
import { isIgnoredLpcLine, containsResultFrameSignature } from './lpcFrameFilters';
import { normalizeLpcLine } from './normalizeLpcLine';
import { parseResultDetails } from './parseResultDetails';

const RESULT_REGEX = /^(?:(\S+)\s+([A-Z])\s+)?(C\d{2})\s+(N\d+)\s+(P\d{2})\s+(\S+)\s+(\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d{2}\/\d{2}\/\d{2})\s+(\d+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/;

function deriveResult(messageType: string | null, linkInfo: string | null): LpcResultValue {
  const indicator = messageType ?? linkInfo?.charAt(0) ?? '';
  switch (indicator) {
    case 'A':
      return 'ACCEPT';
    case 'R':
      return 'REJECT';
    case 'E':
      return 'ERROR';
    default:
      return 'UNKNOWN';
  }
}

export function parseLpcResult(raw: string): LpcResult | null {
  if (isIgnoredLpcLine(raw) || !containsResultFrameSignature(raw)) return null;

  const normalized = normalizeLpcLine(raw);
  const match = normalized.match(RESULT_REGEX);
  if (!match) return null;

  const [
    ,
    messageId = null,
    messageType = null,
    channel,
    port,
    program,
    linkInfo,
    testerTime,
    testerDate,
    uniqueId,
    totalAbs,
    programEvaluation,
    resultDetailsRaw = null,
  ] = match;

  const details = parseResultDetails(resultDetailsRaw);
  const result = deriveResult(messageType, linkInfo);

  return {
    source: 'LPC-528',
    receivedAt: new Date().toISOString(),
    messageId,
    messageType,
    channel,
    port,
    program,
    programText: program,
    linkInfo,
    result,
    value: result,
    testerTime,
    testerDate,
    uniqueId,
    totalAbs,
    programEvaluation,
    spcFlag: programEvaluation,
    barcodeFromResult: details.barcodeFromResult,
    barcode: details.barcode,
    testType: details.testType,
    testEvaluation: details.testEvaluation,
    leakType: details.leakType,
    leakValue: details.leakValue,
    leakUnit: details.leakUnit,
    resultDetailsRaw,
    measurements: details.measurements,
    RL: details.RL,
    RL_unit: details.RL_unit,
    Pt: details.Pt,
    Pt_unit: details.Pt_unit,
    EDC: details.EDC,
    EDC_unit: details.EDC_unit,
    PL: details.PL,
    PL_unit: details.PL_unit,
    LLR: details.LLR,
    LLR_unit: details.LLR_unit,
    HLR: details.HLR,
    HLR_unit: details.HLR_unit,
    FPR: details.FPR,
    FPR_unit: details.FPR_unit,
    raw,
    normalized,
  };
}
