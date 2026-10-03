// Virtuelni sat za E2E "smena kroz vreme": server (POST /api/security/_test/clock, uključuje ga start-backend.js)
// i emulator (adb root + date) uvek u istom trenutku, pa aplikacija i mehanizam alarma vide isto vreme.
const { adb, reverseAll } = require('./maestro');
const { login, client } = require('./api');
const { ADMIN } = require('./env');

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const p2 = (n) => String(n).padStart(2, '0');
let rooted = false;

// adb root treba za promenu sata; posle njega adbd se ponovo pokreće i briše adb reverse
function deviceRoot() {
  if (rooted) return;
  adb('root');
  for (let i = 0; i < 40; i++) {
    try { if (/uid=0/.test(adb('shell', 'id'))) break; } catch (e) { /* adbd se ponovo pokreće */ }
    sleep(500);
  }
  reverseAll();
  adb('shell', 'settings', 'put', 'global', 'auto_time', '0');
  rooted = true;
}

function setDevice(at) {
  deviceRoot();
  const d = new Date(at);
  adb('shell', 'date', '-u', `${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${d.getUTCFullYear()}.${p2(d.getUTCSeconds())}`);
}

// Posle skoka sata se proverava da backend i baza odgovaraju (prijava administratora)
async function waitReady(timeoutMs = 90000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try { await login(ADMIN); return; } catch (e) {
      if (Date.now() > end) throw new Error(`[clock] backend ne odgovara posle skoka sata: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function setServer(at) {
  const a = client(await login(ADMIN));
  const state = await a.post('/_test/clock', { at: new Date(at).toISOString() });
  await waitReady();
  return state;
}

// Skok u trenutak `at` (Date). deviceSkewMin: sat telefona namerno pomeren u odnosu na server (provera oznake "sat")
async function travel(at, { deviceSkewMin = 0 } = {}) {
  const state = await setServer(at);
  setDevice(new Date(new Date(at).getTime() + deviceSkewMin * 60000));
  return state;
}

async function reset() {
  try { const a = client(await login(ADMIN)); await a.post('/_test/clock', { reset: true }); await waitReady(); } catch (e) { /* backend bez virtuelnog sata */ }
  try { deviceRoot(); setDevice(new Date()); adb('shell', 'settings', 'put', 'global', 'auto_time', '1'); } catch (e) { /* uređaj nije dostupan */ }
}

module.exports = { travel, reset, setServer, setDevice };
