// Cron za Security modul: alarmi svakog minuta, dnevna provera ugovora i licenci u zadato vreme.
// Vreme i pragovi se čitaju iz podešavanja pri svakom pokretanju, pa admin može da ih menja iz aplikacije.
const cron = require('node-cron');
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

function startSecurityScheduler() {
  if (started) return;
  started = true;
  cron.schedule('* * * * *', () => { tick().catch((e) => console.error('[Security] cron greška:', e.message)); });
  console.log('🛡️  Security scheduler pokrenut (alarmi svakog minuta, dnevna provera ugovora)');
}

module.exports = { startSecurityScheduler, tick };
