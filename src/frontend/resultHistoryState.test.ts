import { describe, expect, it } from 'vitest';
import type { UiResult } from './resultHistoryState';
import { mergeResultIntoHistory, replaceHistoryFromResultsUpdated } from './resultHistoryState';

function result(id: string): UiResult {
  return {
    source: 'LPC-528', receivedAt: id, messageId: null, messageType: null, channel: null, port: null, program: 'P01', programText: 'P01', linkInfo: null,
    result: 'ACCEPT', value: 'ACCEPT', testerTime: null, testerDate: null, uniqueId: id, totalAbs: id, programEvaluation: null, spcFlag: null,
    barcode: '5901234123457', barcodeFromResult: null, testType: null, testEvaluation: null, leakType: 'RL', leakValue: 1, leakUnit: 'pa/s', resultDetailsRaw: null,
    measurements: {}, RL: null, RL_unit: null, Pt: null, Pt_unit: null, EDC: null, EDC_unit: null, PL: null, PL_unit: null, LLR: null, LLR_unit: null, HLR: null, HLR_unit: null, FPR: null, FPR_unit: null,
    raw: '', normalized: '',
  };
}

describe('result history state helpers', () => {
  it('adds a fallback lpc:result to the top of the table', () => {
    expect(mergeResultIntoHistory([result('old')], result('new')).map((item) => item.receivedAt)).toEqual(['new', 'old']);
  });

  it('uses lpc:results-updated payload as the table source', () => {
    expect(replaceHistoryFromResultsUpdated([result('a'), result('b')]).map((item) => item.receivedAt)).toEqual(['a', 'b']);
  });
});
