import type { Server } from 'socket.io';
import type { CurrentTest, LpcResult } from '../shared/types';
import type { CurrentTestStore } from '../scanner/currentTestStore';
import type { LastResultStore } from './LastResultStore';
import type { ResultHistoryStore } from './ResultHistoryStore';
import type { AppDatabase } from '../server/db/database';
import type { TestSessionManager } from '../server/test-session/testSessionManager';
import { isIgnoredLpcLine, isInterfaceSelectionPrompt } from './lpcFrameFilters';
import { normalizeLpcLine } from './normalizeLpcLine';
import { parseLpcResult } from './parseLpcResult';
import { parseLpcStream } from './parseLpcStream';
import type { LpcTcpClient } from './LpcTcpClient';
import { LpcTestCurveBuffer } from './LpcTestCurveBuffer';

export type LpcParsedAs = 'stream' | 'result' | 'ignored' | 'error';

export interface EnrichedLpcResult extends LpcResult {
  currentTestValid: boolean;
  currentTestBarcode?: string;
  currentTestProgram?: number;
  currentTestProgramText?: string;
  currentTestSelectedAt?: string;
  operatorLogin?: string | null;
  operatorRole?: string | null;
}

export interface LpcRawLineDiagnostic {
  receivedAt: string;
  raw: string;
  normalized: string;
  parsedAs: LpcParsedAs;
  reason?: string;
  parseError?: string;
}

export interface LpcPipelineStatus {
  lastRawLineAt: string | null;
  lastStreamAt: string | null;
  lastResultAt: string | null;
  rawLinesCount: number;
  streamCount: number;
  resultCount: number;
}

export interface LpcLineProcessorOptions {
  io: Server;
  tcpClient: LpcTcpClient;
  currentTestStore: CurrentTestStore;
  curveBuffer: LpcTestCurveBuffer;
  lastResultStore?: LastResultStore;
  resultHistoryStore?: ResultHistoryStore;
  autoSelectInterface: boolean;
  interfaceSelection: string;
  currentTestMaxAgeMs: number;
  debugLines: boolean;
  debugPipeline?: boolean;
  maxRawLines?: number;
  database?: AppDatabase;
  testSessionManager?: TestSessionManager;
}

export class LpcLineProcessor {
  private readonly rawLines: LpcRawLineDiagnostic[] = [];
  private readonly maxRawLines: number;
  private interfaceSelectionSent = false;
  private lastRawLineAt: string | null = null;
  private lastStreamAt: string | null = null;
  private lastResultAt: string | null = null;
  private streamCount = 0;
  private resultCount = 0;

  constructor(private readonly options: LpcLineProcessorOptions) {
    this.maxRawLines = options.maxRawLines ?? 100;
  }

  processLine(rawLine: string): LpcRawLineDiagnostic {
    const receivedAt = new Date().toISOString();
    const diagnostic: LpcRawLineDiagnostic = {
      receivedAt,
      raw: rawLine,
      normalized: normalizeLpcLine(rawLine),
      parsedAs: 'ignored',
    };
    this.lastRawLineAt = receivedAt;

    try {
      if (this.options.debugLines) {
        this.options.io.emit('lpc:line', { raw: rawLine, receivedAt });
      }
      this.debugLog('RAW LPC LINE', diagnostic.normalized);

      if (this.shouldSelectInterface(rawLine)) {
        this.interfaceSelectionSent = true;
        const command = `${this.options.interfaceSelection}\r\n`;
        this.options.tcpClient.send(command);
        const payload = { selectedAt: new Date().toISOString(), command };
        this.emit('lpc:interface-selected', payload);
        diagnostic.reason = 'interface-selection-prompt';
        this.storeRawLine(diagnostic);
        this.debugLog('IGNORED LINE reason', diagnostic.reason);
        console.log('LPC interface selection prompt detected; sent Interface Connection1 selection.');
        return diagnostic;
      }

      const streamPoint = parseLpcStream(rawLine);
      if (streamPoint) {
        const curvePoint = this.options.curveBuffer.addStreamPoint(streamPoint);
        this.lastStreamAt = receivedAt;
        this.options.testSessionManager?.markStream();
        this.streamCount += 1;
        diagnostic.parsedAs = 'stream';
        this.storeRawLine(diagnostic);

        const streamPayload = {
          ...streamPoint,
          pressureMbar: streamPoint.pressureValue === null ? null : streamPoint.pressureValue * 1000,
          curvePoint,
        };
        this.emit('lpc:stream', streamPayload);
        this.emit('lpc:curve-updated', {
          points: this.options.curveBuffer.getPoints(),
          summary: this.options.curveBuffer.getSummary(),
        });
        this.debugLog('PARSED STREAM', streamPayload);
        return diagnostic;
      }

      const result = parseLpcResult(rawLine);
      if (result) {
        const enrichedResult = this.attachCurrentTest(result);
        this.options.database?.insertTestResult(enrichedResult, this.options.testSessionManager?.getActiveTestId() ?? null);
        this.options.lastResultStore?.set(enrichedResult);
        this.options.resultHistoryStore?.add(enrichedResult);
        this.options.testSessionManager?.complete();
        this.lastResultAt = receivedAt;
        this.resultCount += 1;
        diagnostic.parsedAs = 'result';
        this.storeRawLine(diagnostic);

        const history = this.options.resultHistoryStore?.getAll() ?? [];
        this.emit('lpc:result', enrichedResult);
        this.emit('test:completed', enrichedResult);
        this.emit('lpc:results-updated', { results: history });
        const completedCurve = this.options.curveBuffer.completeAndClear();
        this.emit('lpc:curve-completed', {
          result: enrichedResult,
          points: completedCurve.points,
          summary: completedCurve.summary,
        });
        this.debugLog('PARSED RESULT', enrichedResult);
        return diagnostic;
      }

      diagnostic.reason = this.getIgnoredReason(rawLine, diagnostic.normalized);
      this.storeRawLine(diagnostic);
      this.debugLog('IGNORED LINE reason', diagnostic.reason);
      return diagnostic;
    } catch (error) {
      diagnostic.parsedAs = 'error';
      diagnostic.parseError = error instanceof Error ? error.message : 'Unknown LPC line processing error';
      this.storeRawLine(diagnostic);
      this.debugLog('IGNORED LINE reason', diagnostic.parseError);
      return diagnostic;
    }
  }

