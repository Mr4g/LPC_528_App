import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
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
}

export class ScriptProgramStarter implements ProgramStarter {
  constructor(private readonly options: ScriptProgramStarterOptions) {}

  async startProgram(request: ProgramStartRequest): Promise<ProgramStartResult> {
    const command = this.options.command.trim();
    const scriptPath = this.options.scriptPath.trim();
    const args = scriptPath ? [scriptPath, String(request.program)] : [];

    if (!scriptPath) {
      return this.failure(command, scriptPath, args, 'PROGRAM_START_SCRIPT_PATH is empty');
    }

    if (!existsSync(scriptPath)) {
      return this.failure(command, scriptPath, args, `Program start script does not exist: ${scriptPath}`);
    }

    try {
      console.log(`Starting LPC program ${request.programText} with ${command}`, args);
      const { stdout, stderr } = await execFileAsync(command, args, { windowsHide: true });
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
      const processError = error as Error & { stdout?: string; stderr?: string; code?: number | null };
      return this.failure(command, scriptPath, args, processError.message, processError.stdout, processError.stderr, processError.code ?? null);
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
      message: `Failed to send program to LPC: ${errorMessage}`,
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
