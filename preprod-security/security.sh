#!/bin/bash
# Lokalni PRE-PROD samo za Robotik Security, macOS verzija security.ps1 (iste komande, portovi i Node skripte).
#
# Upotreba:
#   bash <putanja>/preprod-security/security.sh <komanda> [arg]
#
# Komande:
#   start      baza (27118), Mailpit (8026/1026), backend (5300), web (3300), emulator robotik_sec, Metro (8082)
#              "start web" = bez emulatora i Metro-a
#              "start e2e" = instanca za automatske testove: Mailpit 8027/1027, backend 5301 (baza
#              robotik_preprod_security_e2e), web 3301. Testovi brišu podatke i pomeraju sat, pa nikad ne rade na 3300/5300.
#   stop       gasi samo ono što je pokrenula ova skripta ("stop e2e" = samo instancu za testove)
#   restart    samo backend posle izmene koda: oba, "restart main" standardni (5300), "restart e2e" za testove (5301)
#   status     šta radi i linkovi
#   seed       briše Security pre-prod bazu i upisuje test podatke ("seed e2e" = baza instance za testove)
#   demo       živa situacija za stranicu Uživo za trenutnu smenu + simulacija radnika u pozadini
#   env        napravi env/backend.env iz env/backend.env.example (lokalni ključevi, bez produkcionih vrednosti)
#   export     izvezi Security pre-prod bazu u dummy-data/ (EJSON, jedna datoteka po kolekciji)
#   import     obriši Security pre-prod bazu i uvezi dummy-data/ (baza mora da radi: posle "start web")
#   build      Android debug APK (expo prebuild ako nema android/, arm64) i instalacija na emulator ili telefon
#   test       NFC unit testovi (Jest) + E2E (Maestro na emulatoru preko Playwright-a, web); "test unit",
#              "test android", "test web" ili "test sistem" za jedan deo. E2E uvek ide na instancu za testove.
#              Ostali argumenti idu Playwright-u: test sistem -g "tolerancija tačke: 4:59"
#
# Programi (podrazumevane putanje na Mac-u, druga putanja preko istoimene env promenljive):
#   MONGOD    PATH ili ~/.local/opt/mongodb/bin/mongod      MAILPIT  PATH ili ~/.local/opt/mailpit/mailpit
#   JAVA_HOME ~/.local/opt/jdk-17/Contents/Home             ANDROID_HOME ~/Library/Android/sdk
#   MAESTRO_BIN ~/.maestro/bin/maestro
# Pravi telefon sa NFC-om umesto emulatora (USB debugging): SECURITY_DEVICE=<serijski broj iz adb devices>
# pa "build" (APK na telefon) i "start" (adb reverse na telefon, emulator se ne pali).

CMD="${1:-status}"
ARG="${2:-}"

# Koren projekta je folder u kom su .wt/robotikb, .wt/robotikf i .wt/robotikm.
# preprod-security može biti u korenu (<koren>/preprod-security) ili u repou (<koren>/.wt/robotikb/preprod-security).
PRE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$PRE")"
[ -d "$ROOT/.wt/robotikb" ] || ROOT="$(cd "$ROOT/../.." && pwd)"
WT="$ROOT/.wt"
LOGS="$PRE/logs"
mkdir -p "$LOGS" "$PRE/data/db"

find_bin() { # $1 ime, $2 rezervna putanja
  if command -v "$1" >/dev/null 2>&1; then command -v "$1"; else echo "$2"; fi
}
MONGOD="${MONGOD:-$(find_bin mongod "$HOME/.local/opt/mongodb/bin/mongod")}"
MAILPIT="${MAILPIT:-$(find_bin mailpit "$HOME/.local/opt/mailpit/mailpit")}"
export JAVA_HOME="${JAVA_HOME:-$HOME/.local/opt/jdk-17/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export MAESTRO_BIN="${MAESTRO_BIN:-$HOME/.maestro/bin/maestro}"
export MAESTRO_CLI_NO_ANALYTICS=1
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$(dirname "$MAESTRO_BIN"):$PATH"
ADB="$ANDROID_HOME/platform-tools/adb"
AVD=robotik_sec

