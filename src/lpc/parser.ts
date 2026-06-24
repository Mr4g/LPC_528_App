import type { LpcResult, LpcStreamPoint } from '../shared/types';

export function isInterfaceSelectionPrompt(payload: string): boolean {
  return payload.includes('* 1 Interface Connection1 *');
}

export function parseLpcResult(raw: string): LpcResult | null {
  // TODO: Implement LPC-528 result parser for Cxx Nxx Pxx frames and ignore Telnet/menu noise.
  void raw;
  return null;
}

export function parseLpcStream(raw: string): LpcStreamPoint | null {
  // TODO: Implement LPC-528 stream parser for frames such as: "9369034 S C01,P01,PRF,ET 5.20 sec,T 19.80 sec,P -0.00011 bar".
  void raw;
  return null;
}
