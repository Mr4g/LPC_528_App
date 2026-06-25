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

## Ekran operatorski IPC

Frontend jest przebudowany jako pełnoekranowy panel operatorski pod ekran 16:9 / IPC. Główna praca operatora odbywa się na jednym widoku:

- górny pasek pokazuje status LPC, aktualny program, ostatni barcode i ostatni wynik OK/NOK/ERROR,
- lewa kolumna służy wyłącznie do skanowania i pokazuje krótki status startu programu,
- środkowa kolumna pokazuje live test, duże kafelki z aktualnymi wartościami oraz duży wykres ciśnienia,
- prawa kolumna pokazuje czytelny ostatni wynik oraz historię maksymalnie 10 wyników.

Na głównym ekranie nie są pokazywane techniczne szczegóły takie jak `stdout`, `stderr`, `command`, `scriptPath`, `args` ani raw line z LPC. Te dane są dostępne wyłącznie w diagnostyce.

### Diagnostyka UI

Diagnostyka jest domyślnie ukryta. Aby pokazać przycisk `Diagnostyka`, ustaw:

```env
VITE_SHOW_DIAGNOSTICS=true
```

Panel diagnostyczny otwiera modal, dzięki czemu nie rozciąga głównego layoutu operatora. W diagnostyce są dostępne: test portu LPC, heartbeat, force refresh status, mock line, connect/disconnect diagnostyczne oraz pełny wynik `ProgramStarter` wraz ze `stdout` i `stderr`.

Operator w normalnej pracy nie używa przycisków `connect` / `disconnect`; połączenie LPC działa automatycznie przez backend i reconnect.

## Debugowanie przepływu danych LPC

Jeśli program startuje na LPC, ale UI nie pokazuje wykresu albo końcowego wyniku, sprawdzaj pipeline w tej kolejności:

1. **Czy test został uruchomiony przez ProgramStarter** — odpowiedź `/api/scan` albo `/api/programs/start` musi mieć `programStart.success=true`.
2. **Czy backend odbiera surowe linie z LPC**:
   ```bash
   curl http://localhost:3000/api/lpc/raw-lines
   ```
   Każda linia ma diagnostykę `receivedAt`, `raw`, `normalized`, `parsedAs`, a dla ignorowanych linii także `reason`.
3. **Czy parser rozpoznaje stream/result i czy emitowane są eventy**:
   ```bash
   curl http://localhost:3000/api/lpc/pipeline-status
   ```
   Sprawdź `lastRawLineAt`, `lastStreamAt`, `lastResultAt`, `streamCount`, `resultCount`, `curvePointCount`, `resultHistoryCount` i `socketClientsCount`.
4. **Czy historia wyników ma dane**:
   ```bash
   curl http://localhost:3000/api/lpc/results
   curl http://localhost:3000/api/lpc/last-result
   curl http://localhost:3000/api/lpc/curve
   ```
5. **Czy UI dostaje Socket.IO eventy** — ustaw `VITE_SHOW_DIAGNOSTICS=true`, otwórz modal `Diagnostyka` i sprawdź liczniki `streamEvents`, `resultEvents`, `resultsUpdatedEvents`, `curveUpdatedEvents` i `curveCompletedEvents`.
6. **Test bez realnego LPC** — zasymuluj kompletny test przez ten sam `LpcLineProcessor`:
   ```bash
   curl -X POST http://localhost:3000/api/lpc/mock-test \
     -H "Content-Type: application/json" \
     -d '{"barcode":"5901234123457","programText":"P01"}'
   ```

Dodatkowe logowanie backendowego pipeline można włączyć przez:

```env
LPC_DEBUG_PIPELINE=true
```

Wtedy backend loguje `RAW LPC LINE`, `PARSED STREAM`, `PARSED RESULT`, `IGNORED LINE reason` i `SOCKET EMIT event name`.


Jeżeli `/api/lpc/raw-lines` pokazuje odebrane ramki, ale wykres w przeglądarce nadal stoi, frontend odświeża awaryjnie `/api/lpc/curve`, `/api/lpc/last-result` i `/api/lpc/results` co 1 sekundę. Dzięki temu można rozróżnić problem Socket.IO od problemu parsera/TCP: jeśli endpointy mają dane, ale liczniki eventów w diagnostyce nie rosną, problem jest w kanale Socket.IO; jeśli endpointy też są puste, problem jest po stronie odbioru TCP lub parsera.