# Naš emulator se bira po imenu AVD-a (robotik_sec), nikad po redosledu
find_our_serial() {
  [ -x "$ADB" ] || return 0
  local s name
  for s in $("$ADB" devices 2>/dev/null | awk '/^emulator-[0-9]+[[:space:]]+device/{print $1}'); do
    name="$("$ADB" -s "$s" emu avd name 2>/dev/null | head -1 | tr -d '\r')"
    [ "$name" = "$AVD" ] && { echo "$s"; return 0; }
  done
}
PHONE=''
SERIAL="$(find_our_serial)"
[ -n "$SERIAL" ] || SERIAL='emulator-5556'
if [ -n "${SECURITY_DEVICE:-}" ]; then PHONE=1; SERIAL="$SECURITY_DEVICE"; fi
adb_our() { "$ADB" -s "$SERIAL" "$@" 2>/dev/null; }

# Servisi: port, link i šablon komandne linije (samo takav proces sme da se ugasi)
SERVICES='mongo mailpit backend web metro mailpit-e2e backend-e2e web-e2e'
port_of() {
  case "$1" in
    mongo) echo 27118;; mailpit) echo 8026;; backend) echo 5300;; web) echo 3300;; metro) echo 8082;;
    mailpit-e2e) echo 8027;; backend-e2e) echo 5301;; web-e2e) echo 3301;;
  esac
}
url_of() {
  case "$1" in
    mongo) echo 'mongodb://127.0.0.1:27118/robotik_preprod_security';; mailpit) echo 'http://localhost:8026';;
    backend) echo 'http://localhost:5300';; web) echo 'http://localhost:3300/security';; metro) echo 'http://localhost:8082';;
    mailpit-e2e) echo 'http://localhost:8027';; backend-e2e) echo 'http://localhost:5301 (baza robotik_preprod_security_e2e)';;
    web-e2e) echo 'http://localhost:3301/security';;
  esac
}
expect_of() {
  case "$1" in
    mongo) echo 'mongod.*--port 27118';;
    mailpit) echo 'mailpit.*127\.0\.0\.1:8026';;
    mailpit-e2e) echo 'mailpit.*127\.0\.0\.1:8027';;
    backend|backend-e2e) echo 'preprod-security/scripts/start-backend\.js';;
    web|web-e2e) echo '\.wt/robotikf/node_modules/react-scripts/';;
    metro) echo '\.wt/robotikm/node_modules/expo/bin/cli';;
    sim) echo 'preprod-security/scripts/demo\.js.*--only-simulate';;
  esac
}

listen_pid() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1; }
cmdline() { ps -o command= -p "$1" 2>/dev/null; }
wait_port() { # $1 port, $2 sekundi
  local i=0
  while [ $i -lt "$2" ]; do [ -n "$(listen_pid "$1")" ] && return 0; sleep 1; i=$((i + 1)); done
  return 1
}
# Gasi PID i njegove potomke (kao taskkill /T), ali samo ako komandna linija odgovara šablonu
kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null
}
stop_verified() { # $1 ime, $2 pid; 0 = ugašen, 1 = ne radi, 2 = tuđi proces
  local line; line="$(cmdline "$2")"
  [ -z "$line" ] && return 1
  if echo "$line" | grep -Eq "$(expect_of "$1")"; then
    kill_tree "$2"
    local i=0; while [ $i -lt 15 ] && kill -0 "$2" 2>/dev/null; do sleep 1; i=$((i + 1)); done
    kill -0 "$2" 2>/dev/null && kill -9 "$2" 2>/dev/null
    echo "  ugašen $1 ($2)"
    return 0
  fi
  echo "  PID $2 ($1) sada pripada drugom procesu, ne diram ga"
  return 2
}
# Gasi naš proces koji drži port servisa (posle provere komandne linije)
stop_port() { # $1 ime
  local pid; pid="$(listen_pid "$(port_of "$1")")"
  [ -z "$pid" ] && return 1
  if cmdline "$pid" | grep -Eq "$(expect_of "$1")"; then stop_verified "$1" "$pid"
  else echo "  port $(port_of "$1") drži tuđi proces ($pid), ne diram ga"; return 2; fi
}

