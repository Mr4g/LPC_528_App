import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('operator top bar and PDF modal layout', () => {
  const mainSource = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');
  const cssSource = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

  it('does not render the small top-bar result tile and uses the PDF instruction button there', () => {
    expect(mainSource).not.toContain('className={`top-result');
    expect(mainSource).toContain('className="instruction-top-button"');
    expect(mainSource).toContain('disabled={!instructionAvailable}');
    expect(mainSource).toContain('Brak instrukcji PDF dla programu');
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
    expect(mainSource).toContain('classifyScan(raw: string)');
    expect(mainSource).toContain('completeBufferedScan(pendingScan)');
    expect(mainSource).toContain('handleCardAction(classified.value)');
    expect(mainSource).not.toContain('handleCardAction(trimmedBarcode)');
  });

  it('has frontend idle logout wiring and activity endpoint sync', () => {
    expect(mainSource).toContain('[AUTH_IDLE] logout reason=idle_timeout');
    expect(mainSource).toContain('/api/auth/activity');
    expect(mainSource).toContain('Wylogowano z powodu bezczynności.');
  });
});

describe('LL control ergonomic UI layout', () => {
  const mainSource = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');
  const lastResultPanelSource = readFileSync(new URL('./components/LastResultPanel.tsx', import.meta.url), 'utf8');
  const chartSource = readFileSync(new URL('./components/PressureChart.tsx', import.meta.url), 'utf8');

  it('renders the Kontrola LL action under the last-result panel instead of the chart', () => {
    expect(lastResultPanelSource).toContain('last-result-ll-action');
    expect(lastResultPanelSource).toContain('ll-control-button');
    expect(chartSource).not.toContain('chart-quality-action');
  });

  it('limits the inline LL controls list to two items and exposes Pełna lista', () => {
    expect(mainSource).toContain('openLlFlags.slice(0, 2).map');
    expect(mainSource).toContain('Pełna lista');
    expect(mainSource).toContain('llListModalOpen');
  });

  it('adds Kontrole LL to the burger menu and opens the shared modal', () => {
    expect(mainSource).toContain('onLlControls={() => void openLlControlsModal()}');
    expect(mainSource).toContain('Oczekujące kontrole LL');
  });
});
