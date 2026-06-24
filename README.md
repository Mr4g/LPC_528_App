# LPC-528 App

Szkielet aplikacji Node.js / TypeScript, która ma zastąpić aktualny flow Node-RED używany do obsługi testera szczelności LPC-528, skanera barcode, drukarki Zebra i Splunka.

## Cel migracji z Node-RED

Aplikacja będzie działać na Windows IPC i ma zapewnić:

- backend TCP/Telnet dla LPC-528,
- prosty ekran operatorski React/Vite pod panel dotykowy,
- live komunikację backend/frontend przez Socket.IO,
- modułową logikę zamiast przepływów Node-RED,
- konfigurację przez `.env`, bez sekretów i hardcodowanych ścieżek w kodzie.

## Aktualny zakres

Projekt zawiera szkielet backendu i frontendu, parsery LPC Result/Stream oraz działający przepływ skanowania barcode: `POST /api/scan`, mapowanie barcode -> program z `.env`, zapis `currentTest` w pamięci procesu, mock/script `ProgramStarter` oraz eventy Socket.IO `scan:accepted` i `scan:rejected`.

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

## Jak odpalić projekt lokalnie

### 1. Zainstaluj zależności

W katalogu repozytorium uruchom:

```bash
npm install
```

### 2. Przygotuj konfigurację `.env`

Skopiuj plik przykładowy:

```bash
cp .env.example .env
```

Następnie uzupełnij wartości w `.env` dla swojego środowiska, szczególnie adres LPC, Zebra, ścieżki skryptów, mapę `BARCODE_PROGRAM_MAP` oraz ustawienia Splunka. Nie commituj prawdziwych tokenów ani sekretów. Domyślnie `PROGRAM_START_MODE=mock`, żeby development nie uruchamiał przypadkowo programu na LPC. LPC TCP konfiguruje się przez `LPC_HOST`, `LPC_PORT`, `LPC_AUTO_CONNECT`, `LPC_RECONNECT_ENABLED`, `LPC_AUTO_SELECT_INTERFACE`, `LPC_DEBUG_LINES` i `CURRENT_TEST_MAX_AGE_MS`.

### 3. Uruchom backend i frontend w trybie developerskim

```bash
npm run dev
```

Ta komenda uruchamia równolegle:

- backend Express/Socket.IO z `src/server/index.ts`, domyślnie na porcie `APP_PORT` z `.env`,
- frontend Vite/React dostępny przez serwer Vite.

### 4. Alternatywnie uruchom tylko jedną część aplikacji

Backend:

```bash
npm run dev:backend
```

Frontend:

```bash
npm run dev:frontend
```

### 5. Sprawdź backend

Po starcie backendu healthcheck powinien odpowiadać pod adresem:

```bash
curl http://localhost:3000/api/health
```

Jeżeli zmienisz `APP_PORT` w `.env`, użyj odpowiedniego portu zamiast `3000`.

## LPC TCP / Telnet

Backend działa jako klient TCP/Telnet do testera LPC-528. Po połączeniu odbiera dane strumieniowo, dzieli tekst po `\n`, zachowuje ostatnie 100 raw lines diagnostycznych i używa istniejących parserów `parseLpcStream` oraz `parseLpcResult`.

Jeżeli LPC pokaże menu `TCP/IP INTERFACE SELECTION` lub `* 1 Interface Connection1 *`, a `LPC_AUTO_SELECT_INTERFACE=true`, backend wyśle skonfigurowany wybór interfejsu (`LPC_INTERFACE_SELECTION`, domyślnie `1`) jako `1\r\n` i wyemituje event Socket.IO `lpc:interface-selected`.

Socket.IO eventy LPC:

- `lpc:connected`
- `lpc:disconnected`
- `lpc:error`
- `lpc:line` tylko przy `LPC_DEBUG_LINES=true`
- `lpc:stream`
- `lpc:result`
- `lpc:curve-completed`
- `test:completed`
- `lpc:interface-selected`

### Endpointy diagnostyczne LPC

```text
GET  /api/lpc/status
POST /api/lpc/connect
POST /api/lpc/disconnect
POST /api/lpc/send        body: { "data": "1\r\n" }
GET  /api/lpc/raw-lines
GET  /api/lpc/curve
```

`/api/lpc/status` zwraca m.in. status połączenia, host/port, auto connect, reconnect, ostatni błąd, liczbę raw lines i liczbę punktów aktualnej krzywej.

