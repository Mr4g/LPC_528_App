import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LastResultPanel } from './LastResultPanel';

describe('LastResultPanel LL control action', () => {
  it('renders Kontrola LL as a horizontal action below the result panel when visible', () => {
    const html = renderToStaticMarkup(React.createElement(LastResultPanel, { result: { result: 'REJECT', barcode: 'B1', leakValue: 11.8, leakUnit: 'Pa/s', leakType: 'RL' } as never, llControlAction: { visible: true, message: 'Oznaczono do kontroli LL' } }));

    expect(html).toContain('last-result-ll-action');
    expect(html).toContain('Kontrola LL');
    expect(html).toContain('Oznaczono do kontroli LL');
  });

  it('does not render Kontrola LL after OK', () => {
    const html = renderToStaticMarkup(React.createElement(LastResultPanel, { result: { result: 'ACCEPT', barcode: 'B1' } as never, llControlAction: { visible: false } }));

    expect(html).not.toContain('Kontrola LL');
  });
});
