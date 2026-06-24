import type { Server } from 'socket.io';
import type { CurrentTest, LpcResult } from '../shared/types';
import type { CurrentTestStore } from '../scanner/currentTestStore';
import { isInterfaceSelectionPrompt } from './lpcFrameFilters';
import { parseLpcResult } from './parseLpcResult';
import { parseLpcStream } from './parseLpcStream';
import type { LpcTcpClient } from './LpcTcpClient';
import { LpcTestCurveBuffer } from './LpcTestCurveBuffer';

export interface EnrichedLpcResult extends LpcResult {
  currentTestValid: boolean;
  currentTestBarcode?: string;
  currentTestProgram?: number;
  currentTestProgramText?: string;
  currentTestSelectedAt?: string;
}

export interface LpcLineProcessorOptions {
  io: Server;
  tcpClient: LpcTcpClient;
  currentTestStore: CurrentTestStore;
  curveBuffer: LpcTestCurveBuffer;
  autoSelectInterface: boolean;
  interfaceSelection: string;
  currentTestMaxAgeMs: number;
  debugLines: boolean;
  maxRawLines?: number;
}

export class LpcLineProcessor {
  private readonly rawLines: string[] = [];
  private readonly maxRawLines: number;
  private interfaceSelectionSent = false;

  constructor(private readonly options: LpcLineProcessorOptions) {
    this.maxRawLines = options.maxRawLines ?? 100;
  }

  processLine(rawLine: string): void {
    this.storeRawLine(rawLine);

    if (this.options.debugLines) {
      this.options.io.emit('lpc:line', { raw: rawLine, receivedAt: new Date().toISOString() });
    }

    if (this.shouldSelectInterface(rawLine)) {
      this.interfaceSelectionSent = true;
      const command = `${this.options.interfaceSelection}\r\n`;
      this.options.tcpClient.send(command);
      const payload = { selectedAt: new Date().toISOString(), command: `${this.options.interfaceSelection}\\r\\n` };
      this.options.io.emit('lpc:interface-selected', payload);
      console.log('LPC interface selection prompt detected; sent Interface Connection1 selection.');
      return;
    }

    const streamPoint = parseLpcStream(rawLine);
    if (streamPoint) {
      const curvePoint = this.options.curveBuffer.addStreamPoint(streamPoint);
      this.options.io.emit('lpc:stream', {
        ...streamPoint,
        pressureMbar: streamPoint.pressureValue === null ? null : streamPoint.pressureValue * 1000,
        curvePoint,
      });
      return;
    }

    const result = parseLpcResult(rawLine);
    if (result) {
      const enrichedResult = this.attachCurrentTest(result);
      this.options.io.emit('lpc:result', enrichedResult);
      this.options.io.emit('test:completed', enrichedResult);
      this.options.io.emit('lpc:curve-completed', {
        result: enrichedResult,
        points: this.options.curveBuffer.getPoints(),
        summary: this.options.curveBuffer.getSummary(),
      });
      this.options.curveBuffer.clear();
    }
  }

  getRawLines(): string[] {
    return [...this.rawLines];
  }

  getLastRawLinesCount(): number {
    return this.rawLines.length;
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

  private storeRawLine(rawLine: string): void {
    this.rawLines.push(rawLine);
    if (this.rawLines.length > this.maxRawLines) {
      this.rawLines.splice(0, this.rawLines.length - this.maxRawLines);
    }
  }
}
