import 'dotenv/config';
import { z } from 'zod';


export function parseEnvBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null || value.trim() === '') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function envBool(defaultValue: boolean) {
  return z.preprocess((value) => typeof value === 'string' ? parseEnvBool(value, defaultValue) : value, z.boolean()).default(defaultValue);
}

const barcodeProgramMapSchema = z.preprocess((value: unknown) => {
  if (typeof value !== 'string') return value;

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}, z.record(z.string(), z.coerce.number().int().min(1).max(31))).default({});

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_PORT: z.coerce.number().int().positive().default(3000),
  AUTH_SESSION_SECRET: z.string().min(1).default('change-me-super-secret'),
  AUTH_COOKIE_NAME: z.string().min(1).default('lpc_auth'),
  AUTH_COOKIE_MAX_AGE_HOURS: z.coerce.number().positive().default(12),
  AUTH_COOKIE_SECURE: z.coerce.boolean().default(false),
  AUTH_COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  AUTH_RESET_DEFAULT_ADMIN: z.coerce.boolean().default(false),
  AUTH_DEBUG: z.coerce.boolean().default(false),
  AUTH_TEST_IDLE_LOGOUT_MINUTES: z.coerce.number().nonnegative().default(15),
  CARD_LOGIN_ENABLED: z.coerce.boolean().default(true),
  CARD_UID_PATTERN: z.string().min(1).default('^\\d{8}$'),
  CARD_SCAN_IDLE_MS: z.coerce.number().int().positive().default(200),
  DEFAULT_ADMIN_LOGIN: z.string().regex(/^[A-Za-z]{3,5}$/).default('ADM'),
  DEFAULT_ADMIN_PASSWORD: z.string().min(4).default('admin123'),
  SQLITE_DB_PATH: z.string().min(1).default('data/lpc_app.sqlite'),
  LPC_HOST: z.string().min(1),
  LPC_PORT: z.coerce.number().int().positive().default(23),
  LPC_INTERFACE_SELECTION: z.string().min(1).default('1'),
  LPC_STREAM_BUFFER_LIMIT: z.coerce.number().int().positive().default(1000),
  LPC_MIN_ELAPSED_STEP_SEC: z.coerce.number().nonnegative().default(0.1),
  LPC_ENABLE_ESTIMATED_LEAK_RATE: z.coerce.boolean().default(false),
  LPC_ESTIMATED_LEAK_WINDOW_POINTS: z.coerce.number().int().positive().default(10),
  LPC_AUTO_CONNECT: z.coerce.boolean().default(true),
  LPC_RECONNECT_ENABLED: z.coerce.boolean().default(true),
  LPC_RECONNECT_DELAY_MS: z.coerce.number().int().positive().default(15000),
  LPC_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  LPC_HEARTBEAT_ENABLED: z.coerce.boolean().default(true),
  LPC_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  LPC_HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
  LPC_STALE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  LPC_HEARTBEAT_PAYLOAD: z.string().default(''),
  LPC_AUTO_SELECT_INTERFACE: z.coerce.boolean().default(true),
  LPC_DEBUG_LINES: z.coerce.boolean().default(false),
  LPC_DEBUG_PIPELINE: z.coerce.boolean().default(false),
  LPC_RESULT_FRAME_FORMAT: z.coerce.number().int().refine((value) => value === 1 || value === 2, 'LPC_RESULT_FRAME_FORMAT must be 1 or 2').default(1),
  LPC_RESULT_OK_CODES: z.string().default('A,OK,PASS,ACCEPT,GOOD,GUT'),
  LPC_RESULT_NOK_CODES: z.string().default('SB,NOK,FAIL,REJECT,BAD,FEHLER'),
  CURRENT_TEST_MAX_AGE_MS: z.coerce.number().int().positive().default(600000),
  ACTIVE_TEST_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),
  ACTIVE_TEST_NO_DATA_WARNING_MS: z.coerce.number().int().positive().default(15000),
  ACTIVE_TEST_NO_DATA_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  ENABLE_MOCK_LPC_ENDPOINTS: z.coerce.boolean().default(false),
  PROGRAM_START_MODE: z.enum(['mock', 'script']).default('mock'),
  PROGRAM_START_COMMAND: z.string().min(1).default('python3'),
  PROGRAM_START_SCRIPT_PATH: z.string().default(''),
  PROGRAM_INSTRUCTION_UPLOAD_DIR: z.string().min(1).default('data/uploads/program-instructions'),
  LPC_EIP_HOST: z.string().default(''),
  LPC_EIP_PORT: z.coerce.number().int().positive().default(44818),
  EIP_DRY_RUN: z.coerce.boolean().default(false),
  BARCODE_PROGRAM_MAP: barcodeProgramMapSchema,
  SPLUNK_ENABLED: z.coerce.boolean().default(false),
  SPLUNK_HEC_URL: z.string().url().optional().or(z.literal('')).default(''),
  SPLUNK_HEC_TOKEN: z.string().optional().or(z.literal('')).default(''),
  SPLUNK_INDEX: z.string().min(1).default('machinedata_w16'),
  SPLUNK_SOURCE: z.string().min(1).default('LPC-528-01'),
  SPLUNK_SOURCETYPE: z.string().min(1).default('_json'),
  SPLUNK_SITE: z.string().optional().or(z.literal('')).default(''),
  SPLUNK_LINE: z.string().optional().or(z.literal('')).default(''),
  SPLUNK_WORKPLACE: z.string().optional().or(z.literal('')).default(''),
  SPLUNK_DEVICE: z.string().optional().or(z.literal('')).default(''),
  SPLUNK_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  SPLUNK_VERIFY_TLS: envBool(true),
  SPLUNK_SEND_RESULT: z.coerce.boolean().default(true),
  SPLUNK_SEND_CURVE: z.coerce.boolean().default(true),
  SPLUNK_BUFFER_ENABLED: z.coerce.boolean().default(true),
  SPLUNK_BUFFER_RETRY_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  SPLUNK_BUFFER_MAX_ATTEMPTS: z.coerce.number().int().nonnegative().default(0),
  ZEBRA_HOST: z.string().min(1),
  ZEBRA_PORT: z.coerce.number().int().positive().default(9100),
  ZEBRA_ENABLED: z.coerce.boolean().default(true),
  ZEBRA_PRINT_ON_RESULT: z.coerce.boolean().default(true),
  ZEBRA_LABEL_WIDTH_DOTS: z.coerce.number().int().positive().default(240),
  ZEBRA_LABEL_HEIGHT_DOTS: z.coerce.number().int().positive().default(220),
  ZEBRA_TEXT_X: z.coerce.number().int().nonnegative().default(0),
  ZEBRA_TEXT_WIDTH_DOTS: z.coerce.number().int().positive().default(240),
  ZEBRA_LINE1_Y: z.coerce.number().int().nonnegative().default(40),
  ZEBRA_LINE2_Y: z.coerce.number().int().nonnegative().default(75),
  ZEBRA_LINE3_Y: z.coerce.number().int().nonnegative().default(110),
  ZEBRA_FONT_LINE1_HEIGHT: z.coerce.number().int().positive().default(24),
  ZEBRA_FONT_LINE1_WIDTH: z.coerce.number().int().positive().default(24),
  ZEBRA_FONT_LINE2_HEIGHT: z.coerce.number().int().positive().default(24),
  ZEBRA_FONT_LINE2_WIDTH: z.coerce.number().int().positive().default(24),
  ZEBRA_FONT_LINE3_HEIGHT: z.coerce.number().int().positive().default(20),
  ZEBRA_FONT_LINE3_WIDTH: z.coerce.number().int().positive().default(20),
  BACKUP_COMMAND: z.string().min(1),
  BACKUP_SCRIPT: z.string().min(1),
  BACKUP_REPORT: z.string().min(1).default('Chan Last 100'),
  BACKUP_TIMEOUT_SEC: z.coerce.number().int().positive().default(120),
  BACKUP_LATEST_CSV: z.string().min(1),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
