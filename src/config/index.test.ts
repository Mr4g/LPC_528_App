import { describe, expect, it } from 'vitest';
import { loadConfig, parseEnvBool } from './index';

const required = {
  LPC_HOST: '192.0.2.10',
  ZEBRA_HOST: '192.0.2.11',
  BACKUP_COMMAND: 'python3',
  BACKUP_SCRIPT: 'backup.py',
  BACKUP_LATEST_CSV: 'latest.csv',
};

describe('parseEnvBool', () => {
  it('parses false-like values as false', () => {
    for (const value of ['false', 'FALSE', '0', 'no', 'off']) expect(parseEnvBool(value, true)).toBe(false);
  });

  it('parses true-like values as true and defaults empty values', () => {
    for (const value of ['true', 'TRUE', '1', 'yes', 'on']) expect(parseEnvBool(value, false)).toBe(true);
    expect(parseEnvBool(undefined, true)).toBe(true);
    expect(parseEnvBool('', false)).toBe(false);
  });

  it('loads SPLUNK_VERIFY_TLS=false as false instead of Boolean("false")', () => {
    const config = loadConfig({ ...required, SPLUNK_VERIFY_TLS: 'false' });
    expect(config.SPLUNK_VERIFY_TLS).toBe(false);
  });

  it('loads SPLUNK_VERIFY_TLS=true as true', () => {
    const config = loadConfig({ ...required, SPLUNK_VERIFY_TLS: 'true' });
    expect(config.SPLUNK_VERIFY_TLS).toBe(true);
  });

  it('accepts BARCODE_PROGRAM_MAP program numbers from 1 through 32', () => {
    const config = loadConfig({ ...required, BARCODE_PROGRAM_MAP: '{"P1":1,"P31":31,"P32":32}' });
    expect(config.BARCODE_PROGRAM_MAP).toEqual({ P1: 1, P31: 31, P32: 32 });
  });

  it('rejects BARCODE_PROGRAM_MAP program numbers outside 1 through 32', () => {
    expect(() => loadConfig({ ...required, BARCODE_PROGRAM_MAP: '{"P0":0}' })).toThrow();
    expect(() => loadConfig({ ...required, BARCODE_PROGRAM_MAP: '{"P33":33}' })).toThrow();
  });
});
