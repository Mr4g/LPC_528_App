import type { AppConfig } from '../config';
import type { ZebraCalibrationPreset, ZebraLayoutConfig } from './zebraTypes';

export interface ZebraConfig extends ZebraLayoutConfig {
  enabled: boolean;
  host: string;
  port: number;
  printOnResult: boolean;
  testPressureLabel: string;
  connectTimeoutMs: number;
}

export const calibrationPresets: Record<ZebraCalibrationPreset, Partial<ZebraLayoutConfig>> = {
  tiny: { widthDots: 240, heightDots: 64, line1Y: 2, line2Y: 22, line3Y: 42, fontLine1Height: 11, fontLine1Width: 11, fontLine2Height: 11, fontLine2Width: 11, fontLine3Height: 10, fontLine3Width: 10, textX: 0, textWidthDots: 240 },
  small: { widthDots: 240, heightDots: 80, line1Y: 3, line2Y: 26, line3Y: 49, fontLine1Height: 12, fontLine1Width: 12, fontLine2Height: 12, fontLine2Width: 12, fontLine3Height: 11, fontLine3Width: 11, textX: 0, textWidthDots: 240 },
  medium: { widthDots: 240, heightDots: 220, line1Y: 40, line2Y: 75, line3Y: 110, fontLine1Height: 24, fontLine1Width: 24, fontLine2Height: 24, fontLine2Width: 24, fontLine3Height: 20, fontLine3Width: 20, textX: 0, textWidthDots: 240 },
  wide: { widthDots: 320, heightDots: 220, line1Y: 40, line2Y: 75, line3Y: 110, fontLine1Height: 24, fontLine1Width: 24, fontLine2Height: 24, fontLine2Width: 24, fontLine3Height: 20, fontLine3Width: 20, textX: 0, textWidthDots: 320 },
  custom: {},
};

export function mergeZebraLayout(base: ZebraLayoutConfig, override: Partial<ZebraLayoutConfig> = {}): ZebraLayoutConfig {
  return { ...base, ...override };
}

export function createZebraConfig(config: AppConfig): ZebraConfig {
  return {
    enabled: config.ZEBRA_ENABLED,
    host: config.ZEBRA_HOST,
    port: config.ZEBRA_PORT,
    printOnResult: config.ZEBRA_PRINT_ON_RESULT,
    widthDots: config.ZEBRA_LABEL_WIDTH_DOTS,
    heightDots: config.ZEBRA_LABEL_HEIGHT_DOTS,
    dpi: config.ZEBRA_DPI,
    labelOffsetX: config.ZEBRA_LABEL_OFFSET_X,
    labelOffsetY: config.ZEBRA_LABEL_OFFSET_Y,
    textX: config.ZEBRA_TEXT_X,
    textWidthDots: config.ZEBRA_TEXT_WIDTH_DOTS,
    copies: config.ZEBRA_COPIES,
    testPressureLabel: config.ZEBRA_TEST_PRESSURE_LABEL,
    connectTimeoutMs: config.ZEBRA_CONNECT_TIMEOUT_MS,
    fontLine1Height: config.ZEBRA_FONT_LINE1_HEIGHT,
    fontLine1Width: config.ZEBRA_FONT_LINE1_WIDTH,
    fontLine2Height: config.ZEBRA_FONT_LINE2_HEIGHT,
    fontLine2Width: config.ZEBRA_FONT_LINE2_WIDTH,
    fontLine3Height: config.ZEBRA_FONT_LINE3_HEIGHT,
    fontLine3Width: config.ZEBRA_FONT_LINE3_WIDTH,
    line1Y: config.ZEBRA_LINE1_Y,
    line2Y: config.ZEBRA_LINE2_Y,
    line3Y: config.ZEBRA_LINE3_Y,
  };
}
