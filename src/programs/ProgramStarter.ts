import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { promisify } from 'node:util';
import type { ProgramStartRequest, ProgramStartResult } from '../shared/types';

const execFileAsync = promisify(execFile);

export interface ProgramStarter {
  startProgram(request: ProgramStartRequest): Promise<ProgramStartResult>;
}

export class MockProgramStarter implements ProgramStarter {
  async startProgram(request: ProgramStartRequest): Promise<ProgramStartResult> {
    return {
      attempted: true,
      success: true,
      mode: 'mock',
      message: `Mock: program ${request.programText} selected for barcode ${request.barcode}`,
    };
  }
}

export interface ScriptProgramStarterOptions {
  command: string;
  scriptPath: string;
  timeoutMs?: number;
}

export class ScriptProgramStarter implements ProgramStarter {
  constructor(private readonly options: ScriptProgramStarterOptions) {}

  async startProgram(request: ProgramStartRequest): Promise<ProgramStartResult> {
    const command = this.options.command.trim();
    const scriptPath = this.options.scriptPath.trim();
    const args = scriptPath ? [scriptPath, String(request.program)] : [];
    const timeoutMs = this.options.timeoutMs ?? 30000;

    console.log('[PROGRAM_START] mode=script');
    console.log(`[PROGRAM_START] command=${command}`);
    console.log(`[PROGRAM_START] scriptPath=${scriptPath}`);
    console.log(`[PROGRAM_START] programNumber=${request.program}`);

    if (!scriptPath) {
      console.log('[PROGRAM_START] scriptExists=false');
      return this.failure(command, scriptPath, args, 'PROGRAM_START_SCRIPT_PATH is empty', undefined, undefined, null, 'PROGRAM_START_SCRIPT_MISSING');
    }

    const scriptExists = existsSync(scriptPath);
    console.log(`[PROGRAM_START] scriptExists=${scriptExists}`);
    if (!scriptExists || !statSync(scriptPath).isFile()) {
      return this.failure(command, scriptPath, args, `Nie znaleziono skryptu startu LPC: ${scriptPath}`, undefined, undefined, null, 'PROGRAM_START_SCRIPT_MISSING');
    }

    try {
      console.log(`Starting LPC program ${request.programText} with ${command}`, args);
      const { stdout, stderr } = await execFileAsync(command, args, { windowsHide: true, timeout: timeoutMs });
      return {
        attempted: true,
        success: true,
        mode: 'script',
        command,
        scriptPath,
        args,
        stdout,
        stderr,
        exitCode: 0,
        message: `Program ${request.programText} sent to LPC`,
      };
    } catch (error) {
      const processError = error as Error & { stdout?: string; stderr?: string; code?: number | string | null; killed?: boolean; signal?: string | null };
      const stdout = processError.stdout;
      const stderr = processError.stderr;
      const code = typeof processError.code === 'number' ? processError.code : null;
      if (stdout) console.error('[PROGRAM_START] stdout', stdout);
      if (stderr) console.error('[PROGRAM_START] stderr', stderr);
      console.error('[PROGRAM_START] exitCode', code);
      if (processError.killed || processError.signal === 'SIGTERM') {
        return this.failure(command, scriptPath, args, 'Timeout uruchamiania programu LPC.', stdout, stderr, code, 'PROGRAM_START_TIMEOUT');
      }
      if (processError.message.includes('ENOENT')) {
        return this.failure(command, scriptPath, args, `Nie można uruchomić komendy PROGRAM_START_COMMAND=${command}. Sprawdź instalację Pythona.`, stdout, stderr, code, 'PROGRAM_START_COMMAND_MISSING');
      }
      return this.failure(command, scriptPath, args, 'Skrypt startu LPC zakończył się błędem. Szczegóły w logu backendu.', stdout, stderr, code, 'PROGRAM_START_SCRIPT_FAILED');
    }
  }

  private failure(
    command: string,
    scriptPath: string,
    args: string[],
    errorMessage: string,
    stdout?: string,
    stderr?: string,
    exitCode: number | null = null,
    errorCode?: ProgramStartResult['errorCode'],
  ): ProgramStartResult {
    return {
      attempted: true,
      success: false,
      mode: 'script',
      command,
      scriptPath,
      args,
      stdout,
      stderr,
      exitCode,
      errorMessage,
      errorCode,
      message: errorMessage,
    };
  }
}

export function createProgramStarter(options: {
  mode: 'mock' | 'script';
  command: string;
  scriptPath: string;
  timeoutMs?: number;
}): ProgramStarter {
  if (options.mode === 'script') {
    return new ScriptProgramStarter({ command: options.command, scriptPath: options.scriptPath, timeoutMs: options.timeoutMs });
  }

  return new MockProgramStarter();
}
