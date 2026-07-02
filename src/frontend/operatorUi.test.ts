import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('operator top bar and PDF modal layout', () => {
  const mainSource = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');
  const cssSource = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

  it('does not render the small top-bar result tile and uses the PDF instruction button there', () => {
    expect(mainSource).not.toContain('className={`top-result');
    expect(mainSource).toContain('className="instruction-top-button"');
  });

  it('uses a flex PDF modal body with a full-height PDF iframe', () => {
    expect(mainSource).toContain('className="pdf-viewer-body"');
    expect(mainSource).toContain('className="pdf-viewer-frame"');
    expect(cssSource).toContain('flex-direction: column;');
    expect(cssSource).toContain('.pdf-viewer-body');
    expect(cssSource).toContain('flex: 1 1 auto;');
    expect(cssSource).toContain('height: 100%;');
  });

  it('clears card-shaped input from the barcode field instead of submitting it', () => {
    expect(mainSource).toContain('CARD_UID_REGEX.test(nextValue)');
    expect(mainSource).toContain('setBarcode(\'\')');
    expect(mainSource).not.toContain('handleCardAction(trimmedBarcode)');
  });
});