  getRawLines(): LpcRawLineDiagnostic[] {
    return [...this.rawLines];
  }

  getLastRawLinesCount(): number {
    return this.rawLines.length;
  }

  getPipelineStatus(): LpcPipelineStatus {
    return {
      lastRawLineAt: this.lastRawLineAt,
      lastStreamAt: this.lastStreamAt,
      lastResultAt: this.lastResultAt,
      rawLinesCount: this.rawLines.length,
      streamCount: this.streamCount,
      resultCount: this.resultCount,
    };
  }

  private shouldSelectInterface(rawLine: string): boolean {
    if (!this.options.autoSelectInterface || this.interfaceSelectionSent) return false;

    return rawLine.includes('TCP/IP INTERFACE SELECTION') || isInterfaceSelectionPrompt(rawLine);
  }

  private attachCurrentTest(result: LpcResult): EnrichedLpcResult {
    const currentTest = this.options.currentTestStore.get();
    const isCurrentTestValid = this.options.currentTestStore.isValid(this.options.currentTestMaxAgeMs);

    if (!currentTest || !isCurrentTestValid) {
      return { ...result, currentTestValid: false };
    }

    return {
      ...result,
      currentTestValid: true,
      currentTestBarcode: currentTest.barcode,
      currentTestProgram: currentTest.program,
      currentTestProgramText: currentTest.programText,
      currentTestSelectedAt: currentTest.selectedAt,
      operatorLogin: currentTest.operatorLogin ?? null,
      operatorRole: currentTest.operatorRole ?? null,
      barcode: this.resolveBarcode(result, currentTest),
      program: currentTest.programText,
      programText: currentTest.programText,
    };
  }

  private resolveBarcode(result: LpcResult, currentTest: CurrentTest): string {
    if (currentTest.barcode) return currentTest.barcode;
    if (result.barcode && result.barcode !== 'No_barcode') return result.barcode;
    if (result.barcodeFromResult && result.barcodeFromResult !== 'No_barcode') return result.barcodeFromResult;
    return 'No_barcode';
  }

  private getIgnoredReason(rawLine: string, normalized: string): string {
    if (!normalized) return 'empty-line';
    if (isIgnoredLpcLine(normalized)) return 'known-lpc-menu-or-report-line';
    if (!/C\d{2}\s+N\d+\s+P\d{2}/.test(normalized)) return 'missing-result-frame-pattern';
    if (/\sS\s+C\d{2},P\d{2},/.test(rawLine)) return 'stream-frame-did-not-match-parser';
    return 'unmatched-lpc-line';
  }

  private storeRawLine(line: LpcRawLineDiagnostic): void {
    this.rawLines.push(line);
    if (this.rawLines.length > this.maxRawLines) {
      this.rawLines.splice(0, this.rawLines.length - this.maxRawLines);
    }
  }

  private emit(event: string, payload: unknown): void {
    this.options.io.emit(event, payload);
    this.debugLog('SOCKET EMIT event name', event);
  }

  private debugLog(label: string, payload: unknown): void {
    if (!this.options.debugPipeline) return;
    console.log(`[LPC PIPELINE] ${label}`, payload);
  }
}
