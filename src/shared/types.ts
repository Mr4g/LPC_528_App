export type MeasurementValue = number | null;
export type LpcResultValue = 'ACCEPT' | 'REJECT' | 'ERROR' | 'UNKNOWN';
export type LabelPrintMode = 'ok_only' | 'ok_and_nok';
export interface MasterSampleMetadata {
  enabled: boolean;
  requestedByUserId?: string | null;
  requestedByLogin?: string | null;
  requestedByRole?: string | null;
  requestedAt?: string | null;
  labelCopiesOnOk?: number;
  labelCopiesRequested?: number;
  labelCopiesPrinted?: number;
  printTriggered?: boolean;
  resetAfterTest?: boolean;
  printError?: string | null;
}



export interface ProgramLimitCacheEntry {
  id: string;
  programText: string;
  programNumber: number | null;
  testType: string;
  HLR: number | null;
  HLR_unit: string | null;
  LLR: number | null;
  LLR_unit: string | null;
  sourceUniqueId: string | null;
  sourceResultMessageId: string | null;
  sourceTesterDate: string | null;
  sourceTesterTime: string | null;
  sourceResultAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProgramLimitSnapshot {
  source: 'cache' | 'result_frame';
  programText: string;
  programNumber: number | null;
  testType: string;
  HLR: number | null;
  HLR_unit: string | null;
  LLR: number | null;
  LLR_unit: string | null;
  sourceUniqueId?: string | null;
  sourceResultMessageId?: string | null;
  sourceTesterDate?: string | null;
  sourceTesterTime?: string | null;
  sourceResultAt?: string | null;
  uniqueId?: string | null;
  messageId?: string | null;
  updatedAt?: string | null;
}

export interface ProgramLimitsMetadata {
  cachedAtStart: ProgramLimitSnapshot | null;
  fromResult: ProgramLimitSnapshot | null;
  changedDuringTest: boolean | null;
}

export interface LimitCheckMetadata {
  measurement: 'RL';
  value: number | null;
  unit: string | null;
  upperLimitName: 'HLR';
  upperLimit: number | null;
  upperLimitUnit: string | null;
  lowerLimitName: 'LLR';
  lowerLimit: number | null;
  lowerLimitUnit: string | null;
  source: 'result_frame' | 'cache' | null;
  exceededUpper: boolean | null;
  exceededLower: boolean | null;
  exceeded: boolean | null;
}

export interface LpcMeasurementMap {
  [key: string]: {
    value: number;
    unit: string;
  };
}

export interface LpcResult {
  id?: string;
  source: string;
  receivedAt: string;
  messageId: string | null;
  messageType: string | null;
  channel: string | null;
  port: string | null;
  program: string | null;
  programText: string | null;
  linkInfo: string | null;
  result: LpcResultValue;
  value: LpcResultValue;
  testerTime: string | null;
  testerDate: string | null;
  uniqueId: string | null;
  totalAbs: string | null;
  programEvaluation: string | null;
  spcFlag: string | null;
  barcode: string;
  barcodeFromResult: string | null;
  testType: string | null;
  testEvaluation: string | null;
  leakType: string | null;
  leakValue: number | null;
  leakUnit: string | null;
  resultDetailsRaw: string | null;
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
  raw: string;
  normalized: string;
  operatorLogin?: string | null;
  operatorRole?: string | null;
  labelPrintMode?: LabelPrintMode;
  masterSample?: MasterSampleMetadata;
  cachedLimitsAtStart?: ProgramLimitSnapshot | null;
  limits?: ProgramLimitsMetadata;
  limitCheck?: LimitCheckMetadata;
  resultFrameFormat?: 1 | 2;
  resultRawStatus?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  lpcMessageId?: string | null;
  lpcMessageType?: string | null;
  lpcChannel?: string | null;
  lpcChannelNumber?: number | null;
  lpcProgram?: number | null;
  lpcProgramText?: string | null;
  lpcTesterTime?: string | null;
  lpcTesterDate?: string | null;
  lpcUniqueId?: string | null;
  lpcProgramEvaluation?: string | null;
  lpcSpcFlag?: string | null;
  lpcAllResultInformation?: string | null;
}


export interface LpcStreamPoint {
  source: string;
  type: 'stream';
  receivedAt: string;
  messageId: string;
  messageType: 'S';
  channel: string;
  program: string;
  segment: string;
  elapsedTimeSec: number | null;
  remainingTimeSec: number | null;
  pressureValue: number | null;
  pressureUnit: string | null;
  pressureMbar: number | null;
  liveLeakValue?: number | null;
  liveLeakUnit?: string | null;
  RL?: number | null;
  RL_unit?: string | null;
  raw: string;
  normalized: string;
}

export interface BarcodeScan {
  type: 'barcode_scan';
  barcode: string;
  scannedAt: string;
  source: 'ui' | 'scanner';
}

export interface CurrentTest {
  type: 'current_test';
  barcode: string;
  matchedKey: string;
  program: number;
  programText: string;
  mappingId?: string | null;
  matchType?: 'exact' | 'contains' | null;
  selectedAt: string;
  operatorUserId?: string;
  operatorLogin?: string;
  operatorRole?: string;
  labelPrintMode?: LabelPrintMode;
  masterSample?: MasterSampleMetadata;
  cachedLimitsAtStart?: ProgramLimitSnapshot | null;
  limits?: ProgramLimitsMetadata;
  limitCheck?: LimitCheckMetadata;
  llControl?: { requiredAtStart: boolean; flagId: string | null; testAllowedByRole: boolean; performedByRequiredRole: boolean; resolvedByThisTest: boolean };
}


export interface ProgramStartResult {
  attempted: boolean;
  success: boolean;
  mode: 'mock' | 'script';
  command?: string;
  scriptPath?: string;
  args?: string[];
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  errorMessage?: string;
  dryRun?: boolean;
  message: string;
}

export interface ProgramStartRequest {
  type: 'program_start_request';
  barcode: string;
  matchedKey: string;
  program: number;
  programText: string;
  mappingId?: string | null;
  matchType?: 'exact' | 'contains' | null;
  selectedAt: string;
  operatorUserId?: string;
  operatorLogin?: string;
  operatorRole?: string;
  labelPrintMode?: LabelPrintMode;
  masterSample?: MasterSampleMetadata;
  cachedLimitsAtStart?: ProgramLimitSnapshot | null;
  limits?: ProgramLimitsMetadata;
  limitCheck?: LimitCheckMetadata;
  llControl?: { requiredAtStart: boolean; flagId: string | null; testAllowedByRole: boolean; performedByRequiredRole: boolean; resolvedByThisTest: boolean };
}

