import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProgramStartRequest } from '../shared/types';
import { MockProgramStarter, ScriptProgramStarter } from './ProgramStarter';

const request: ProgramStartRequest = {
  type: 'program_start_request',
  barcode: '7472475',
  matchedKey: '7472475',
  program: 1,
  programText: 'P01',
  selectedAt: '2026-06-24T10:00:00.000Z',
};

function tempScript(contents: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lpc-program-starter-'));
  const scriptPath = path.join(dir, 'starter.js');
  writeFileSync(scriptPath, contents);
  return scriptPath;
}

describe('MockProgramStarter', () => {
  it('returns success without launching a process', async () => {
    const result = await new MockProgramStarter().startProgram(request);

    expect(result.attempted).toBe(true);
    expect(result.success).toBe(true);
    expect(result.mode).toBe('mock');
    expect(result.command).toBeUndefined();
  });
});

describe('ScriptProgramStarter', () => {
  it('builds command args and returns stdout/stderr for a successful script', async () => {
    const scriptPath = tempScript("process.stdout.write(`program=${process.argv[2]}`); process.stderr.write('warn');");
    const result = await new ScriptProgramStarter({ command: process.execPath, scriptPath }).startProgram(request);

    expect(result.success).toBe(true);
    expect(result.command).toBe(process.execPath);
    expect(result.scriptPath).toBe(scriptPath);
    expect(result.args).toEqual([scriptPath, '1']);
    expect(result.stdout).toBe('program=1');
    expect(result.stderr).toBe('warn');
    expect(result.exitCode).toBe(0);
  });

  it('returns a clear failure when scriptPath is empty', async () => {
    const result = await new ScriptProgramStarter({ command: process.execPath, scriptPath: '' }).startProgram(request);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PROGRAM_START_SCRIPT_MISSING');
    expect(result.message).toContain('PROGRAM_START_SCRIPT_PATH is empty');
  });

  it('returns a clear failure when script does not exist', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lpc-program-starter-missing-'));
    const missingScript = path.join(dir, 'missing.py');
    const result = await new ScriptProgramStarter({ command: process.execPath, scriptPath: missingScript }).startProgram(request);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PROGRAM_START_SCRIPT_MISSING');
    expect(result.message).toBe(`Nie znaleziono skryptu startu LPC: ${missingScript}`);
  });

  it('returns a clear failure when scriptPath is not a file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lpc-program-starter-dir-'));
    const scriptDir = path.join(dir, 'script-dir');
    mkdirSync(scriptDir);
    const result = await new ScriptProgramStarter({ command: process.execPath, scriptPath: scriptDir }).startProgram(request);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PROGRAM_START_SCRIPT_MISSING');
  });


  it('returns a clear failure when command cannot be spawned', async () => {
    const scriptPath = tempScript("process.stdout.write('never');");
    const result = await new ScriptProgramStarter({ command: 'definitely-missing-python-command', scriptPath }).startProgram(request);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PROGRAM_START_COMMAND_MISSING');
    expect(result.message).toContain('Nie można uruchomić komendy PROGRAM_START_COMMAND=definitely-missing-python-command');
  });

  it('returns success=false and stdout/stderr when the process exits non-zero', async () => {
    const scriptPath = tempScript("process.stdout.write('out'); process.stderr.write('err'); process.exit(2);");
    const result = await new ScriptProgramStarter({ command: process.execPath, scriptPath }).startProgram(request);

    expect(result.success).toBe(false);
    expect(result.stdout).toBe('out');
    expect(result.stderr).toBe('err');
    expect(result.exitCode).toBe(2);
    expect(result.errorCode).toBe('PROGRAM_START_SCRIPT_FAILED');
    expect(result.message).toBe('Skrypt startu LPC zakończył się błędem. Szczegóły w logu backendu.');
  });
});