start_bg() { # $1 ime, $2 radni folder, ostalo = komanda
  local name="$1" dir="$2"; shift 2
  local port; port="$(port_of "$name")"
  if [ -n "$port" ] && [ -n "$(listen_pid "$port")" ]; then echo "  $name već radi (port $port)"; return 0; fi
  (cd "$dir" || exit 1; nohup "$@" >"$LOGS/$name.log" 2>"$LOGS/$name.err.log" </dev/null & echo $! >"$LOGS/$name.pid")
  if [ -n "$port" ]; then
    if wait_port "$port" 180; then echo "  $name radi -> $(url_of "$name")"
    else echo "  $name NIJE podignut, pogledaj $LOGS/$name.log i $LOGS/$name.err.log"; return 1; fi
  else
    echo "  $name pokrenut (pid $(cat "$LOGS/$name.pid"))"
  fi
}

need() { [ -x "$1" ] || { echo "  nema $2 ($1)"; exit 1; }; }

start_mongo() {
  need "$MONGOD" mongod
  start_bg mongo "$PRE" "$MONGOD" --port 27118 --bind_ip 127.0.0.1 --dbpath "$PRE/data/db"
}
start_backend() { # $1 main | e2e
  if [ "$1" = e2e ]; then start_bg backend-e2e "$ROOT" env SECURITY_INSTANCE=e2e node "$PRE/scripts/start-backend.js"
  else start_bg backend "$ROOT" node "$PRE/scripts/start-backend.js"; fi
}
start_web() { # $1 ime, $2 port weba, $3 port backenda; isto što i "npm start", sa putanjom worktree-a u komandnoj liniji
  start_bg "$1" "$WT/robotikf" env PORT="$2" BROWSER=none REACT_APP_API_URL="http://localhost:$3" \
    node "$WT/robotikf/node_modules/react-scripts/bin/react-scripts.js" start
}
# Instanca za automatske testove: testovi brišu podatke i pomeraju sat, pa ne rade na 3300/5300 (tu radi čovek)
start_e2e() {
  need "$MAILPIT" mailpit
  start_bg mailpit-e2e "$PRE" "$MAILPIT" --listen 127.0.0.1:8027 --smtp 127.0.0.1:1027 --database "$PRE/data/mailpit-e2e.db"
  start_backend e2e
  start_web web-e2e 3301 5301
  SECURITY_INSTANCE=e2e node "$PRE/scripts/seed.js" --if-empty
}

start_emulator() {
  local s; s="$(find_our_serial)"
  if [ -n "$s" ]; then SERIAL="$s"; echo "  emulator $AVD već radi ($s)"; return 0; fi
  need "$ANDROID_HOME/emulator/emulator" emulator
  # Port 5556 ako je slobodan, inače 5558 (serial = emulator-<port>)
  local port=5556
  "$ADB" devices 2>/dev/null | grep -q 'emulator-5556' && port=5558
  SERIAL="emulator-$port"
  (nohup "$ANDROID_HOME/emulator/emulator" -avd "$AVD" -port "$port" -timezone Europe/Belgrade -no-boot-anim -no-snapshot-save -gpu host \
    >"$LOGS/emulator.log" 2>"$LOGS/emulator.err.log" </dev/null & echo $! >"$LOGS/emulator.pid")
  local i=0 b
  while [ $i -lt 150 ]; do
    b="$(adb_our shell getprop sys.boot_completed | tr -d '\r')"
    [ "$b" = 1 ] && { echo "  emulator $SERIAL spreman"; return 0; }
    sleep 2; i=$((i + 1))
  done
  echo "  emulator se nije podigao na vreme (logs/emulator.log)"
  return 1
}

