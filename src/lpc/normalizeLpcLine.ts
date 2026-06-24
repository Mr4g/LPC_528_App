export function normalizeLpcLine(raw: string): string {
  return raw.replace(/\r/g, '').replace(/\t/g, ' ').replace(/→/g, ' ').replace(/ +/g, ' ').trim();
}
