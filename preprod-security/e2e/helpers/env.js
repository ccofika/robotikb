// Zajedničke vrednosti za Security E2E. Sve pokazuje na LOKALNI Security pre-prod, nikad na produkciju ni na
// drugi pre-prod (5100 / 3100, emulator-5554). Testovi rade na instanci za testove (scripts/instance.js:
// backend 5301, web 3301, Mailpit 8027, baza robotik_preprod_security_e2e), jer brišu podatke i pomeraju sat.
// Ručni alati (scenario.js, alarm-now.js) rade na standardnoj instanci (E2E_TARGET=main: 5300 / 3300 / 8026).
const path = require('path');
const fs = require('fs');
const { INSTANCES } = require('../../scripts/instance');

const TARGET = process.env.E2E_TARGET === 'main' ? 'main' : 'e2e';
const I = INSTANCES[TARGET];
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const API_URL = process.env.API_URL || `http://localhost:${I.api}`;
const WEB_URL = process.env.WEB_URL || `http://localhost:${I.web}`;
for (const [name, url] of [['API_URL', API_URL], ['WEB_URL', WEB_URL]]) {
  if (!LOCAL.test(url)) throw new Error(`[e2e] ${name} mora biti lokalan (dobio: ${url})`);
}
if (/:(5000|3000|5100|3100)$/.test(API_URL) || /:(5000|3000|5100|3100)$/.test(WEB_URL)) throw new Error('[e2e] portovi 3000/5000 (produkcija) i 3100/5100 (drugi pre-prod) nisu dozvoljeni');
if (TARGET === 'e2e' && (/:(5300|3300)$/.test(API_URL) || /:(5300|3300)$/.test(WEB_URL))) throw new Error('[e2e] testovi ne rade na standardnoj instanci (3300/5300, tu radi čovek), samo na 3301/5301');

const LOCALAPP = process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local');
// Koren projekta: <koren>/.wt/robotikb/preprod-security/e2e ili <koren>/preprod-security/e2e
const PRE_DIR = path.resolve(__dirname, '..', '..');
const ROOT = fs.existsSync(path.join(PRE_DIR, '..', '.wt', 'robotikb')) ? path.resolve(PRE_DIR, '..') : path.resolve(PRE_DIR, '..', '..', '..');
const ANDROID_HOME = process.env.ANDROID_HOME || path.join(LOCALAPP, 'Android', 'Sdk');

module.exports = {
  TARGET,
  API_URL,
  WEB_URL,
  MAILPIT_URL: process.env.MAILPIT_URL || `http://localhost:${I.mailWeb}`,
  // Aplikacija na uređaju uvek zove localhost:5300 (i 3300); adb reverse ih vodi na instancu koja se testira
  DEVICE_API_PORT: 5300,
  DEVICE_WEB_PORT: 3300,
  API_PORT: Number(new URL(API_URL).port),
  WEB_PORT: Number(new URL(WEB_URL).port),
  MONGO_URI: 'mongodb://127.0.0.1:27118',
  DB_NAME: I.db,
  PASSWORD: 'Preprod123!',
  ADMIN: 'E2E Admin',
  GUARD: 'E2E Cuvar',
  FACILITY: 'Hotel Aurora',
  APP_ID: 'com.robotik.mobile',
  // Naš emulator (robotik_sec); drugi pre-prod koristi emulator-5554
  SERIAL: process.env.ANDROID_SERIAL || 'emulator-5556',
  ROOT,
  BACKEND_DIR: path.join(ROOT, '.wt', 'robotikb'),
  JAVA_HOME: process.env.JAVA_HOME || path.join(LOCALAPP, 'Programs', 'Java', 'jdk-17'),
  ANDROID_HOME,
  ADB: path.join(ANDROID_HOME, 'platform-tools', 'adb.exe'),
  MAESTRO_BIN: path.join(LOCALAPP, 'Programs', 'maestro', 'bin', 'maestro.bat'),
  MAESTRO_DIR: path.join(__dirname, '..', 'maestro'),
  OUT_DIR: path.join(__dirname, '..', 'test-results'),
};
