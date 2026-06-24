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

Frontend (Windows zalecane z wymuszoną przebudową cache):

```bash
npm run dev:frontend:force
```

Standardowy frontend bez `--force` nadal jest dostępny jako `npm run dev:frontend`.

### 5. Sprawdź backend

Po starcie backendu healthcheck powinien odpowiadać pod adresem:

```bash
curl http://localhost:3000/health
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
POST /api/lpc/check-port
POST /api/lpc/mock-line
```

`/api/lpc/status` zwraca m.in. status połączenia, host/port, auto connect, reconnect, ostatni błąd, liczbę raw lines i liczbę punktów aktualnej krzywej.

### Ręczny test LPC TCP

1. Uruchom backend i frontend: `npm run dev` albo osobno `npm run dev:backend` oraz `npm run dev:frontend:force`.
2. Sprawdź status: `curl http://localhost:3000/api/lpc/status`.
3. Kliknij `Połącz` w UI albo ustaw `LPC_AUTO_CONNECT=true` w `.env`.
4. Sprawdź, czy po menu interface backend wysyła `1\r\n` i emituje `lpc:interface-selected`.
5. Zeskanuj `7472475`, żeby ustawić `currentTest` na `P01`.
6. Uruchom test na LPC.
7. Sprawdź w UI live stream ciśnienia oraz końcowy wynik LPC powiązany z `currentTest`.

## Ręczny test scan flow

Po uruchomieniu aplikacji lokalnie możesz sprawdzić przepływ skanowania:

1. Uruchom backend: `npm run dev:backend`.
2. Uruchom frontend: `npm run dev:frontend:force`.
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

## Development on Windows

Zalecana komenda developerska na Windows:

```bash
npm run dev
```

Ta komenda uruchamia backend oraz frontend z `--force`, czyli używa stabilnego wariantu `dev:frontend:force` i przebudowuje cache Vite poza problematycznym `node_modules/.vite/deps`.

Jeśli uruchamiasz procesy osobno:

```bash
# terminal 1
npm run dev:backend

# terminal 2
npm run dev:frontend:force
```

Błędy Vite typu `ECONNREFUSED` dla `/api/lpc/status`, `/api/scan` albo `/socket.io/socket.io.js` oznaczają, że frontend działa, ale backend nie działa albo nie nasłuchuje na porcie `3000`.

Sprawdzenie backendu:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/lpc/status
```

Vite proxy dla `/api` i `/socket.io` wskazuje na `http://localhost:3000`. Jeśli zmienisz `APP_PORT` w `.env`, ustaw ten sam port w `vite.config.ts` albo uruchamiaj backend na porcie `3000` podczas developmentu.

## Troubleshooting


### Diagnostyka `connect ETIMEDOUT 192.168.200.50:23`

Jeśli UI pokazuje błąd podobny do `connect ETIMEDOUT 192.168.200.50:23`, backend nie połączył się realnie z TCP/Telnet LPC. Sprawdź:

- czy tester LPC ma IP `192.168.200.50`,
- czy komputer IPC jest w tej samej podsieci,
- PowerShell:

```powershell
Test-NetConnection 192.168.200.50 -Port 23
```

- ping:

```powershell
ping 192.168.200.50
```

- czy port `23` / Telnet w LPC jest aktywny,
- czy inny klient nie trzyma sesji LPC,
- czy firewall, VLAN albo polityka sieciowa nie blokuje połączenia.

Możesz też użyć UI: przycisk `Sprawdź port LPC` wywołuje `POST /api/lpc/check-port`, czyli krótką próbę TCP bez ruszania głównego klienta LPC.

