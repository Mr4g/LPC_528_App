import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('operator login screen card scan UI', () => {
  const source = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');

  it('uses a hidden technical input for card UID instead of a visible card textbox', () => {
    expect(source).toContain('className="card-scan-hidden-input"');
    expect(source).toContain('Przyłóż kartę do czytnika ELATEC TWN4.');
    expect(source).not.toContain('className="auth-input card-reader-input"');
    expect(source).not.toContain('placeholder="Przyłóż kartę"');
  });

  it('keeps Enter submission wired to the hidden card buffer', () => {
    expect(source).toContain("event.key === 'Enter'");
    expect(source).toContain('submitCard(cardBufferRef.current)');
  });
});