Niektóre urządzenia LPC/Telnet potrafią wysłać kompletną ramkę stream/result bez końcowego `\n`. Klient TCP buforuje takie dane i po krótkim czasie flushuje kompletną ramkę do tego samego pipeline, żeby wykres i tabela wyników nie czekały w nieskończoność na znak nowej linii.

## Logowanie i użytkownicy

Aplikacja wymaga zalogowania operatora przed wejściem do panelu testów i przed wywołaniem `/api/scan` lub diagnostycznego `/api/programs/start`.

### Pierwszy start

Przy starcie backend tworzy domyślnego administratora tylko wtedy, gdy tabela `users` jest pusta. Dane startowe pochodzą z `.env`:

```env
AUTH_SESSION_SECRET=change-me
DEFAULT_ADMIN_LOGIN=ADM
DEFAULT_ADMIN_PASSWORD=admin123
SQLITE_DB_PATH=data/lpc_app.sqlite
```

Domyślny login to `ADM`, a domyślne hasło to `admin123`. Po wdrożeniu trzeba zmienić hasło administratora i ustawić własny `AUTH_SESSION_SECRET`.

### Format loginu operatora

Login jest normalizowany do uppercase i musi mieć 3–5 znaków ASCII A-Z:

- poprawne: `ABC`, `KOW`, `NOWA`, `TEST`,
- błędne: `AB`, `ABCDEF`, `A12`, `KO-W`, `ŁUK`, `JAN1`, `A B`.

### Role

- `operator` — panel operatora, skanowanie barcode, start testu i podgląd wyników,
- `line_leader` — uprawnienia operatora oraz zarządzanie operatorami i diagnostyka,
- `admin` — pełny dostęp, zmiana ról i zarządzanie wszystkimi użytkownikami.

### Dodawanie operatora

1. Zaloguj się jako `ADM` na `/login`.
2. Wejdź w `/admin/users` albo kliknij `Użytkownicy` w top barze.
3. Dodaj użytkownika z loginem 3–5 liter A-Z, hasłem tymczasowym i rolą `operator`.
4. `line_leader` może tworzyć tylko operatorów; `admin` może tworzyć także `line_leader` i `admin`.

### Operator przy teście i wyniku

Po skanie backend zapisuje `operatorLogin` i `operatorRole` w `currentTest`. Końcowy wynik LPC dziedziczy operatora z `currentTest`, a tabela wyników pokazuje kolumnę `Operator`. Można to sprawdzić:

```bash
curl http://localhost:3000/api/lpc/results
```

### Endpointy wymagające logowania

- `POST /api/scan`,
- `GET /api/current-test`,
- `GET /api/programs/config`,
- `POST /api/programs/start`,
- wszystkie endpointy `/api/users/*` dodatkowo wymagają roli `line_leader` albo `admin`.

### Gdy logowanie ADM/admin123 nie działa

1. Upewnij się, że `.env` zawiera `DEFAULT_ADMIN_LOGIN=ADM`, `DEFAULT_ADMIN_PASSWORD=admin123` i `SQLITE_DB_PATH=data/lpc_app.sqlite`.
2. Zrestartuj backend — jeśli baza nie ma żadnego admina, aplikacja naprawi/utworzy domyślnego admina.
3. Jeśli baza zawiera starego admina ze zmienionym hasłem, usuń plik `data/lpc_app.sqlite` tylko w środowisku developerskim i uruchom backend ponownie, żeby odtworzyć domyślnego admina.

### Backend nie startuje i Vite pokazuje ECONNREFUSED dla `/api/auth/login`

`ECONNREFUSED` w logu Vite oznacza, że frontend działa, ale backend na `http://localhost:3000` nie odpowiada. Najczęstsza przyczyna po dodaniu logowania to stary/uszkodzony plik bazy użytkowników albo niedziałający backend.

Sprawdź w osobnym terminalu:

```bash
npm run dev:backend
curl http://localhost:3000/health
curl http://localhost:3000/api/auth/me
```

