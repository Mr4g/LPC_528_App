import type { LpcResult, LpcResultValue } from '../shared/types';

export type ZebraLabelResultStatus = 'OK' | 'NOK' | 'ERROR' | 'UNKNOWN';
export type ZebraPrintStatus = 'printed' | 'skipped' | 'duplicate' | 'failed';

export interface ZebraLayoutConfig {
  labelWidthMm: number;
  labelHeightMm: number;
  dpi: number;
  orientation: 'landscape' | 'portrait';
  copies: number;
  fontLine1: number;
  fontLine2: number;
  fontLine3: number;
  line1Y: number;
  line2Y: number;
  line3Y: number;
  offsetX: number;
  offsetY: number;
  frameThickness: number;
}

export interface ZebraResultLabelInput {
  resultStatus: ZebraLabelResultStatus;
  testPressureLabel: string;
  leakText: string;
  operatorLogin: string;
  dateText: string;
  barcode?: string;
  programText?: string;
  uniqueId?: string;
}

export interface ZebraPrintResult {
  ok: boolean;
  status: ZebraPrintStatus;
  message: string;
  resultId?: string;
  zpl?: string;
  error?: string;
}

export interface ZebraPrintContext {
  operatorLogin?: string | null;
  auto?: boolean;
  allowDuplicate?: boolean;
}

export type ZebraResultLike = Partial<LpcResult> & {
  result?: LpcResultValue | ZebraLabelResultStatus | string | null;
  value?: LpcResultValue | string | null;
};
