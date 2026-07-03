import type { Server } from 'socket.io';
import type { CurrentTest, LpcResult } from '../shared/types';
import type { CurrentTestStore } from '../scanner/currentTestStore';
import type { LastResultStore } from './LastResultStore';
import type { ResultHistoryStore } from './ResultHistoryStore';
import type { AppDatabase } from '../server/db/database';
import type { AuthService } from '../server/auth/authService';
import type { TestSessionManager } from '../server/test-session/testSessionManager';
import { isIgnoredLpcLine, isInterfaceSelectionPrompt, isStopStreamingLine } from './lpcFrameFilters';
import { normalizeLpcLine } from './normalizeLpcLine';
import { parseLpcResult } from './parseLpcResult';
import { parseLpcStream } from './parseLpcStream';
import type { LpcTcpClient } from './LpcTcpClient';
import { LpcTestCurveBuffer } from './LpcTestCurveBuffer';
import { shouldPrintForResult, type ZebraPrinter } from '../zebra/ZebraPrinter';
import type { SplunkBuffer } from '../server/splunk/splunkBuffer';
import { buildSplunkResultEnvelope } from '../server/splunk/splunkPayload';
import type { SplunkRuntimeConfig } from '../server/splunk/splunkTypes';
import type { AppConfig } from '../config';

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
  authService?: AuthService;
  testSessionManager?: TestSessionManager;
  zebraPrinter?: ZebraPrinter;
  zebraEnabled?: boolean;
  zebraPrintOnResult?: boolean;
  splunkBuffer?: SplunkBuffer;
  splunkConfig?: SplunkRuntimeConfig;
  config?: Pick<AppConfig, 'LPC_HOST' | 'LPC_PORT' | 'LPC_INTERFACE_SELECTION' | 'LPC_RESULT_FRAME_FORMAT' | 'LPC_RESULT_OK_CODES' | 'LPC_RESULT_NOK_CODES'>;
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

      if (isStopStreamingLine(rawLine)) {
        console.log('[LPC_STREAM] stop_streaming received');
        diagnostic.reason = 'stop-streaming';
        this.storeRawLine(diagnostic);
        this.debugLog('IGNORED LINE reason', diagnostic.reason);
        return diagnostic;
      }

      const streamPoint = parseLpcStream(rawLine);
      if (streamPoint) {
        const curvePoint = this.options.curveBuffer.addStreamPoint(streamPoint);
        this.lastStreamAt = receivedAt;
        this.options.testSessionManager?.markLpcData(receivedAt);
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

      const result = parseLpcResult(rawLine, this.options.config?.LPC_RESULT_FRAME_FORMAT ?? 1, {
        okCodes: this.options.config?.LPC_RESULT_OK_CODES.split(','),
        nokCodes: this.options.config?.LPC_RESULT_NOK_CODES.split(','),
      });
      if (result) {
        const enrichedResult = this.attachCurrentTest(result);
        const activeSessionBeforeComplete = this.options.testSessionManager?.getStatus() ?? null;
        const completedCurve = this.options.curveBuffer.completeAndClear();
        this.options.database?.insertTestResult(enrichedResult, this.options.testSessionManager?.getActiveTestId() ?? null);
        this.options.lastResultStore?.set(enrichedResult);
        this.options.resultHistoryStore?.add(enrichedResult);
        this.options.testSessionManager?.complete(enrichedResult.resultRawStatus ?? enrichedResult.result);
        this.options.authService?.markTestActivity(activeSessionBeforeComplete?.operatorUserId);
        void this.autoPrint(enrichedResult);
        this.sendSplunkResult(enrichedResult, activeSessionBeforeComplete, completedCurve.points);
        this.lastResultAt = receivedAt;
        this.resultCount += 1;
        diagnostic.parsedAs = 'result';
        this.storeRawLine(diagnostic);

        const history = this.options.resultHistoryStore?.getAll() ?? [];
        this.emit('lpc:result', enrichedResult);
        this.emit('test:completed', enrichedResult);
        this.emit('lpc:results-updated', { results: history });
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
      this.debugLog('PARSER EXCEPTION', error instanceof Error ? (error.stack ?? error.message) : error);
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
      labelPrintMode: currentTest.labelPrintMode ?? 'ok_only',
      barcode: this.resolveBarcode(result, currentTest),
      program: currentTest.programText,
      programText: currentTest.programText,
    };
  }

  private sendSplunkResult(result: EnrichedLpcResult, session: ReturnType<TestSessionManager['getStatus']> | null, curvePoints: ReturnType<LpcTestCurveBuffer['getPoints']>): void {
    if (!this.options.splunkBuffer || !this.options.splunkConfig || !this.options.config || !this.options.splunkConfig.sendResult) return;
    const envelope = buildSplunkResultEnvelope(this.options.splunkConfig, { result, session, curvePoints, config: this.options.config });
    void this.options.splunkBuffer.sendOrQueue(envelope).catch((error) => console.warn('[SPLUNK] failed status=internal error=' + (error instanceof Error ? error.message : 'unknown')));
  }

  private async autoPrint(result: EnrichedLpcResult): Promise<void> {
    if (!this.options.zebraEnabled || !this.options.zebraPrintOnResult || !this.options.zebraPrinter) return;
    if (this.options.database?.getSetting('zebra.autoPrintEnabled') === 'false') {
      console.log('[ZEBRA] Auto print globally disabled');
      return;
    }
    if (!shouldPrintForResult(result.result, result.labelPrintMode ?? 'ok_only')) {
      console.log('[ZEBRA] Auto print skipped by labelPrintMode', { result: result.result, labelPrintMode: result.labelPrintMode ?? 'ok_only' });
      return;
    }
    const key = this.options.zebraPrinter.getAutoPrintKey(result);
    if (this.options.zebraPrinter.hasPrinted(key)) {
      console.log('[ZEBRA] Auto print skipped duplicate', { key });
      return;
    }
    console.log('[ZEBRA] Auto print allowed', { key, result: result.result, labelPrintMode: result.labelPrintMode ?? 'ok_only' });
    this.options.zebraPrinter.markPrinted(key);
    try {
      await this.options.zebraPrinter.printResult(result);
    } catch (error) {
      console.error('[ZEBRA] Auto print failed', error);
    }
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
