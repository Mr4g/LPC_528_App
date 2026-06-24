export type MeasurementValue = number | null;

export interface LpcMeasurementMap {
  [key: string]: {
    value: MeasurementValue;
    unit: string | null;
  };
}

export interface LpcResult {
  source: string;
  receivedAt: string;
  messageId: string;
  messageType: string;
  channel: string;
  port: string;
  program: string;
  programText: string;
  linkInfo: string;
  result: string;
  testerTime: string;
  testerDate: string;
  uniqueId: string;
  totalAbs: string;
  programEvaluation: string;
  spcFlag: string;
  barcode: string;
  barcodeFromResult: string;
  testType: string;
  testEvaluation: string;
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

export interface ProgramStartRequest {
  type: 'program_start_request';
  barcode: string;
  matchedKey: string;
  program: number;
  programText: string;
  selectedAt: string;
}
