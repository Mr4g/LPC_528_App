import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('operator estimated leak UI wiring', () => {
  const mainSource = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');

  it('keeps estimated leak hidden behind LPC_ENABLE_ESTIMATED_LEAK_RATE', () => {
    expect(mainSource).toContain("frontendEnv.LPC_ENABLE_ESTIMATED_LEAK_RATE ?? 'false'");
    expect(mainSource).toContain('{estimatedLeakRateEnabled && (');
    expect(mainSource).toContain('Szacowany trend [Pa/s]');
  });

  it('labels live pressure and final RL separately', () => {
    expect(mainSource).toContain('Ciśnienie [mbar]');
    expect(mainSource).toContain('Finalny RL');
    expect(mainSource).toContain('RL [Pa/s]');
    expect(mainSource).toContain('Live z ramki S / DPT');
    expect(mainSource).toContain('Trend ciśnienia, nie wynik RL');
  });

  it('shows the EXH phase as proper measurement and remaining phase time', () => {
    expect(mainSource).toContain("normalized === 'EXH' || normalized === 'DPT'");
    expect(mainSource).toContain('Pomiar właściwy');
    expect(mainSource).toContain('Czas do końca fazy');
  });
});
