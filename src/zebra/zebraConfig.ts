import type { AppConfig } from '../config';
import type { ZebraLayoutConfig } from './zebraTypes';

export interface ZebraConfig extends ZebraLayoutConfig {
  enabled: boolean;
  host: string;
  port: number;
  printOnResult: boolean;
  testPressureLabel: string;
  connectTimeoutMs: number;
}

export function createZebraConfig(config: AppConfig): ZebraConfig {
  return {
    enabled: config.ZEBRA_ENABLED,
    host: config.ZEBRA_HOST,
    port: config.ZEBRA_PORT,
    printOnResult: config.ZEBRA_PRINT_ON_RESULT,
    labelWidthMm: config.ZEBRA_LABEL_WIDTH_MM,
    labelHeightMm: config.ZEBRA_LABEL_HEIGHT_MM,
    dpi: config.ZEBRA_DPI,
    orientation: config.ZEBRA_ORIENTATION,
    copies: config.ZEBRA_COPIES,
    testPressureLabel: config.ZEBRA_TEST_PRESSURE_LABEL,
    connectTimeoutMs: config.ZEBRA_CONNECT_TIMEOUT_MS,
    fontLine1: config.ZEBRA_FONT_LINE1,
    fontLine2: config.ZEBRA_FONT_LINE2,
    fontLine3: config.ZEBRA_FONT_LINE3,
    line1Y: config.ZEBRA_LINE1_Y,
    line2Y: config.ZEBRA_LINE2_Y,
    line3Y: config.ZEBRA_LINE3_Y,
    offsetX: config.ZEBRA_OFFSET_X,
    offsetY: config.ZEBRA_OFFSET_Y,
    frameThickness: config.ZEBRA_FRAME_THICKNESS,
  };
}