Aktualny moduł użytkowników zapisuje konta w lokalnej bazie SQLite pod ścieżką `SQLITE_DB_PATH` i korzysta z biblioteki `better-sqlite3`, dzięki czemu backend działa na Node.js 20.x. Jeśli baza nie zawiera żadnego aktywnego admina, backend utworzy albo naprawi domyślnego admina z wartości `DEFAULT_ADMIN_LOGIN` / `DEFAULT_ADMIN_PASSWORD`.

## UI operatora: menu i wykres wyniku

- Akcje użytkownika zostały przeniesione do kompaktowego menu operatora w prawym obszarze top bara. Główny ekran operatora nie pokazuje już dużych przycisków `Użytkownicy` ani `Wyloguj` jako głównych akcji.
- Menu operatora pokazuje skrót zalogowanego użytkownika i rolę. Po rozwinięciu dostępne są tylko akcje zgodne z uprawnieniami: `Użytkownicy` dla `admin` / `line_leader`, `Diagnostyka` zgodnie z flagą diagnostyczną oraz `Wyloguj` dla każdego zalogowanego użytkownika.
- Wykres ciśnienia ma oś X `Czas [s]`, oś Y `Ciśnienie [mbar]`, ticki/skale osi oraz legendę. Po odebraniu końcowego wyniku testu ostatni punkt krzywej jest oznaczany markerem i etykietą z wynikiem `OK` / `NOK` / `ERROR` oraz głównym pomiarem, np. `RL 10.79 pa/s`.
- Panel `Ostatni wynik` pokazuje najpierw duży status operatorski i główny pomiar, a dopiero niżej barcode, program, identyfikator oraz szczegóły pomiarów.

## Ergonomia skanowania

- Pole `Barcode` na ekranie operatora ma autofocus po wejściu na panel operatora.
- Po każdym skanie — zarówno poprawnym, jak i odrzuconym — fokus wraca do pola barcode, więc operator może skanować kolejną sztukę bez klikania w ekran.
- Po odebraniu końcowego wyniku LPC (`lpc:result` / `test:completed`) aplikacja ponownie ustawia fokus na polu barcode z krótkim opóźnieniem po renderze.
- Naciśnięcie `Enter` w polu barcode wysyła skan, co obsługuje typowy skaner HID kończący odczyt Enterem.
- Menu operatora znajduje się w prawym górnym rogu, jest pozycjonowane względem karty operatora i nie powinno przykrywać kafla `Wynik` / `NOK`.

## Carrier branding i układ wyników

- Logo Carrier jest ładowane z lokalnego pliku `src/frontend/assets/carrier-logo.svg` i wyświetlane w lewym obszarze top bara obok tytułu `LPC-528 Panel operatorski`.
- UI używa jaśniejszego, korporacyjnego stylu Carrier: jasne tło, białe karty, granatowe nagłówki, jasnoniebieskie obramowania i statusowe kolory OK/NOK/ERROR.
- Placeholder pola skanowania jest mniejszy i czytelny; placeholdery logowania to `Login` oraz `Hasło`.
- Tabela `Wyniki testów` jest przeniesiona do pełnej szerokości pod głównymi panelami. Mniej krytyczne kolumny mogą ukrywać się na średnich ekranach, a poziomy scroll zostaje tylko jako awaryjne zachowanie dla małych ekranów.
- Po zaakceptowaniu nowego skanu wykres live test resetuje aktualne punkty oraz marker końcowy wyniku, ale historia wyników i panel ostatniego zakończonego wyniku zostają widoczne.

## Light/Dark theme

Panel operatorski ma dwa motywy: jasny `Light` oraz ciemny `Dark`. Przełącznik znajduje się w menu operatora w prawym górnym rogu. Wybrany motyw jest zapisywany w `localStorage`, więc po odświeżeniu przeglądarki panel wraca do ostatniego wyboru.

## Role i uprawnienia

- `operator` ma dostęp do panelu operatorskiego, skanowania, uruchamiania testu i okna `Wyniki testów`.
- `line_leader` ma dostęp do funkcji operatora, zarządzania operatorami oraz modułu `Programy` do mapowania barcode na program LPC. Nie może tworzyć liderów ani adminów.
- `admin` ma dostęp do panelu, wyników, użytkowników, programu mapowań oraz diagnostyki. Z poziomu UI/API zarządzania użytkownikami tworzy i obsługuje operatorów oraz line leaderów.

