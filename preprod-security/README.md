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

## Android aplikacija na emulatoru

`security.ps1 start` pali i emulator `robotik_sec` (emulator-5556) i Metro na 8082 sa
`EXPO_PUBLIC_NFC_SIMULATION=1`. Aplikacija (debug APK) učitava kod sa Metro-a, pa izmene u JS-u stižu bez
novog builda; `security.ps1 build` samo kad se menjaju nativni moduli. Prijava: `E2E Cuvar` / `Preprod123!`.

Stanje za pregled (test radnik `E2E Cuvar`, Hotel Aurora), pa ponovo otvoriti aplikaciju ili povući ekran:

```powershell
cd <koren>\.wt\robotikb\preprod-security\e2e
node scenario.js soon      # smena počinje za 25 min (prijava otvorena)
node scenario.js late      # smena je počela pre 20 min, nije prijavljen
node scenario.js active    # prijavljen, obilazak u budućnosti, povremeni zadatak (prava smena 07-19 ili 19-07)
node scenario.js none      # bez smene
node alarm-now.js          # alarm za prvi checkpoint aktivne smene
```

## Testovi

`security.ps1 test` (pre-prod mora da radi, sa emulatorom): NFC unit testovi (Jest u `.wt\robotikm`), pa E2E u
`e2e\` (Playwright pokreće Maestro flow-ove na emulatoru i proverava server i web). Jedan deo:
`test unit`, `test android`, `test web`. Snimci i izlaz Maestro-a: `e2e\test-results\maestro\`.
Testovi sami isključe animacije na emulatoru (aplikacija tada radi u režimu smanjenog kretanja) i posle ih vrate.
Ceo paket traje oko 26 min (od toga smena kroz vreme oko 14 min). Osnovni Android testovi pomeraju kraj smene u odnosu
na sadašnji trenutak da bi radili u bilo koje doba dana; smena kroz vreme koristi samo prave smene iz rasporeda.

**Smena kroz vreme** (`e2e\tests\android-smena-kroz-vreme.spec.js`): virtuelni sat na serveru i na emulatoru ide kroz
cele smene korak po korak (smene su uvek dnevna 07-19 i noćna 19-07, 21 dan unapred):
- dnevna, uredna: prerana prijava, checkpoint pre prijave, prijava, prerano očitavanje, zamenjen i povučen tag,
  pomeren sat telefona, brz obilazak, tačka na vreme i u toleranciji, posle tolerancije (alarm), odlaganje,
  drugi alarm administratoru, propuštena tačka, odjava, izveštaj mejlom, očitavanje posle odjave;
- noćna: kašnjenje, MASTER alarm (i mejl), prijava sa ekrana alarma, kraj bez odjave (alarm i izveštaj), kasna odjava;
- dnevna: radnik ne dolazi, propuštena smena.

Sat na serveru: `scripts\test-clock.js` (uključuje ga `start-backend.js` uz `SECURITY_TEST_HOOKS=1`), ruta
`POST /api/security/_test/clock { at }` ili `{ reset: true }`. Važi za kod aplikacije i tokene; MongoDB drajver i cron
rade po pravom vremenu (ne podnose skokove). Sat na emulatoru: `adb root` + `date` (posle `adb root` ponovo
`adb reverse`). Posle testa sat se vraća i baza se ponovo puni (`seed`).

## NFC bez taga

Emulator nema NFC (`pm list features` nema `android.hardware.nfc`). Zato tri nivoa:

1. **Sve osim radija, na emulatoru:** "Simuliraj tag" šalje tag kroz isti čitač kao pravi
   (`robotikm/src/security/nfc.js`, `simulateTag`): broj taga, zaštita od dvostrukog dodira, čitač samo dok je
   aplikacija otvorena. Server dobija isto što i od pravog taga (izvor `simulated`). Ovo pokrivaju E2E testovi.
2. **NFC biblioteka bez telefona:** `src/security/__tests__/nfc.test.js` sa lažnom bibliotekom koja se ponaša kao
   `react-native-nfc-manager` (reader mode NFC-A/B/F/V, isključen NFC, telefon bez NFC-a, tag koji otvara aplikaciju).
3. **Pravi radio, bez NTAG215 nalepnica:** aplikacija čita samo fabrički broj taga, pa radi bilo koja NFC kartica
   sa stalnim brojem: kartica za gradski prevoz, kartica ili privezak za ulaz u zgradu, hotelska kartica.
   Bankovne kartice često daju nov nasumičan broj pri svakom očitavanju, pa služe samo za "Nepoznat tag".
   Koraci (telefon sa NFC-om, uključen USB debugging):
   ```powershell
   $env:SECURITY_DEVICE = '<serijski broj iz adb devices>'
   powershell -ExecutionPolicy Bypass -File <koren>\.wt\robotikb\preprod-security\security.ps1 build   # arm64 APK na telefon
   powershell -ExecutionPolicy Bypass -File <koren>\.wt\robotikb\preprod-security\security.ps1 start   # adb reverse na telefon
   node <koren>\.wt\robotikb\preprod-security\e2e\scenario.js soon
   ```
   Na telefonu prijava `E2E Cuvar`, prisloni karticu: "Nepoznat tag". Na webu (Objekti, Nepoznati tagovi,
   Registruj) upiši naziv i izaberi radno mesto za Hotel Aurora, prisloni ponovo: "Prijavljen na smenu". Za kraj prave
   provere i dalje treba nekoliko NTAG215 nalepnica (i za upis linka za otvaranje aplikacije).

## Provera redizajna

`scripts\redizajn-provera\`: `audit-all.js` (raspored na 6 širina + hover), `flow.js` (tokovi po stranicama),
`interact.js` (Uživo), `snap.js` i `final-shots.js` (snimci). Traže Playwright (`npm i playwright` negde u putanji
ili `PLAYWRIGHT_DIR`). U Git Bash-u putanje kao `/security` idu sa `MSYS_NO_PATHCONV=1`.
