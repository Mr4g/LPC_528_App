import type { LpcResult } from '../shared/types';

export interface UiResult extends LpcResult {
  currentTestValid?: boolean;
}

export function mergeResultIntoHistory<T extends UiResult>(history: T[], result: T, limit = 10): T[] {
  return [result, ...history.filter((item) => item.receivedAt !== result.receivedAt)].slice(0, limit);
}

export function replaceHistoryFromResultsUpdated<T extends UiResult>(results: T[], limit = 10): T[] {
  return results.slice(0, limit);
}