set_adb_reverse() {
  # Aplikacija je napravljena sa Metro portom 8082; backend i web telefon vidi kao localhost
  local p
  for p in 8082 5300 3300; do adb_our reverse "tcp:$p" "tcp:$p" >/dev/null; done
  echo "  adb reverse ($SERIAL): 8082 Metro, 5300 backend, 3300 web"
  adb_our shell settings put secure stylus_handwriting_enabled 0 >/dev/null
  # Animacije uključene za pregled; E2E ih isključuje sam (e2e/global-setup.js) i vraća posle testova
  if [ -z "$PHONE" ]; then
    for p in window_animation_scale transition_animation_scale animator_duration_scale; do adb_our shell settings put global "$p" 1 >/dev/null; done
  fi
}

start_metro() {
  start_bg metro "$WT/robotikm" env EXPO_PUBLIC_API_URL=http://localhost:5300 EXPO_PUBLIC_NFC_SIMULATION=1 \
    node "$WT/robotikm/node_modules/expo/bin/cli" start --port 8082
}

case "$CMD" in
  start)
    need "$MAILPIT" mailpit
    [ -f "$PRE/env/backend.env" ] || { echo "  nema env/backend.env, prvo: security.sh env"; exit 1; }
    if [ "$ARG" = e2e ]; then
      echo 'Pokrećem Security pre-prod, instancu za testove...'
      start_mongo
      start_e2e
      echo
      echo 'Gotovo. Testovi: backend http://localhost:5301, web http://localhost:3301/security, mejlovi http://localhost:8027'
      exit 0
    fi
    echo 'Pokrećem Security pre-prod...'
    start_mongo
    start_bg mailpit "$PRE" "$MAILPIT" --listen 127.0.0.1:8026 --smtp 127.0.0.1:1026 --database "$PRE/data/mailpit.db"
    start_backend main
    start_web web 3300 5300
    if [ "$ARG" != web ]; then
      if [ -n "$PHONE" ]; then echo "  telefon $SERIAL (SECURITY_DEVICE), emulator se ne pali"; else start_emulator; fi
      set_adb_reverse
      start_metro
    fi
    echo
    echo 'Gotovo. Web: http://localhost:3300/security | Mejlovi: http://localhost:8026'
    echo 'Nalozi (lozinka Preprod123!): E2E Admin, E2E Superadmin, koordinator E2E Koordinator, radnik E2E Cuvar'
    ;;
  stop)
    # "stop e2e" gasi samo instancu za testove (standardna i emulator ostaju)
    if [ "$ARG" = e2e ]; then names='web-e2e backend-e2e mailpit-e2e'; else names="sim metro web-e2e backend-e2e mailpit-e2e web backend mailpit mongo"; fi
    # PID iz logs/<ime>.pid se gasi samo ako komandna linija i dalje odgovara našem servisu
    for name in $names; do
      f="$LOGS/$name.pid"
      [ -f "$f" ] || continue
      pid="$(cat "$f")"
      stop_verified "$name" "$pid"
      rm -f "$f"
    done
    # Ručno pokrenuto na našim portovima: gasi se samo ako je to naš proces
    for name in $names; do [ "$name" = sim ] && continue; stop_port "$name"; done
    if [ "$ARG" != e2e ]; then
      s="$(find_our_serial)"
      if [ -n "$s" ]; then "$ADB" -s "$s" emu kill >/dev/null 2>&1; echo "  ugašen emulator $AVD ($s)"; fi
      rm -f "$LOGS/emulator.pid"
    fi
    ;;
  restart)
    # Ponovo pokreće samo backend posle izmene koda: "restart" oba, "restart main" standardni, "restart e2e" za testove
    case "$ARG" in e2e) names='backend-e2e';; main) names='backend';; *) names='backend backend-e2e';; esac
    for name in $names; do
      port="$(port_of "$name")"
      stop_port "$name"
      [ $? -eq 2 ] && continue
      i=0; while [ $i -lt 30 ] && [ -n "$(listen_pid "$port")" ]; do sleep 0.5; i=$((i + 1)); done
      rm -f "$LOGS/$name.pid"
      if [ "$name" = backend ]; then start_backend main; else start_backend e2e; fi
    done
    ;;
  status)
    for name in $SERVICES; do
      if [ -n "$(listen_pid "$(port_of "$name")")" ]; then state='RADI'; else state='ne radi'; fi
      printf '  %-12s %-8s %s\n' "$name" "$state" "$(url_of "$name")"
    done
    simpid="$(cat "$LOGS/sim.pid" 2>/dev/null)"
    if [ -n "$simpid" ] && cmdline "$simpid" | grep -Eq "$(expect_of sim)"; then state='RADI'; else state='ne radi'; fi
    printf '  %-12s %-8s %s\n' 'sim' "$state" "$LOGS/sim.log"
    s="$(find_our_serial)"
    if [ -n "$s" ]; then printf '  %-12s %-8s %s\n' emulator RADI "$s ($AVD)"; else printf '  %-12s %-8s %s\n' emulator 'ne radi' "$AVD"; fi
    ;;
  seed)
    # "seed e2e" = baza instance za testove (robotik_preprod_security_e2e)
    if [ "$ARG" = e2e ]; then SECURITY_INSTANCE=e2e node "$PRE/scripts/seed.js" --reset; else node "$PRE/scripts/seed.js" --reset; fi
    ;;
  env) node "$PRE/scripts/make-env.js" ;;
  export) node "$PRE/scripts/db-export.js" ;;
  import) node "$PRE/scripts/db-import.js" ;;
  demo)
    # Situacija za trenutnu smenu, pa simulacija radnika u pozadini (očitavanja na vreme, prijave, odjave)
    if [ -f "$LOGS/sim.pid" ]; then
      stop_verified sim "$(cat "$LOGS/sim.pid")" >/dev/null && echo '  stara simulacija ugašena'
      rm -f "$LOGS/sim.pid"
    fi
    node "$PRE/scripts/demo.js" || exit 1
    start_bg sim "$PRE" node "$PRE/scripts/demo.js" --only-simulate
    echo '  simulacija radnika radi u pozadini (logs/sim.log); gasi se sa: security.sh stop'
    ;;
  build)
    need "$JAVA_HOME/bin/java" 'JDK 17'
    cd "$WT/robotikm" || exit 1
    export EXPO_PUBLIC_API_URL=http://localhost:5300
    export EXPO_PUBLIC_NFC_SIMULATION=1
    # android/ nije na gitu (expo prebuild ga pravi iz app.json i plugin-a)
    if [ ! -d android ]; then npx expo prebuild --platform android --no-install || exit 1; fi
    cd android || exit 1
    # Port 8082 je upisan u aplikaciju: aplikacija tada učitava JS sa našeg Metro-a, ne sa tuđeg na 8081.
    # Na Apple Silicon-u je i emulator arm64, kao i pravi telefon.
    ./gradlew app:assembleDebug -PreactNativeArchitectures=arm64-v8a -PreactNativeDevServerPort=8082 || { echo 'Gradle build nije prošao'; exit 1; }
    "$ADB" -s "$SERIAL" install -r app/build/outputs/apk/debug/app-debug.apk || exit 1
    set_adb_reverse
    ;;
  test)
    export ANDROID_SERIAL="$SERIAL"
    # NFC sloj bez telefona i taga (lažna NFC biblioteka)
    if [ -z "$ARG" ] || [ "$ARG" = unit ]; then (cd "$WT/robotikm" && npx jest src/security) || rc=1; fi
    # Android (Maestro na emulatoru, poziva ga Playwright) i web, uvek na instanci za testove (5301/3301/8027)
    if [ "$ARG" != unit ]; then
      start_mongo
      start_e2e
      cd "$PRE/e2e" || exit 1
      [ -d node_modules ] || npm install --no-audit --no-fund
      npx playwright install chromium >/dev/null
      # ostali argumenti idu Playwright-u, npr.: security.sh test sistem -g "tolerancija tačke: 4:59"
      shift; [ -n "$ARG" ] && shift
      if [ -n "$ARG" ]; then npx playwright test "--project=$ARG" "$@" || rc=1; else npx playwright test "$@" || rc=1; fi
    fi
    exit "${rc:-0}"
    ;;
  *) echo "Nepoznata komanda: $CMD (start | stop | restart | status | seed | demo | env | export | import | build | test)" ;;
esac