## Wyniki testów

Tabela historii nie zajmuje już dolnego pasa głównego panelu. Jest dostępna z menu operatora przez przycisk `Wyniki testów` i otwiera się w szerokim modalu z przewijaniem wewnątrz okna. Historia wyników nie jest czyszczona po nowym skanie; resetowany jest tylko wykres bieżącego testu i jego finalny marker OK/NOK/ERROR.

## Programy / mapowanie barcode

Moduł `Programy` jest dostępny dla ról `line_leader` i `admin`. Pozwala dodawać oraz edytować aktywne mapowania `barcodePattern -> programNumber` z typem dopasowania `exact` albo `contains`. Backend używa aktywnych rekordów przy każdym skanie, więc zmiany działają bez restartu aplikacji. Jeżeli lista mapowań w lokalnej bazie jest pusta, aplikacja nadal korzysta z fallbacku `BARCODE_PROGRAM_MAP` z `.env`.

## Poprawki regresji UI: wykres, top bar i menu

- Reset wykresu po nowym skanie czyści punkty oraz marker końcowy starego testu, ale pierwsze nowe dane z `lpc:stream`, `lpc:curve-updated`, `lpc:curve-completed` albo pollingu `/api/lpc/curve` ponownie odblokowują rysowanie krzywej.
- Diagnostyka frontendowa pokazuje liczniki zdarzeń oraz stan wykresu: liczbę punktów, `ignoreCompletedCurveUntilNewStream`, status wykresu i finalny wynik markera.
- Legenda wykresu jest renderowana pod SVG jako osobny element HTML, więc nie nachodzi na opis osi X `Czas [s]`.
- Menu operatora zamyka się po kliknięciu poza menu oraz po naciśnięciu `Escape`; po zamknięciu fokus wraca do pola barcode, jeśli operator jest na panelu i nie ma otwartego modala.
- Przycisk `Wyniki testów` jest dostępny bezpośrednio w prawym panelu pod kartą ostatniego wyniku i otwiera modal historii pomiarów.

### Drobne poprawki UI/UX panelu operatora

- Tytuł `Panel operatorski` w top barze jest mniejszy i mieści się obok lokalnego logo Carrier bez nachodzenia na kafel programu.
- Status skanowania (`Gotowy do skanu`, `P01 wybrany` itd.) jest pokazany bezpośrednio pod nagłówkiem `SKANOWANIE`, mniejszą czcionką niż główne akcje operatora.
- Wykres ciśnienia nadal resetuje stary marker po nowym skanie, ale po finalnym wyniku rysuje etykietę przy ostatnim punkcie krzywej, np. `NOK` oraz `RL 10.79 pa/s`.
- Prawy panel ma sekcję `Wyniki testów`: widoczny przycisk otwiera pełny modal historii, a pod nim jest kompaktowy podgląd maksymalnie 4 ostatnich wyników.
- Po zamknięciu pełnego modala wyników focus wraca do pola barcode, żeby operator mógł skanować kolejną sztukę bez klikania w ekran.

### Stabilizacja końcowego markera i układu paneli

- Końcowa etykieta wyniku na wykresie jest utrzymywana w stanie frontendu do następnego zaakceptowanego skanu; polling krzywej ani odświeżenie statusu LPC jej nie czyści.
- `resetChartForNewTest()` nadal czyści bieżące punkty, zakończoną krzywą i finalny marker dopiero przy rozpoczęciu kolejnego testu.
- Mała tabela wyników w prawym panelu pokazuje maksymalnie 4 ostatnie wyniki, ma własny poziomy scroll oraz podpowiedź dla operatora, że można przesunąć tabelę w bok.
- Trzy główne panele operatora są wyrównywane przez CSS Grid do tej samej wysokości na szerokim ekranie; na małych ekranach mogą układać się jeden pod drugim.


## Pierwsze logowanie / pusta baza

