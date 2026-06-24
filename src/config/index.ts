import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_PORT: z.coerce.number().int().positive().default(3000),
  LPC_HOST: z.string().min(1),
  LPC_PORT: z.coerce.number().int().positive().default(23),
  LPC_INTERFACE_SELECTION: z.string().min(1).default('1'),
  LPC_STREAM_BUFFER_LIMIT: z.coerce.number().int().positive().default(1000),
  LPC_MIN_ELAPSED_STEP_SEC: z.coerce.number().nonnegative().default(0.1),
  PROGRAM_STARTER_COMMAND: z.string().min(1),
  PROGRAM_STARTER_SCRIPT: z.string().min(1),
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
