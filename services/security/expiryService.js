// Dnevna provera: ugovori (mesec dana pre isteka) i licence radnika obezbeđenja.
// Svaki prag se šalje samo jednom (alertsSent), a ne svaki dan kao kod tehničara.
const SecurityWorker = require('../../models/SecurityWorker');
const SecurityAlarm = require('../../models/SecurityAlarm');
const { getSettings } = require('./settings');
const { instantToLocal, fmtDateSr } = require('./time');
const { adminRecipients, webNotify, sendMail, alertEmailHtml } = require('./notify');
const { addDossier } = require('./events');

const DAY = 86400000;

async function alertOnce(worker, key, fn) {
  if ((worker.alertsSent || []).some((a) => a.key === key)) return false;
  const res = await SecurityWorker.updateOne({ _id: worker._id, 'alertsSent.key': { $ne: key } }, { $push: { alertsSent: { key, at: new Date() } } });
  if (!res.modifiedCount) return false;
  await fn();
  return true;
}

async function runDailyChecks(now = new Date()) {
  const s = await getSettings();
  const admins = await adminRecipients();
  const workers = await SecurityWorker.find({ isActive: true });
  let sent = 0;
  for (const w of workers) {
    // Ugovor
    if (w.contract && w.contract.until) {
      const untilYmd = instantToLocal(w.contract.until).ymd;
      const daysLeft = Math.ceil((w.contract.until.getTime() - now.getTime()) / DAY);
      for (const th of (s.expiry.contractDays || [30]).slice().sort((a, b) => b - a)) {
        if (daysLeft <= th && daysLeft >= 0) {
          const ok = await alertOnce(w, `contract:${untilYmd}:${th}`, async () => {
            const text = daysLeft === 0 ? `Ugovor ističe danas (${fmtDateSr(untilYmd)}).` : `Ugovor ističe za ${daysLeft} ${daysLeft === 1 ? 'dan' : 'dana'} (${fmtDateSr(untilYmd)}).`;
            await SecurityAlarm.create({ kind: 'contract', level: 'warn', title: `Ističe ugovor: ${w.name}`, message: text, workerId: w._id, workerName: w.name, recipients: admins.map((a) => ({ name: a.name, role: a.role })), channels: ['web', 'email'] });
            await webNotify(admins, { type: 'security_contract_expiry', priority: 'high', title: `Ističe ugovor · ${w.name}`, message: text, targetPage: `/security/radnici?radnik=${w._id}`, targetId: w._id });
            if (s.expiry.emailAdmins) await sendMail({ to: admins.map((a) => a.gmail), subject: `Ističe ugovor · ${w.name} · ${fmtDateSr(untilYmd)}`, html: alertEmailHtml({ heading: `Ističe ugovor · ${w.name}`, lines: [text, 'Produži ugovor ili planiraj zamenu u rasporedu.'], level: 'warn', linkPath: `/security/radnici?radnik=${w._id}` }) });
            await addDossier({ workerId: w._id, kind: 'contract', level: 'info', text: `${text} Obavešteni administratori.` });
          });
          if (ok) sent++;
          break; // samo najbliži prag
        }
      }
    }
    // Licence
    if (s.expiry.licenseEnabled) {
      for (const l of w.licenses || []) {
        if (!l.validUntil) continue;
        const ymd = instantToLocal(l.validUntil).ymd;
        const daysLeft = Math.ceil((l.validUntil.getTime() - now.getTime()) / DAY);
        for (const th of (s.expiry.licenseDays || [60]).slice().sort((a, b) => b - a)) {
          if (daysLeft <= th && daysLeft >= 0) {
            const ok = await alertOnce(w, `license:${l._id}:${ymd}:${th}`, async () => {
              const text = `Licenca "${l.type}" ističe za ${daysLeft} ${daysLeft === 1 ? 'dan' : 'dana'} (${fmtDateSr(ymd)}).`;
              await SecurityAlarm.create({ kind: 'license', level: 'warn', title: `Ističe licenca: ${w.name}`, message: text, workerId: w._id, workerName: w.name, recipients: admins.map((a) => ({ name: a.name, role: a.role })), channels: ['web'] });
              await webNotify(admins, { type: 'security_license_expiry', priority: 'medium', title: `Ističe licenca · ${w.name}`, message: text, targetPage: `/security/radnici?radnik=${w._id}`, targetId: w._id });
              await addDossier({ workerId: w._id, kind: 'license', level: 'info', text });
            });
            if (ok) sent++;
            break;
          }
        }
      }
    }
  }
  return { sent };
}

module.exports = { runDailyChecks };
