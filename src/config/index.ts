import 'dotenv/config';
import { z } from 'zod';

const barcodeProgramMapSchema = z.preprocess((value: unknown) => {
  if (typeof value !== 'string') return value;

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}, z.record(z.coerce.number().int().min(1).max(31))).default({});

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_PORT: z.coerce.number().int().positive().default(3000),
  LPC_HOST: z.string().min(1),
  LPC_PORT: z.coerce.number().int().positive().default(23),
  LPC_INTERFACE_SELECTION: z.string().min(1).default('1'),
  LPC_STREAM_BUFFER_LIMIT: z.coerce.number().int().positive().default(1000),
  LPC_MIN_ELAPSED_STEP_SEC: z.coerce.number().nonnegative().default(0.1),
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
  CURRENT_TEST_MAX_AGE_MS: z.coerce.number().int().positive().default(600000),
  ENABLE_MOCK_LPC_ENDPOINTS: z.coerce.boolean().default(false),
  PROGRAM_START_MODE: z.enum(['mock', 'script']).default('mock'),
  PROGRAM_START_COMMAND: z.string().min(1).default('python3'),
  PROGRAM_START_SCRIPT_PATH: z.string().default(''),
  BARCODE_PROGRAM_MAP: barcodeProgramMapSchema,
  SPLUNK_HEC_URL: z.string().url().optional().or(z.literal('')),
  SPLUNK_HEC_TOKEN: z.string().optional().or(z.literal('')),
  SPLUNK_INDEX: z.string().min(1).default('lpc528'),
  SPLUNK_SOURCE: z.string().min(1).default('lpc-528-app'),
  SPLUNK_SOURCETYPE: z.string().min(1).default('lpc:result'),
  ZEBRA_HOST: z.string().min(1),
  ZEBRA_PORT: z.coerce.number().int().positive().default(9100),
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
