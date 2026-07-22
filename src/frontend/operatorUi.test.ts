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

describe('admin users row action menu behavior', () => {
  const mainSource = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');
  const cssSource = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

  it('uses a single open user menu state and closes on outside pointer or Escape', () => {
    expect(mainSource).toContain('const [openUserMenuId, setOpenUserMenuId]');
    expect(mainSource).toContain('activeMenuRef.current?.contains(target)');
    expect(mainSource).toContain('activeTriggerRef.current?.contains(target)');
    expect(mainSource).toContain("if (event.key === 'Escape') setOpenUserMenuId(null)");
    expect(mainSource).toContain("document.addEventListener('pointerdown', handlePointerDown)");
    expect(mainSource).toContain("document.removeEventListener('pointerdown', handlePointerDown)");
  });

  it('switches menus per user, labels the trigger, and closes when actions run', () => {
    expect(mainSource).toContain('aria-label={`Akcje użytkownika ${item.login}`}');
    expect(mainSource).toContain('setOpenUserMenuId(openUserMenuId === item.id ? null : item.id)');
    expect(mainSource).toContain('setOpenUserMenuId(null); void changeRole(item);');
    expect(mainSource).toContain('setOpenUserMenuId(null); void changeCard(item.id);');
    expect(mainSource).toContain('setOpenUserMenuId(null); void resetPassword(item.id);');
  });

  it('gives the row action trigger a larger click target without increasing row height', () => {
    expect(cssSource).toContain('.users-table-wrap .row-actions-trigger');
    expect(cssSource).toContain('width: 44px;');
    expect(cssSource).toContain('min-width: 44px;');
    expect(cssSource).toContain('height: 36px;');
    expect(cssSource).toContain('display: inline-flex;');
    expect(cssSource).toContain('justify-content: center;');
    expect(cssSource).toContain('.users-table-wrap .row-actions-trigger:focus-visible');
  });
});

describe('LL control ergonomic UI layout', () => {
  const mainSource = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');
  const lastResultPanelSource = readFileSync(new URL('./components/LastResultPanel.tsx', import.meta.url), 'utf8');
  const chartSource = readFileSync(new URL('./components/PressureChart.tsx', import.meta.url), 'utf8');
  const cssSource = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

  it('renders the Kontrola LL action under the last-result panel instead of the chart', () => {
    expect(lastResultPanelSource).toContain('last-result-ll-action');
    expect(lastResultPanelSource).toContain('ll-control-button');
    expect(chartSource).not.toContain('chart-quality-action');
  });

  it('limits the inline LL controls list to two table rows and exposes Pełna lista without manual refresh', () => {
    expect(mainSource).toContain('openLlFlags.slice(0, 2).map');
    expect(mainSource).toContain('ll-open-table results-table');
    expect(mainSource).toContain('Pełna lista');
    expect(mainSource).toContain('llListModalOpen');
    expect(mainSource).not.toContain('>Odśwież<');
  });

  it('adds Kontrole LL to the burger menu and opens the shared modal', () => {
    expect(mainSource).toContain('onLlControls={() => void openLlControlsModal()}');
    expect(mainSource).toContain('Oczekujące kontrole LL');
  });

  it('refreshes the open LL list after flagging and after resolved test events', () => {
    expect(mainSource).toContain('[LL_CONTROL_UI] flag created, refreshing open list');
    expect(mainSource).toContain('[LL_CONTROL_UI] open list refreshed count=');
    expect(mainSource).toContain('payload.llControl?.resolvedByThisTest');
  });

  it('shows the inline LL button only for operators and hides empty manager LL panel', () => {
    expect(mainSource).toContain("authUser?.role === 'operator'");
    expect(mainSource).toContain('isManager(authUser) && openLlFlags.length > 0');
  });

  it('renders a polished block modal for operator LL-control stops', () => {
    expect(mainSource).toContain('ll-block-modal');
    expect(mainSource).toContain('Wymagana kontrola LL');
    expect(mainSource).toContain('Ta sztuka wymaga kontroli lidera linii. Zaloguj LL, aby wykonać test.');
  });

  it('signals master-sample mode on the LIVE panel instead of the top bar', () => {
    expect(mainSource).toContain('live-panel--master-sample');
    expect(mainSource).not.toContain('master-sample-badge');
    expect(cssSource).toContain('.live-panel--master-sample');
  });
});
