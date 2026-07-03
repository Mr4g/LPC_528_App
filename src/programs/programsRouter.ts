import crypto from 'node:crypto';
import { existsSync, mkdirSync, promises as fsPromises } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import type { AppConfig } from '../config';
import { requireRole, type AuthenticatedRequest } from '../server/auth/authMiddleware';
import type { ProgramStartRequest } from '../shared/types';
import type { ProgramStarter } from './ProgramStarter';
import type { ProgramMappingService } from './programMappingStore';

function formatProgramText(program: number): string {
  return `P${String(program).padStart(2, '0')}`;
}

const MAX_INSTRUCTION_PDF_BYTES = 20 * 1024 * 1024;

function getInstructionUploadDir(config: AppConfig): string {
  return path.resolve(config.PROGRAM_INSTRUCTION_UPLOAD_DIR);
}

function sanitizeOriginalName(name: string): string {
  return path.basename(name).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 160) || 'instruction.pdf';
}

function readRequestBody(req: AuthenticatedRequest, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Plik PDF jest za duży.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipartPdf(body: Buffer, contentType: string | undefined): { originalName: string; data: Buffer; mimeType: string } {
  const boundary = contentType?.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[1] ?? contentType?.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[2];
  if (!boundary) throw new Error('Brak pliku PDF.');
  const raw = body.toString('binary');
  const parts = raw.split(`--${boundary}`);
  for (const part of parts) {
    if (!part.includes('name="file"')) continue;
    const [rawHeaders, ...rest] = part.split('\r\n\r\n');
    const content = rest.join('\r\n\r\n');
    const filename = rawHeaders.match(/filename="([^"]+)"/i)?.[1] ?? '';
    const mimeType = rawHeaders.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() ?? '';
    const fileBinary = content.replace(/\r\n--$/, '').replace(/\r\n$/, '');
    return { originalName: sanitizeOriginalName(filename), data: Buffer.from(fileBinary, 'binary'), mimeType };
  }
  throw new Error('Brak pliku PDF.');
}

export function createProgramsRouter(options: { config: AppConfig; programStarter: ProgramStarter; programMappingService?: ProgramMappingService }): Router {
  const router = Router();

  router.get('/debug', (_req, res) => {
    const scriptPath = options.config.PROGRAM_START_SCRIPT_PATH;
    res.json({
      ok: true,
      mode: options.config.PROGRAM_START_MODE,
      command: options.config.PROGRAM_START_COMMAND,
      scriptPath,
      scriptExists: scriptPath ? existsSync(scriptPath) : false,
      dryRunEnabled: options.config.EIP_DRY_RUN,
      dryRunSource: options.config.EIP_DRY_RUN ? 'EIP_DRY_RUN' : 'none',
    });
  });

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

  router.post('/start', async (req: AuthenticatedRequest, res) => {
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
      operatorLogin: req.user?.login,
      operatorRole: req.user?.role,
    };
    const result = await options.programStarter.startProgram(request);
    return res.status(result.success ? 200 : 500).json({ ok: result.success, request, result });
  });

  router.get('/:id/instruction', (req, res) => {
    const metadata = options.programMappingService?.getInstructionMetadata(String(req.params.id));
    if (!metadata) return res.status(404).json({ ok: false, error: 'PROGRAM_NOT_FOUND' });
    return res.json({ ok: true, ...metadata });
  });

  router.get('/:id/instruction/file', async (req, res) => {
    const mapping = options.programMappingService?.list().find((item) => item.id === String(req.params.id));
    if (!mapping) return res.status(404).json({ ok: false, error: 'PROGRAM_NOT_FOUND' });
    if (!mapping.instructionPdfStoredName) return res.status(404).json({ ok: false, error: 'INSTRUCTION_NOT_FOUND' });
    const storedName = path.basename(mapping.instructionPdfStoredName);
    const uploadDir = getInstructionUploadDir(options.config);
    const filePath = path.join(uploadDir, storedName);
    if (!filePath.startsWith(uploadDir)) return res.status(400).json({ ok: false, error: 'INVALID_FILE_PATH' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${mapping.instructionPdfOriginalName ?? 'instruction.pdf'}"`);
    return res.sendFile(filePath);
  });

  router.post('/:id/instruction', requireRole(['admin', 'line_leader']), async (req: AuthenticatedRequest, res) => {
    try {
      const mapping = options.programMappingService?.list().find((item) => item.id === String(req.params.id));
      if (!mapping) return res.status(404).json({ ok: false, error: 'PROGRAM_NOT_FOUND' });
      const body = await readRequestBody(req, MAX_INSTRUCTION_PDF_BYTES + 1024 * 1024);
      const file = parseMultipartPdf(body, req.headers['content-type']);
      if (file.mimeType !== 'application/pdf' || !file.originalName.toLowerCase().endsWith('.pdf') || !file.data.subarray(0, 4).equals(Buffer.from('%PDF'))) {
        return res.status(400).json({ ok: false, error: 'INVALID_PDF', message: 'Dozwolone są tylko pliki PDF.' });
      }
      if (file.data.length > MAX_INSTRUCTION_PDF_BYTES) return res.status(413).json({ ok: false, error: 'PDF_TOO_LARGE' });
      const uploadDir = getInstructionUploadDir(options.config);
      mkdirSync(uploadDir, { recursive: true });
      const storedName = `${crypto.randomUUID()}.pdf`;
      await fsPromises.writeFile(path.join(uploadDir, storedName), file.data);
      const updated = options.programMappingService?.setInstructionPdf(mapping.id, {
        storedName,
        originalName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.data.length,
        uploadedBy: req.user?.login ?? null,
      });
      return res.status(201).json({ ok: true, instruction: updated ? options.programMappingService?.getInstructionMetadata(updated.id) : null });
    } catch (error) {
      return res.status(400).json({ ok: false, error: 'PDF_UPLOAD_FAILED', message: error instanceof Error ? error.message : 'Nie udało się zapisać PDF.' });
    }
  });

  router.delete('/:id/instruction', requireRole(['admin', 'line_leader']), async (req: AuthenticatedRequest, res) => {
    const mapping = options.programMappingService?.list().find((item) => item.id === String(req.params.id));
    if (!mapping) return res.status(404).json({ ok: false, error: 'PROGRAM_NOT_FOUND' });
    if (mapping.instructionPdfStoredName) {
      const uploadDir = getInstructionUploadDir(options.config);
      const filePath = path.join(uploadDir, path.basename(mapping.instructionPdfStoredName));
      if (filePath.startsWith(uploadDir)) await fsPromises.unlink(filePath).catch(() => undefined);
    }
    options.programMappingService?.removeInstructionPdf(mapping.id, req.user?.login ?? null);
    return res.json({ ok: true, instruction: { exists: false, originalName: null, uploadedAt: null, uploadedBy: null, sizeBytes: null } });
  });

  return router;
}
