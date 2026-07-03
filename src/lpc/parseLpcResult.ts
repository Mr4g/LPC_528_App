import type { LpcResult, LpcResultValue } from '../shared/types';
import { isIgnoredLpcLine, containsResultFrameSignature } from './lpcFrameFilters';
import { normalizeLpcLine } from './normalizeLpcLine';
import { parseResultDetails } from './parseResultDetails';

export type LpcResultFrameFormat = 1 | 2;

const RESULT_REGEX = /^(?:(\S+)\s+([A-Z])\s+)?(C\d{2})\s+(N\d+)\s+(P\d{2})\s+(\S+)\s+(\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d{2}\/\d{2}\/\d{2})\s+(\d+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/;
const SHORT_RESULT_REGEX = /^([A-Fa-f0-9]+)\s+R\s+(C\d+)\s+(P\d+)\s+(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s+(\d{2}\/\d{2}\/\d{2})\s+(\d+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/;

const OK_EVALUATIONS = new Set(['OK', 'PASS', 'ACCEPT', 'GOOD', 'GUT']);
const NOK_EVALUATIONS = new Set(['NOK', 'FAIL', 'REJECT', 'BAD', 'FEHLER']);

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

function deriveShortResult(programEvaluation: string): LpcResultValue {
  const normalized = programEvaluation.toUpperCase();
  if (OK_EVALUATIONS.has(normalized)) return 'ACCEPT';
  if (NOK_EVALUATIONS.has(normalized)) return 'REJECT';
  return 'UNKNOWN';
}

function parseProgramNumber(programText: string): number | null {
  const number = programText.startsWith('P') ? Number(programText.slice(1)) : NaN;
  return Number.isFinite(number) ? number : null;
}

function parseChannelNumber(channel: string): number | null {
  const number = channel.startsWith('C') ? Number(channel.slice(1)) : NaN;
  return Number.isFinite(number) ? number : null;
}

function parseLpcResultFormat1(raw: string): LpcResult | null {
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
    resultFrameFormat: 1,
    resultRawStatus: result,
  };
}

function parseLpcResultFormat2(raw: string): LpcResult | null {
  if (isIgnoredLpcLine(raw)) return null;

  const normalized = normalizeLpcLine(raw);
  const match = normalized.match(SHORT_RESULT_REGEX);
  if (!match) return null;

  const [, messageId, channel, programText, testerTime, testerDate, uniqueId, programEvaluation, spcFlag, allResultInformation = null] = match;
  const programNumber = parseProgramNumber(programText);
  const channelNumber = parseChannelNumber(channel);
  const result = deriveShortResult(programEvaluation);

  console.log(`[LPC_RESULT] format=2 short_result_frame parsed messageId=${messageId} channel=${channel} program=${programText} evaluation=${programEvaluation} uniqueId=${uniqueId}`);

  return {
    source: 'LPC-528',
    receivedAt: new Date().toISOString(),
    messageId,
    messageType: 'R',
    channel,
    port: null,
    program: programText,
    programText,
    linkInfo: null,
    result,
    value: result,
    testerTime,
    testerDate,
    uniqueId,
    totalAbs: null,
    programEvaluation,
    spcFlag,
    barcodeFromResult: null,
    barcode: '',
    testType: null,
    testEvaluation: null,
    leakType: null,
    leakValue: null,
    leakUnit: null,
    resultDetailsRaw: allResultInformation,
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
    raw,
    normalized,
    resultFrameFormat: 2,
    resultRawStatus: programEvaluation,
    lpcMessageId: messageId,
    lpcMessageType: 'R',
    lpcChannel: channel,
    lpcChannelNumber: channelNumber,
    lpcProgram: programNumber,
    lpcProgramText: programText,
    lpcTesterTime: testerTime,
    lpcTesterDate: testerDate,
    lpcUniqueId: uniqueId,
    lpcProgramEvaluation: programEvaluation,
    lpcSpcFlag: spcFlag,
    lpcAllResultInformation: allResultInformation,
  };
}

export function parseLpcResult(raw: string, format: LpcResultFrameFormat = 1): LpcResult | null {
  return format === 2 ? parseLpcResultFormat2(raw) : parseLpcResultFormat1(raw);
}