### Ręczny test LPC TCP

1. Uruchom backend i frontend: `npm run dev` albo osobno `npm run dev:backend` oraz `npm run dev:frontend`.
2. Sprawdź status: `curl http://localhost:3000/api/lpc/status`.
3. Kliknij `Połącz` w UI albo ustaw `LPC_AUTO_CONNECT=true` w `.env`.
4. Sprawdź, czy po menu interface backend wysyła `1\r\n` i emituje `lpc:interface-selected`.
5. Zeskanuj `7472475`, żeby ustawić `currentTest` na `P01`.
6. Uruchom test na LPC.
7. Sprawdź w UI live stream ciśnienia oraz końcowy wynik LPC powiązany z `currentTest`.

## Ręczny test scan flow

Po uruchomieniu aplikacji lokalnie możesz sprawdzić przepływ skanowania:

1. Uruchom backend: `npm run dev:backend`.
2. Uruchom frontend: `npm run dev:frontend`.
3. W panelu operatorskim wpisz `7472475` i naciśnij Enter.
4. Oczekiwany efekt: aplikacja pokaże `P01`, zapisze `currentTest`, a backend wyemituje `scan:accepted`.
5. Wpisz nieznany barcode.
6. Oczekiwany efekt: aplikacja pokaże błąd `NO_MAPPING`, a backend wyemituje `scan:rejected`.

Backendowo można sprawdzić aktualny test komendą:

```bash
curl http://localhost:3000/api/current-test
```

## Komendy developerskie

```bash
npm install
npm run dev
npm run dev:backend
npm run dev:frontend
npm run dev:frontend:force
npm run typecheck
npm test
npm run build
```

## Troubleshooting

### Windows / Vite: `EPERM: operation not permitted, rmdir node_modules/.vite/deps`

Jeżeli Vite na Windowsie nie może usunąć cache w `node_modules/.vite/deps`, użyj cache poza projektem.

1. Zatrzymaj aplikację.
2. Ubij procesy Node w PowerShell:

```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
```

3. Usuń stary cache Vite z projektu:

```powershell
Remove-Item -Recurse -Force .\node_modules\.vite -ErrorAction SilentlyContinue
```

4. Ustaw `VITE_CACHE_DIR` poza projektem, np. w `.env`:

```env
VITE_CACHE_DIR=C:\temp\lpc-528-app-vite-cache
```

5. Uruchom frontend z wymuszoną przebudową cache:

```bash
npm run dev:frontend:force
```

Konfiguracja Vite domyślnie używa cache w katalogu systemowym temp (`lpc-528-app-vite-cache`), więc nie powinna już korzystać z `node_modules/.vite`.

## Node-RED parity backlog

- LPC TCP/Telnet: klient TCP, auto reconnect, auto wybór interface, endpointy diagnostyczne i Socket.IO live data są zaimplementowane.
- Parser result: zaimplementowany dla linii z wzorem `Cxx Nxx Pxx`, z filtrowaniem menu, raportów i śmieci Telnetowych.
- Parser stream: zaimplementowany dla ramek ciśnienia; publikacja live przez Socket.IO pozostaje do podłączenia do TCP.
- Bufor testu: przeliczać `bar` na `mbar`, limitować liczbę punktów i opcjonalnie próbkować co `LPC_MIN_ELAPSED_STEP_SEC`.
- Scanner: UI input barcode, `POST /api/scan`, mapowanie z `.env`, `currentTest` i eventy Socket.IO są zaimplementowane; później integracja sprzętowa.
- ProgramStarter: dostępny tryb `mock` i `script`; domyślnie `mock` dla bezpiecznego developmentu.
- Splunk: payload HEC z konfiguracją z `.env`, bez hardcodowanych tokenów.
- Zebra: ZPL dla etykiety około 30 mm x 8 mm, 203 dpi, host/port z `.env`.
- Backup CSV: `POST /api/backup/run` i `GET /api/backup/latest.csv` na konfigurowalnej komendzie i ścieżce.

## Następne kroki

1. Podłączyć Splunk HEC dla wyników testu.
2. Podłączyć Zebra TCP/ZPL dla etykiet.
3. Dokończyć backup CSV ponad obecny router szkieletowy.
4. Zastąpić placeholder listy punktów pełnym wykresem ciśnienia.
5. Podłączyć sprzętowy scanner HID bez inputu UI, jeśli będzie wymagany.
