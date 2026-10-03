// Cron za Security modul: alarmi svakog minuta, dnevna provera ugovora i licenci u zadato vreme.
// Vreme i pragovi se čitaju iz podešavanja pri svakom pokretanju, pa admin može da ih menja iz aplikacije.
const cron = require('node-cron');
const mongoose = require('mongoose');
const { runEngine } = require('./alarmEngine');
const { runDailyChecks } = require('./expiryService');
const { getSettings } = require('./settings');
const { instantToLocal } = require('./time');

let lastDailyYmd = null;
let started = false;

async function tick(now = new Date()) {
  await runEngine(now);
  try {
    const s = await getSettings();
    const local = instantToLocal(now);
    const target = (s.expiry && s.expiry.dailyTime) || '09:00';
    if (local.hhmm >= target && lastDailyYmd !== local.ymd) {
      lastDailyYmd = local.ymd;
      await runDailyChecks(now);
    }
  } catch (e) {
    console.error('[Security] dnevna provera greška:', e.message);
  }
}

// Indeksi Security modela, posebno jedinstveni (jedna smena po radniku, datumu i vrsti; jednokratne radnje) koji
// štite od duplikata kad dva zahteva stignu u istoj sekundi. Modeli se učitavaju pre konekcije, a bufferCommands
// je isključen (config/db.js), pa Mongoose ne može sam da ih napravi: prave se kad je baza spremna.
const INDEXED = ['SecurityShift', 'SecurityOnce', 'SecurityScan', 'SecurityAlarm', 'SecurityObservation', 'SecurityTask', 'SecurityDossier', 'NfcTag', 'SecurityWorker', 'SecurityFacility'];
async function ensureIndexes() {
  for (const name of INDEXED) {
    try { await require(`../../models/${name}`).createIndexes(); } catch (e) { console.error(`[Security] indeksi ${name}:`, e.message); }
  }
}

function startSecurityScheduler() {
  if (started) return;
  started = true;
  const indexes = () => { ensureIndexes().catch(() => {}); };
  if (mongoose.connection.readyState === 1) indexes(); else mongoose.connection.once('connected', indexes);
  cron.schedule('* * * * *', () => { tick().catch((e) => console.error('[Security] cron greška:', e.message)); });
  console.log('🛡️  Security scheduler pokrenut (alarmi svakog minuta, dnevna provera ugovora)');
}

module.exports = { startSecurityScheduler, tick };
