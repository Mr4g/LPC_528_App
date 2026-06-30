import type { LabelPrintMode, LpcResult, LpcResultValue } from '../shared/types';

export type ZebraLabelResultStatus = 'OK' | 'NOK' | 'ERROR' | 'UNKNOWN';
export type ZebraPrintStatus = 'printed' | 'skipped' | 'duplicate' | 'failed';
export type ZebraCalibrationPreset = 'tiny' | 'small' | 'medium' | 'wide' | 'custom';

export interface ZebraLayoutConfig {
  widthDots: number;
  heightDots: number;
  dpi: number;
  labelOffsetX: number;
  labelOffsetY: number;
  textX: number;
  textWidthDots: number;
  fontLine1Height: number;
  fontLine1Width: number;
  fontLine2Height: number;
  fontLine2Width: number;
  fontLine3Height: number;
  fontLine3Width: number;
  line1Y: number;
  line2Y: number;
  line3Y: number;
  copies: number;
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
  layout?: ZebraLayoutConfig;
  error?: string;
}

export interface ZebraPrintContext {
  operatorLogin?: string | null;
  auto?: boolean;
  allowDuplicate?: boolean;
  labelPrintMode?: LabelPrintMode;
  layout?: Partial<ZebraLayoutConfig>;
  inputOverride?: Partial<ZebraResultLabelInput>;
  runtimeAutoPrintEnabled?: boolean;
}

export type ZebraResultLike = Partial<LpcResult> & {
  result?: LpcResultValue | ZebraLabelResultStatus | string | null;
  value?: LpcResultValue | string | null;
  labelPrintMode?: LabelPrintMode | null;
};
