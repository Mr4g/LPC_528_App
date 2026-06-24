export class ZebraPrinter {
  buildTinyResultLabel(result: 'OK' | 'NOK', programText: string, barcode: string): string {
    // TODO: Tune ZPL for 30 mm x 8 mm at 203 dpi and send to configured TCP printer.
    const shortBarcode = barcode.slice(-8);
    return `^XA^CI28^FO8,8^A0N,22,22^FD${result} ${programText} ${shortBarcode}^FS^XZ`;
  }
}
