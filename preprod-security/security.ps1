<#
  Lokalni PRE-PROD samo za Robotik Security (worktree feature/security-module).
  Potpuno odvojen od preprod\ (druga sesija): svoja baza, Mailpit, portovi i emulator.

  Upotreba:
    powershell -ExecutionPolicy Bypass -File <putanja>\preprod-security\security.ps1 <komanda>

  Komande:
    start    baza (27118), Mailpit (8026/1026), backend (5300), web (3300), emulator robotik_sec (5556), Metro (8082)
             "start web" = samo baza, Mailpit, backend i web (bez emulatora i Metro-a)
    stop     gasi samo ono što je pokrenula ova skripta
    status   šta radi i linkovi
    seed     briše Security pre-prod bazu i upisuje test podatke
    demo     živa situacija za stranicu Uživo (alarmi, obilasci, zadaci, nepoznati tagovi) za trenutnu smenu
    env      napravi env\backend.env iz env\backend.env.example (lokalni ključevi, bez produkcionih vrednosti)
    export   izvezi Security pre-prod bazu u dummy-data\ (EJSON, jedna datoteka po kolekciji)
    import   obriši Security pre-prod bazu i uvezi dummy-data\ (baza mora da radi: posle "start web")
    build    Android debug APK iz worktree-a i instalacija na emulator-5556 (ili telefon iz SECURITY_DEVICE)
    test     NFC unit testovi (Jest) + E2E (Maestro na emulatoru preko Playwright-a, web); "test unit", "test android" ili "test web" za jedan deo

  Pravi telefon sa NFC-om umesto emulatora (USB debugging): $env:SECURITY_DEVICE = '<serijski broj iz adb devices>'
  pa "build" (arm64 APK na telefon) i "start" (adb reverse na telefon, emulator se ne pali).
#>
param(
  [Parameter(Position = 0)] [string] $Command = 'status',
  [Parameter(Position = 1)] [string] $Arg = ''
)

$ErrorActionPreference = 'Stop'
# Koren projekta je folder u kom su .wt\robotikb, .wt\robotikf i .wt\robotikm.
# preprod-security može biti u korenu (<koren>\preprod-security) ili u repou (<koren>\.wt\robotikb\preprod-security).
$Pre = $PSScriptRoot
$Root = Split-Path $Pre -Parent
if (-not (Test-Path (Join-Path $Root '.wt\robotikb'))) { $Root = Split-Path (Split-Path $Root -Parent) -Parent }
$Wt = Join-Path $Root '.wt'
$Logs = Join-Path $Pre 'logs'
$PidFile = Join-Path $Logs 'pids.json'
$Local = $env:LOCALAPPDATA
$Serial = 'emulator-5556'

$env:JAVA_HOME = Join-Path $Local 'Programs\Java\jdk-17'
$env:ANDROID_HOME = Join-Path $Local 'Android\Sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:MAESTRO_CLI_NO_ANALYTICS = '1'
$env:PATH = @(
  (Join-Path $env:JAVA_HOME 'bin'),
  (Join-Path $env:ANDROID_HOME 'platform-tools'),
  (Join-Path $env:ANDROID_HOME 'emulator'),
  (Join-Path $Local 'Programs\maestro\bin'),
  (Join-Path $Local 'Programs\mongodb\bin'),
  (Join-Path $Local 'Programs\mailpit'),
  $env:PATH
) -join ';'

$Adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
function AdbAny {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $Adb @args 2>$null } finally { $ErrorActionPreference = $prev }
}
# Naš emulator se bira po imenu AVD-a (robotik_sec), nikad po redosledu: druga sesija koristi robotik_e2e
function Find-OurSerial {
  $list = AdbAny devices | Select-String -Pattern '^(emulator-\d+)\s+device' | ForEach-Object { $_.Matches[0].Groups[1].Value }
  foreach ($s in $list) {
    $name = ((AdbAny -s $s emu avd name) | Select-Object -First 1)
    if ($name -and $name.Trim() -eq 'robotik_sec') { return $s }
  }
  return $null
}
$found = Find-OurSerial
if ($found) { $Serial = $found }
# Pravi telefon sa NFC-om (adb devices) umesto emulatora
$Phone = [bool]$env:SECURITY_DEVICE
if ($Phone) { $Serial = $env:SECURITY_DEVICE }
# Uvek samo naš emulator
function Adb {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $Adb -s $script:Serial @args 2>$null } finally { $ErrorActionPreference = $prev }
}

