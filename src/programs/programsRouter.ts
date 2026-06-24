import { existsSync } from 'node:fs';
import { Router } from 'express';
import type { AppConfig } from '../config';
import type { ProgramStartRequest } from '../shared/types';
import type { ProgramStarter } from './ProgramStarter';

function formatProgramText(program: number): string {
  return `P${String(program).padStart(2, '0')}`;
}

export function createProgramsRouter(options: { config: AppConfig; programStarter: ProgramStarter }): Router {
  const router = Router();

  router.get('/config', (_req, res) => {
    const scriptPath = options.config.PROGRAM_START_SCRIPT_PATH;
    res.json({
      ok: true,
      mode: options.config.PROGRAM_START_MODE,
      command: options.config.PROGRAM_START_COMMAND,
      scriptPath,
      scriptExists: scriptPath ? existsSync(scriptPath) : false,
      cwd: process.cwd(),
    });
  });

  router.post('/start', async (req, res) => {
    const program = Number(req.body?.program);
    if (!Number.isInteger(program) || program < 1 || program > 31) {
      return res.status(400).json({ ok: false, error: 'INVALID_PROGRAM', message: 'Program must be an integer from 1 to 31' });
    }

    const barcode = typeof req.body?.barcode === 'string' && req.body.barcode.trim() ? req.body.barcode.trim() : 'manual_program_start';
    const now = new Date().toISOString();
    const request: ProgramStartRequest = {
      type: 'program_start_request',
      barcode,
      matchedKey: barcode,
      program,
      programText: formatProgramText(program),
      selectedAt: now,
    };
    const result = await options.programStarter.startProgram(request);
    return res.status(result.success ? 200 : 500).json({ ok: result.success, request, result });
  });

  return router;
}
