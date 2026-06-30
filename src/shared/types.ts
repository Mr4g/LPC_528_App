export type MeasurementValue = number | null;
export type LpcResultValue = 'ACCEPT' | 'REJECT' | 'ERROR' | 'UNKNOWN';
export type LabelPrintMode = 'ok_only' | 'ok_and_nok';

export interface LpcMeasurementMap {
  [key: string]: {
    value: number;
    unit: string;
  };
}

export interface LpcResult {
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
  operatorLogin?: string;
  operatorRole?: string;
  labelPrintMode?: LabelPrintMode;
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
  operatorLogin?: string;
  operatorRole?: string;
  labelPrintMode?: LabelPrintMode;
}