Frontend może działać samodzielnie, ale wtedy endpointy `/api` i `/socket.io` będą zwracały `ECONNREFUSED`, jeśli backend nie działa. Backend sprawdzisz przez:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/lpc/status
```

Bez realnego LPC możesz przetestować UI wyniku przez panel `Diagnostyka` i endpoint developerski `POST /api/lpc/mock-line` (domyślnie włączony w `.env.example` przez `ENABLE_MOCK_LPC_ENDPOINTS=true`).

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

## Realne testy na LPC

Do testów bezpośrednio na LPC ustaw `.env`:

```env
LPC_HOST=192.168.200.50
LPC_PORT=23
LPC_AUTO_CONNECT=true
LPC_RECONNECT_ENABLED=true
LPC_RECONNECT_DELAY_MS=15000
LPC_AUTO_SELECT_INTERFACE=true
LPC_CONNECT_TIMEOUT_MS=5000
```

Uruchom aplikację:

```bash
npm run dev
```

Sprawdź w UI prawy górny status LPC:

- `connected` / zielony = można testować,
- `connecting` lub `reconnecting` / żółty = aplikacja próbuje połączyć się z LPC,
- `error` lub `disconnected` / czerwony = sprawdź sieć albo tester LPC.

Dla realnego startu programu ustaw `ProgramStarter` w trybie script, bez hardcodowania ścieżek w kodzie:

```env
PROGRAM_START_MODE=script
```

Windows:

```env
PROGRAM_START_COMMAND=python
PROGRAM_START_SCRIPT_PATH=C:\Projekty\LPC528_App\scripts\eip_start_program.py
```

Linux:

```env
PROGRAM_START_COMMAND=python3
PROGRAM_START_SCRIPT_PATH=/root/eip_start_program.py
```

Test operatora:

1. Zeskanuj barcode `5901234123457`.
2. UI powinien pokazać `P01` i status startu programu.
3. `ProgramStarter` odpala program w trybie `mock` albo `script` zależnie od `.env`.
4. LPC wysyła stream, a wykres ciśnienia aktualizuje się na żywo.
5. Po końcowym wyniku tabela `Ostatni wynik` pokazuje `OK`/`NOK`/`ERROR` i pomiary.

Bez realnego LPC możesz ustawić `VITE_SHOW_DIAGNOSTICS=true` i użyć `Wyślij mock line`, żeby przetestować UI wyniku przez `POST /api/lpc/mock-line`.

Operator nie używa diagnostycznych endpointów `POST /api/lpc/connect` i `POST /api/lpc/disconnect`; połączenie jest automatyczne przez `LPC_AUTO_CONNECT=true`, a reconnect działa co `LPC_RECONNECT_DELAY_MS`.

## Node-RED parity backlog

- LPC TCP/Telnet: klient TCP, auto reconnect, auto wybór interface, endpointy diagnostyczne i Socket.IO live data są zaimplementowane.
- Parser result: zaimplementowany dla linii z wzorem `Cxx Nxx Pxx`, z filtrowaniem menu, raportów i śmieci Telnetowych.
- Parser stream: zaimplementowany dla ramek ciśnienia; publikacja live przez Socket.IO pozostaje do podłączenia do TCP.
- Bufor testu: przelicza `bar` na `mbar`, limituje punkty i zasila prosty wykres SVG w UI.
- Scanner: UI input barcode, `POST /api/scan`, mapowanie z `.env`, `currentTest` i eventy Socket.IO są zaimplementowane; do rozważenia skaner HID bez inputu UI.
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

## Produkcyjny start programu LPC (script vs mock)

Domyślnie aplikacja jest bezpieczna dla developmentu i używa:

```env
PROGRAM_START_MODE=mock
```

W tym trybie skan wybiera program i zapisuje `currentTest`, ale **nie wysyła programu do fizycznego LPC**. UI pokazuje komunikat `TRYB MOCK — program nie jest wysyłany do LPC`.

Aby realnie uruchamiać program na LPC tak jak w Node-RED (`python ... eip_start_program.py <program>`), ustaw w `.env` tryb `script`:

Windows:

```env
PROGRAM_START_MODE=script
PROGRAM_START_COMMAND=python
PROGRAM_START_SCRIPT_PATH=C:\Projekty\LPC528_App\scripts\eip_start_program.py
```

Linux:

```env
PROGRAM_START_MODE=script
PROGRAM_START_COMMAND=python3
PROGRAM_START_SCRIPT_PATH=/root/eip_start_program.py
```

Dla programu `P01` backend uruchomi proces w formie: `PROGRAM_START_COMMAND PROGRAM_START_SCRIPT_PATH 1`. Wynik startu zawiera `mode`, `command`, `scriptPath`, `args`, `stdout`, `stderr`, `exitCode`, `errorMessage` i `message`, a ta sama odpowiedź wraca z `/api/scan` i eventu Socket.IO `scan:accepted`.

### Diagnostyka ProgramStarter

Sprawdź aktualną konfigurację:

```bash
curl http://localhost:3000/api/programs/config
```

Test bez skanowania:

```bash
curl -X POST http://localhost:3000/api/programs/start \
  -H "Content-Type: application/json" \
  -d '{"program":1,"barcode":"5901234123457"}'
