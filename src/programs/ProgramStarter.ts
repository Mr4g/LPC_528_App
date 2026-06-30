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

    console.log('[PROGRAM_START] mode=script');
    console.log(`[PROGRAM_START] command=${command}`);
    console.log(`[PROGRAM_START] scriptPath=${scriptPath}`);
    console.log(`[PROGRAM_START] scriptExists=${Boolean(scriptPath && existsSync(scriptPath))}`);
    console.log(`[PROGRAM_START] programNumber=${request.program}`);

    if (!scriptPath) {
      return this.failure(command, scriptPath, args, 'Nie znaleziono skryptu startu LPC: PROGRAM_START_SCRIPT_PATH is empty');
    }

    if (!existsSync(scriptPath)) {
      return this.failure(command, scriptPath, args, `Nie znaleziono skryptu startu LPC: ${scriptPath}`);
    }

    if (!statSync(scriptPath).isFile()) {
      return this.failure(command, scriptPath, args, `Nie znaleziono skryptu startu LPC: ${scriptPath}`);
    }

    const startedAt = Date.now();
    try {
      const { stdout, stderr } = await execFileAsync(command, args, { windowsHide: true, timeout: this.options.timeoutMs ?? 30000 });
      const durationMs = Date.now() - startedAt;
      console.log('[PROGRAM_START] exitCode=0');
      console.log(`[PROGRAM_START] stdout=${stdout}`);
      console.log(`[PROGRAM_START] stderr=${stderr}`);
      console.log(`[PROGRAM_START] durationMs=${durationMs}`);
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
      const processError = error as Error & { stdout?: string; stderr?: string; code?: number | string | null; signal?: string; killed?: boolean };
      const durationMs = Date.now() - startedAt;
      const exitCode = typeof processError.code === 'number' ? processError.code : null;
      console.error('[PROGRAM_START] failed', { command, args, exitCode, stdout: processError.stdout, stderr: processError.stderr, durationMs });
      console.log(`[PROGRAM_START] exitCode=${exitCode}`);
      console.log(`[PROGRAM_START] stdout=${processError.stdout ?? ''}`);
      console.log(`[PROGRAM_START] stderr=${processError.stderr ?? ''}`);
      console.log(`[PROGRAM_START] durationMs=${durationMs}`);
      if (processError.message.includes('ETIMEDOUT') || processError.killed || processError.signal === 'SIGTERM') {
        return this.failure(command, scriptPath, args, 'Timeout uruchamiania programu LPC.', processError.stdout, processError.stderr, exitCode);
      }
      if (processError.message.includes('ENOENT') || processError.code === 'ENOENT') {
        return this.failure(command, scriptPath, args, `Nie można uruchomić komendy PROGRAM_START_COMMAND=${command}. Sprawdź instalację Pythona.`, processError.stdout, processError.stderr, exitCode);
      }
      return this.failure(command, scriptPath, args, 'Skrypt startu LPC zakończył się błędem. Szczegóły w logu backendu.', processError.stdout, processError.stderr, exitCode);
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
      message: errorMessage,
    };
  }
}

export function createProgramStarter(options: {
  mode: 'mock' | 'script';
  command: string;
  scriptPath: string;
}): ProgramStarter {
  if (options.mode === 'script') {
    return new ScriptProgramStarter({ command: options.command, scriptPath: options.scriptPath });
  }

  return new MockProgramStarter();
}