Przy starcie backend tworzy tabelę `users`, sprawdza liczbę użytkowników i aktywnych adminów, a następnie automatycznie tworzy domyślnego admina z `.env`, jeśli baza jest pusta albo nie ma aktywnego admina. Login jest normalizowany do uppercase, a hasło nie jest wypisywane w logach.

Dla pierwszego uruchomienia lub naprawy developerskiej ustaw w `.env`:

```env
DEFAULT_ADMIN_LOGIN=ADM
DEFAULT_ADMIN_PASSWORD=admin123
AUTH_RESET_DEFAULT_ADMIN=true
```

Następnie uruchom aplikację i zaloguj się:

```bash
npm run dev
```

- Login: `ADM`
- Hasło: `admin123`

Po udanym logowaniu ustaw `AUTH_RESET_DEFAULT_ADMIN=false` i zrestartuj aplikację, żeby nie resetować hasła admina przy kolejnych startach. Mechanizm `AUTH_RESET_DEFAULT_ADMIN=true` działa tylko poza `production`.

Diagnostyka developerska bez `passwordHash`:

```bash
curl http://localhost:3000/api/auth/debug
```

Endpoint zwraca m.in. `dbPath`, `dbExists`, `usersTableExists`, `usersCount`, `activeUsersCount`, `adminUsersCount`, `activeAdminUsersCount`, bezpieczną listę użytkowników bez `passwordHash`, `defaultAdminLogin`, nazwę cookie i ustawienia `sameSite` / `secure`. Jeśli logowanie nie działa, najpierw sprawdź właśnie `/api/auth/debug`.

## SQLite database

Aplikacja używa lokalnej bazy SQLite wskazanej przez `SQLITE_DB_PATH` (domyślnie `data/lpc_app.sqlite`) przez `better-sqlite3` zamiast `node:sqlite`, więc backend jest zgodny z Node.js 20.x. Przy starcie wykonywany jest prosty init `CREATE TABLE IF NOT EXISTS` dla tabel:

- `users` — konta operatorów, line leaderów i adminów, razem z hashem hasła oraz statusem aktywności.
- `test_results` — finalne wyniki LPC wraz z barcode, programem, operatorem, wartościami RL/Pt/EDC/PL/LLR/HLR/FPR i surową ramką.
- `program_mappings` — trwałe mapowania `barcodePattern -> programNumber/programText` z trybem `exact` albo `contains`.
- `test_sessions` — stan aktywnego testu i blokady skanowania.

## Blokada testu

Po zaakceptowanym skanie backend tworzy aktywną sesję testu i blokuje kolejne skany, dopóki test jest w stanie `starting`, `running` albo `waiting_for_result`. Próba skanu w trakcie testu zwraca `TEST_IN_PROGRESS`, a frontend blokuje input barcode oraz pokazuje komunikat `Test w toku — poczekaj na wynik`.

Timeout aktywnego testu konfiguruje `ACTIVE_TEST_TIMEOUT_MS` (domyślnie `60000`). Jeśli w tym czasie nie przyjdzie finalny wynik, sesja przechodzi w `timeout` i skanowanie zostaje odblokowane. `ACTIVE_TEST_NO_DATA_WARNING_MS` pokazuje ostrzeżenie `Brak danych z LPC`, jeśli po starcie testu nie przychodzi streaming. Line leader albo admin może użyć diagnostycznego `POST /api/test-session/unlock`, żeby ręcznie odblokować test.

## Program mappings w DB

`BARCODE_PROGRAM_MAP` z `.env` jest używany jako seed startowy tylko wtedy, gdy tabela `program_mappings` jest pusta. Po seedzie aplikacja mapuje barcode przez aktywne rekordy z DB, bez restartu po zmianach w UI `Programy`. Dopasowanie wybiera najpierw `exact`, potem `contains`, następnie dłuższy pattern i nowszy `updatedAt`.

Mapowania mogą edytować tylko role `line_leader` i `admin`; operator nie widzi ekranu `Programy` i nie ma dostępu do API mapowań.

## Test results persistence

Każdy finalny `lpc:result` jest zapisywany do tabeli `test_results`. Endpoint `GET /api/lpc/results` oraz pełniejszy `GET /api/test-results` czytają dane z DB, więc historia wyników i ostatni wynik są dostępne po restarcie IPC.
