# LPC-528 App

Szkielet aplikacji Node.js / TypeScript, która ma zastąpić aktualny flow Node-RED używany do obsługi testera szczelności LPC-528, skanera barcode, drukarki Zebra i Splunka.

## Cel migracji z Node-RED

Aplikacja będzie działać na Windows IPC i ma zapewnić:

- backend TCP/Telnet dla LPC-528,
- prosty ekran operatorski React/Vite pod panel dotykowy,
- live komunikację backend/frontend przez Socket.IO,
- modułową logikę zamiast przepływów Node-RED,
- konfigurację przez `.env`, bez sekretów i hardcodowanych ścieżek w kodzie.

## Aktualny zakres pierwszego kroku

Ten etap tworzy strukturę projektu, typy danych, walidowany config loader, szkielet backendu i frontendu oraz moduły z TODO dla integracji LPC, barcode, startu programu, Splunka, Zebry i backupu CSV.

## Struktura katalogów

```text
src/lpc/       TCP/Telnet client, parser ramek LPC, bufor przebiegu testu
src/scanner/   mapowanie barcode -> program
src/programs/  abstrakcja uruchamiania programu testera
src/splunk/    payloady i klient Splunk HEC
src/zebra/     generowanie ZPL i wysyłka do drukarki
src/backup/    endpointy backupu CSV
src/config/    walidacja zmiennych środowiskowych
src/server/    Express + Socket.IO
src/shared/    wspólne typy TypeScript
src/frontend/  React/Vite operator panel
```

## Konfiguracja

Skopiuj `.env.example` do `.env` i dostosuj wartości do środowiska IPC. Token Splunka pozostaw poza repozytorium.

```bash
cp .env.example .env
```

## Komendy developerskie

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

## Node-RED parity backlog

- LPC TCP/Telnet: po połączeniu wykryć `* 1 Interface Connection1 *` i wysłać skonfigurowany wybór interfejsu.
- Parser result: obsłużyć linie z wzorem `Cxx Nxx Pxx`, zignorować menu, raporty i śmieci Telnetowe.
- Parser stream: obsłużyć ramki ciśnienia i publikować punkty przez Socket.IO.
- Bufor testu: przeliczać `bar` na `mbar`, limitować liczbę punktów i opcjonalnie próbkować co `LPC_MIN_ELAPSED_STEP_SEC`.
- Scanner: w pierwszej wersji UI input barcode, później integracja sprzętowa.
- ProgramStarter: obecnie warstwa abstrakcji pod skrypt, docelowo wymienna implementacja dla Windows IPC.
- Splunk: payload HEC z konfiguracją z `.env`, bez hardcodowanych tokenów.
- Zebra: ZPL dla etykiety około 30 mm x 8 mm, 203 dpi, host/port z `.env`.
- Backup CSV: `POST /api/backup/run` i `GET /api/backup/latest.csv` na konfigurowalnej komendzie i ścieżce.

## Następne kroki

1. Zaimplementować parser LPC result z testami na prawdziwych ramkach.
2. Zaimplementować parser stream i bufor punktów testu.
3. Podłączyć klienta TCP/Telnet LPC i emisję Socket.IO.
4. Dodać endpoint scan/start programu oraz implementację `ScriptProgramStarter`.
5. Podłączyć Splunk HEC, Zebra TCP i backup CSV.