$Services = [ordered]@{
  mongo   = @{ Port = 27118; Url = 'mongodb://127.0.0.1:27118/robotik_preprod_security' }
  mailpit = @{ Port = 8026;  Url = 'http://localhost:8026' }
  backend = @{ Port = 5300;  Url = 'http://localhost:5300' }
  web     = @{ Port = 3300;  Url = 'http://localhost:3300/security' }
  metro   = @{ Port = 8082;  Url = 'http://localhost:8082' }
}

New-Item -ItemType Directory -Force -Path $Logs, (Join-Path $Pre 'data\db') | Out-Null

function Get-Pids { if (Test-Path $PidFile) { Get-Content $PidFile -Raw | ConvertFrom-Json } else { [pscustomobject]@{} } }
function Save-Pid($name, $procId) {
  $p = Get-Pids
  $p | Add-Member -NotePropertyName $name -NotePropertyValue $procId -Force
  $p | ConvertTo-Json | Set-Content -Path $PidFile -Encoding utf8
}
function Test-Port($port) { [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }
function Wait-Port($port, $seconds) {
  for ($i = 0; $i -lt $seconds; $i++) { if (Test-Port $port) { return $true }; Start-Sleep -Seconds 1 }
  return $false
}

function Start-Bg($name, $file, $argList, $workDir, $extraEnv = @{}) {
  $port = $Services[$name].Port
  if ($port -and (Test-Port $port)) { Write-Host "  $name već radi (port $port)"; return }
  foreach ($k in $extraEnv.Keys) { Set-Item -Path "env:$k" -Value $extraEnv[$k] }
  $out = Join-Path $Logs "$name.log"; $err = Join-Path $Logs "$name.err.log"
  $proc = Start-Process -FilePath $file -ArgumentList $argList -WorkingDirectory $workDir -WindowStyle Hidden `
    -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
  foreach ($k in $extraEnv.Keys) { Remove-Item -Path "env:$k" -ErrorAction SilentlyContinue }
  Save-Pid $name $proc.Id
  if ($port) {
    if (Wait-Port $port 180) { Write-Host "  $name radi -> $($Services[$name].Url)" }
    else { Write-Host "  $name NIJE podignut, pogledaj $out i $err" -ForegroundColor Red }
  } else { Write-Host "  $name pokrenut (pid $($proc.Id))" }
}

function Start-Emulator {
  $s = Find-OurSerial
  if ($s) { $script:Serial = $s; Write-Host "  emulator robotik_sec već radi ($s)"; return }
  # Port 5556 ako je slobodan, inače 5558 (serial = emulator-<port>)
  $port = if (AdbAny devices | Select-String 'emulator-5556') { '5558' } else { '5556' }
  $script:Serial = "emulator-$port"
  $emu = Join-Path $env:ANDROID_HOME 'emulator\emulator.exe'
  $proc = Start-Process -FilePath $emu -ArgumentList '-avd', 'robotik_sec', '-port', $port, '-timezone', 'Europe/Belgrade', '-no-boot-anim', '-no-snapshot-save', '-gpu', 'host' `
    -RedirectStandardOutput (Join-Path $Logs 'emulator.log') -RedirectStandardError (Join-Path $Logs 'emulator.err.log') -PassThru
  Save-Pid 'emulator' $proc.Id
  for ($i = 0; $i -lt 150; $i++) {
    $b = (Adb shell getprop sys.boot_completed) -join ''
    if ($b.Trim() -eq '1') { Write-Host "  emulator $Serial spreman"; return }
    Start-Sleep -Seconds 2
  }
  Write-Host "  emulator se nije podigao na vreme" -ForegroundColor Red
}

function Set-AdbReverse {
  # Aplikacija je napravljena sa Metro portom 8082; backend i web telefon vidi kao localhost
  foreach ($p in 8082, 5300, 3300) { Adb reverse "tcp:$p" "tcp:$p" | Out-Null }
  Write-Host "  adb reverse ($Serial): 8082 Metro, 5300 backend, 3300 web"
  Adb shell settings put secure stylus_handwriting_enabled 0 | Out-Null
  # Animacije uključene za pregled; E2E ih isključuje sam (e2e\global-setup.js) i vraća posle testova
  if (-not $Phone) { foreach ($s in 'window_animation_scale', 'transition_animation_scale', 'animator_duration_scale') { Adb shell settings put global $s 1 | Out-Null } }
}

switch ($Command) {
  'start' {
    Write-Host 'Pokrećem Security pre-prod...'
    Start-Bg 'mongo' (Join-Path $Local 'Programs\mongodb\bin\mongod.exe') @('--port', '27118', '--bind_ip', '127.0.0.1', '--dbpath', "`"$Pre\data\db`"") $Pre
    Start-Bg 'mailpit' (Join-Path $Local 'Programs\mailpit\mailpit.exe') @('--listen', '127.0.0.1:8026', '--smtp', '127.0.0.1:1026', '--database', "`"$Pre\data\mailpit.db`"") $Pre
    Start-Bg 'backend' 'node' @("`"$Pre\scripts\start-backend.js`"") $Root
    Start-Bg 'web' 'cmd.exe' @('/c', 'npm', 'start') (Join-Path $Wt 'robotikf') @{ PORT = '3300'; BROWSER = 'none'; REACT_APP_API_URL = 'http://localhost:5300' }
    if ($Arg -ne 'web') {
      if ($Phone) { Write-Host "  telefon $Serial (SECURITY_DEVICE), emulator se ne pali" } else { Start-Emulator }
      Set-AdbReverse
      Start-Bg 'metro' 'cmd.exe' @('/c', 'npx', 'expo', 'start', '--port', '8082') (Join-Path $Wt 'robotikm') @{ EXPO_PUBLIC_API_URL = 'http://localhost:5300'; EXPO_PUBLIC_NFC_SIMULATION = '1' }
    }
    Write-Host "`nGotovo. Web: http://localhost:3300/security | Mejlovi: http://localhost:8026"
    Write-Host "Nalozi (lozinka Preprod123!): E2E Admin, E2E Superadmin, koordinator E2E Koordinator, radnik E2E Cuvar"
  }
  'stop' {
    $p = Get-Pids
    # PID iz pids.json se gasi samo ako komandna linija i dalje odgovara našem servisu
    # (Windows ponovo dodeljuje stare PID-ove drugim procesima). web i metro se gase preko porta ispod.
    $Expect = @{ mongo = 'mongod.*27118'; mailpit = 'mailpit.*8026'; backend = 'preprod-security\\scripts\\start-backend\.js'; sim = 'preprod-security\\scripts\\demo\.js' }
    foreach ($name in $p.PSObject.Properties.Name) {
      $procId = $p.$name
      if (-not $Expect.ContainsKey($name)) { continue }
      $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue).CommandLine
      if (-not $cmdLine) { continue }
      if ($cmdLine -match $Expect[$name]) { & taskkill /T /F /PID $procId | Out-Null; Write-Host "  ugašen $name ($procId)" }
      else { Write-Host "  PID $procId ($name) sada pripada drugom procesu, ne diram ga" -ForegroundColor Yellow }
    }
    # Ručno pokrenuto na našim portovima: gasi se samo ako je to naš proces
    $Owners = @{ mongo = 'preprod-security'; mailpit = 'preprod-security'; backend = 'preprod-security'; web = '\.wt\\robotikf|react-scripts'; metro = '\.wt\\robotikm' }
    foreach ($name in $Owners.Keys) {
      $conn = Get-NetTCPConnection -LocalPort $Services[$name].Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
      if (-not $conn) { continue }
      $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)" -ErrorAction SilentlyContinue).CommandLine
      if ($cmdLine -match $Owners[$name]) { & taskkill /T /F /PID $conn.OwningProcess | Out-Null; Write-Host "  ugašen $name (port $($Services[$name].Port))" }
      else { Write-Host "  port $($Services[$name].Port) drži tuđi proces ($($conn.OwningProcess)), ne diram ga" -ForegroundColor Yellow }
    }
    $emuSerial = Find-OurSerial
    if ($emuSerial) { AdbAny -s $emuSerial emu kill | Out-Null; Write-Host "  ugašen emulator robotik_sec ($emuSerial)" }
    Remove-Item $PidFile -ErrorAction SilentlyContinue
  }
  'status' {
    foreach ($name in $Services.Keys) {
      $s = $Services[$name]
      $state = if (Test-Port $s.Port) { 'RADI' } else { 'ne radi' }
      Write-Host ('  {0,-8} {1,-8} {2}' -f $name, $state, $s.Url)
    }
    $s = Find-OurSerial
    Write-Host ('  {0,-8} {1,-8} {2}' -f 'emulator', $(if ($s) { 'RADI' } else { 'ne radi' }), $(if ($s) { "$s (robotik_sec)" } else { 'robotik_sec' }))
  }
  'seed' { & node (Join-Path $Pre 'scripts\seed.js') --reset }
  'env' { & node (Join-Path $Pre 'scripts\make-env.js') }
  'export' { & node (Join-Path $Pre 'scripts\db-export.js') }
  'import' { & node (Join-Path $Pre 'scripts\db-import.js') }
  'demo' {
    # Situacija za trenutnu smenu, pa simulacija radnika u pozadini (očitavanja na vreme, prijave, odjave)
    $p = Get-Pids
    if ($p.sim -and (Get-Process -Id $p.sim -ErrorAction SilentlyContinue)) { & taskkill /T /F /PID $p.sim | Out-Null; Write-Host '  stara simulacija ugašena' }
    & node (Join-Path $Pre 'scripts\demo.js')
    Start-Bg 'sim' 'node' @("`"$Pre\scripts\demo.js`"", '--only-simulate') $Pre
    Write-Host "  simulacija radnika radi u pozadini (logs\sim.log); gasi se sa: security.ps1 stop"
  }
  'build' {
    Push-Location (Join-Path $Wt 'robotikm\android')
    try {
      $env:EXPO_PUBLIC_API_URL = 'http://localhost:5300'
      $env:EXPO_PUBLIC_NFC_SIMULATION = '1'
      # Port 8082 je upisan u aplikaciju: emulator tada učitava JS sa našeg Metro-a (10.0.2.2:8082), ne sa tuđeg na 8081
      # Emulator je x86_64, pravi telefon arm64
      $arch = if ($Phone) { 'arm64-v8a' } else { 'x86_64' }
      & .\gradlew.bat app:assembleDebug "-PreactNativeArchitectures=$arch" '-PreactNativeDevServerPort=8082'
      if ($LASTEXITCODE -ne 0) { throw 'Gradle build nije prošao' }
      Adb install -r 'app\build\outputs\apk\debug\app-debug.apk'
      Set-AdbReverse
    } finally { Pop-Location }
  }
  'test' {
    $env:ANDROID_SERIAL = $Serial
    # NFC sloj bez telefona i taga (lažna NFC biblioteka)
    if (-not $Arg -or $Arg -eq 'unit') {
      Push-Location (Join-Path $Wt 'robotikm')
      try { & npx jest src/security } finally { Pop-Location }
    }
    # Android (Maestro na emulatoru, poziva ga Playwright) i web
    if ($Arg -ne 'unit') {
      Push-Location (Join-Path $Pre 'e2e')
      try {
        if (-not (Test-Path 'node_modules')) { & npm install --no-audit --no-fund }
        if ($Arg) { & npx playwright test "--project=$Arg" } else { & npx playwright test }
      } finally { Pop-Location }
    }
  }
  default { Write-Host "Nepoznata komanda: $Command (start | stop | status | seed | build | test)" }
}
