import { execFile } from 'node:child_process';
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
    const args = [this.options.scriptPath, String(request.program)];

    try {
      const { stdout, stderr } = await execFileAsync(this.options.command, args, { windowsHide: true });
      return {
        attempted: true,
        success: true,
        mode: 'script',
        command: [this.options.command, ...args].join(' '),
        stdout,
        stderr,
        exitCode: 0,
        message: `Program ${request.programText} started`,
      };
    } catch (error) {
      const processError = error as Error & { stdout?: string; stderr?: string; code?: number | null };
      return {
        attempted: true,
        success: false,
        mode: 'script',
        command: [this.options.command, ...args].join(' '),
        stdout: processError.stdout,
        stderr: processError.stderr,
        exitCode: processError.code ?? null,
        message: processError.message,
      };
    }
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
