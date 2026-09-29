# Robotik Security: lokalni pre-prod

Odvojeno lokalno okruženje samo za Security modul (grana `feature/security-module` u robotikb, robotikf i robotikm).
Nikad ne koristi produkcionu bazu ni produkcione ključeve.

| Servis | Port | Link |
|---|---|---|
| MongoDB | 27118 | `mongodb://127.0.0.1:27118/robotik_preprod_security` |
| Mailpit (mejlovi) | 8026 / SMTP 1026 | http://localhost:8026 |
| backend (robotikb) | 5300 | http://localhost:5300 |
| web (robotikf) | 3300 | http://localhost:3300/security |
| Metro (robotikm, opciono) | 8082 | |

Nalozi (lozinka `Preprod123!`): `E2E Admin`, `E2E Superadmin`, koordinator `E2E Koordinator`, radnici `E2E Cuvar`,
`Marko Petrović`, `Lazar Todorović` i ostali iz dummy podataka.

## Raspored foldera

Skripte same nalaze koren projekta. Rade i iz korena i iz repoa:

```
<koren>\robotikb, robotikf, robotikm        glavni klonovi (main)
<koren>\.wt\robotikb, robotikf, robotikm    git worktree na grani feature/security-module
<koren>\.wt\robotikb\preprod-security       ovaj folder (u repou), ili kopija u <koren>\preprod-security
```

## Nov uređaj

Potrebno: Node 18+, MongoDB Server (mongod u `%LOCALAPPDATA%\Programs\mongodb\bin\mongod.exe`) i Mailpit
(`%LOCALAPPDATA%\Programs\mailpit\mailpit.exe`). Za Android deo još JDK 17, Android SDK i AVD `robotik_sec`.

```powershell
# 1) npm install u .wt\robotikb i .wt\robotikf (i .wt\robotikm za Android)
# 2) lokalni env (nasumični lokalni ključevi, bez produkcionih vrednosti)
powershell -ExecutionPolicy Bypass -File <koren>\.wt\robotikb\preprod-security\security.ps1 env
# 3) baza, Mailpit, backend i web
powershell -ExecutionPolicy Bypass -File <koren>\.wt\robotikb\preprod-security\security.ps1 start web
# 4) dummy podaci iz dummy-data\ (briše samo robotik_preprod_security i pravi indekse)
powershell -ExecutionPolicy Bypass -File <koren>\.wt\robotikb\preprod-security\security.ps1 import
# 5) živa situacija za trenutnu smenu + simulacija radnika
powershell -ExecutionPolicy Bypass -File <koren>\.wt\robotikb\preprod-security\security.ps1 demo
```

Dummy podaci su izvezeni 29.9.2026 uveče (smene, očitavanja i izveštaji su oko tog datuma). Za sveže datume:
`security.ps1 seed` (briše bazu i pravi raspored ±14 dana od danas), pa `security.ps1 demo`.

## Komande

`start` / `start web`, `stop`, `status`, `env`, `seed`, `demo`, `export`, `import`, `build`, `test`
(opis je na vrhu `security.ps1`). `demo` najviše pokazuje 30 do 40 min posle početka smene (07:00 i 19:00).

## Provera redizajna

`scripts\redizajn-provera\`: `audit-all.js` (raspored na 6 širina + hover), `flow.js` (tokovi po stranicama),
`interact.js` (Uživo), `snap.js` i `final-shots.js` (snimci). Traže Playwright (`npm i playwright` negde u putanji
ili `PLAYWRIGHT_DIR`). U Git Bash-u putanje kao `/security` idu sa `MSYS_NO_PATHCONV=1`.
