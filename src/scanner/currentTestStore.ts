import type { CurrentTest } from '../shared/types';

const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000;

export class CurrentTestStore {
  private currentTest: CurrentTest | null = null;

  set(currentTest: CurrentTest): void {
    this.currentTest = currentTest;
  }

  get(): CurrentTest | null {
    return this.currentTest;
  }

  clear(): void {
    this.currentTest = null;
  }

  isValid(maxAgeMs = DEFAULT_MAX_AGE_MS): boolean {
    if (!this.currentTest) return false;

    const selectedAtMs = Date.parse(this.currentTest.selectedAt);
    if (!Number.isFinite(selectedAtMs)) return false;

    return Date.now() - selectedAtMs <= maxAgeMs;
  }
}
