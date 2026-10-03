// Zajedničke vrednosti za Security E2E. Sve pokazuje na LOKALNI Security pre-prod (5300 / 3300 / 27118),
// nikad na produkciju ni na drugi pre-prod (5100 / 3100, emulator-5554).
const path = require('path');
const fs = require('fs');

const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const API_URL = process.env.API_URL || 'http://localhost:5300';
const WEB_URL = process.env.WEB_URL || 'http://localhost:3300';
for (const [name, url] of [['API_URL', API_URL], ['WEB_URL', WEB_URL]]) {
  if (!LOCAL.test(url)) throw new Error(`[e2e] ${name} mora biti lokalan (dobio: ${url})`);
}
if (/:(5000|3000|5100|3100)$/.test(API_URL) || /:(5000|3000|5100|3100)$/.test(WEB_URL)) throw new Error('[e2e] portovi 3000/5000 (produkcija) i 3100/5100 (drugi pre-prod) nisu dozvoljeni');

const LOCALAPP = process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local');
// Koren projekta: <koren>/.wt/robotikb/preprod-security/e2e ili <koren>/preprod-security/e2e
const PRE_DIR = path.resolve(__dirname, '..', '..');
const ROOT = fs.existsSync(path.join(PRE_DIR, '..', '.wt', 'robotikb')) ? path.resolve(PRE_DIR, '..') : path.resolve(PRE_DIR, '..', '..', '..');
const ANDROID_HOME = process.env.ANDROID_HOME || path.join(LOCALAPP, 'Android', 'Sdk');

module.exports = {
  API_URL,
  WEB_URL,
  MONGO_URI: 'mongodb://127.0.0.1:27118',
  DB_NAME: 'robotik_preprod_security',
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