```

Jeśli `success=false`, sprawdź pola `stdout`, `stderr`, `exitCode` i `errorMessage`. Najczęstsze przyczyny to pusty `PROGRAM_START_SCRIPT_PATH`, brak pliku skryptu, brak komendy `python`/`python3` w `PATH` albo błąd skryptu.

## Watchdog połączenia LPC / odłączony kabel

Socket TCP może przez chwilę wyglądać na połączony po fizycznym odpięciu kabla. Dlatego klient LPC ma watchdog i heartbeat konfigurowane przez `.env`:

```env
LPC_HEARTBEAT_ENABLED=true
LPC_HEARTBEAT_INTERVAL_MS=5000
LPC_HEARTBEAT_TIMEOUT_MS=12000
LPC_STALE_CONNECTION_TIMEOUT_MS=15000
LPC_HEARTBEAT_PAYLOAD=
LPC_RECONNECT_DELAY_MS=15000
```

Domyślnie `LPC_HEARTBEAT_PAYLOAD` jest pusty, więc aplikacja **nie wysyła żadnych dodatkowych znaków do LPC podczas testu**. Watchdog sprawdza stan socketu, TCP keepalive, `destroyed` i `writable`. Jeśli chcesz wymusić zapis diagnostyczny, możesz ustawić payload, np. `\r\n`, ale zrób to dopiero po potwierdzeniu, że nie zakłóca testów LPC.

Endpointy diagnostyczne:

```bash
curl -X POST http://localhost:3000/api/lpc/heartbeat-test
curl -X POST http://localhost:3000/api/lpc/force-refresh-status
curl http://localhost:3000/api/lpc/status
```

Status zawiera m.in. `lastDataReceivedAt`, `lastSuccessfulWriteAt`, `lastHeartbeatAt`, `staleConnectionDetectedAt`, `socketDestroyed`, `socketWritable`, `nextReconnectAt` i `reconnectAttemptCount`.

### Test utraty połączenia

1. Podłącz LPC i uruchom `npm run dev`.
2. Poczekaj aż UI pokaże `Połączony` albo sprawdź `curl http://localhost:3000/api/lpc/status`.
3. Odłącz kabel sieciowy od LPC.
4. Aplikacja powinna przejść w `error`, `disconnected` albo `reconnecting`; przy zaplanowanej próbie zobaczysz `nextReconnectAt`.
5. Jeśli system operacyjny jeszcze nie wykrył zerwania, użyj diagnostyki w UI lub:
   ```bash
   curl -X POST http://localhost:3000/api/lpc/heartbeat-test
   curl -X POST http://localhost:3000/api/lpc/force-refresh-status
   ```
6. Po ponownym podłączeniu kabla backend próbuje połączyć się ponownie co `LPC_RECONNECT_DELAY_MS` (domyślnie 15 sekund).

### Pełny test realnego startu LPC

1. Sprawdź konfigurację: `GET /api/programs/config`.
2. Ustaw `PROGRAM_START_MODE=script`, `PROGRAM_START_COMMAND` i `PROGRAM_START_SCRIPT_PATH`.
3. Zrestartuj backend.
4. Przetestuj `POST /api/programs/start` dla programu `1`.
5. Dopiero po sukcesie wykonaj skan lub `POST /api/scan` z barcode `5901234123457`.
6. Oczekiwane: UI pokazuje `P01`, `Program P01 wysłany do LPC`, stream LPC aktualizuje live dane i wykres, a po końcowym wyniku tabela pokazuje ACCEPT/REJECT oraz pomiary.
