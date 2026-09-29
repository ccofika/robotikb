// Alarm engine: pokreće ga cron svakog minuta (isti obrazac kao podsetnik za naloge:
// prvo atomski "claim" polja u bazi, pa tek onda slanje, da se alarm nikad ne pošalje dva puta)
const SecurityShift = require('../../models/SecurityShift');
const SecurityFacility = require('../../models/SecurityFacility');
const { getSettings, rulesFor } = require('./settings');
const { addDossier, hm } = require('./events');
const dispatch = require('./alarmDispatch');

let running = false;

async function claim(shiftId, path, extra = {}) {
  const res = await SecurityShift.updateOne({ _id: shiftId, [path]: null, ...extra }, { $set: { [path]: new Date() } });
  return res.modifiedCount > 0;
}

async function runEngine(now = new Date()) {
  if (process.env.SECURITY_ALARMS_DISABLED === 'true') return { skipped: 'env' };
  if (running) return { skipped: 'busy' };
  running = true;
  const stats = { late: 0, master: 0, missed: 0, cp1: 0, cp2: 0, noClockOut: 0, reports: 0 };
  try {
    const s = await getSettings();
    if (!s.alarms || !s.alarms.enabled) return { skipped: 'disabled' };
    const facCache = new Map();
    const facilityOf = async (id) => {
      const k = String(id);
      if (!facCache.has(k)) facCache.set(k, await SecurityFacility.findById(id).lean());
      return facCache.get(k);
    };

    // A) radnik nije prijavljen (samo objavljene smene)
    const pending = await SecurityShift.find({
      status: 'planned', published: true,
      plannedStart: { $lte: new Date(now.getTime() - Math.min(s.alarms.lateMin, s.alarms.masterMin) * 60000), $gte: new Date(now.getTime() - 36 * 3600000) }
    });
    for (const sh of pending) {
      const rules = rulesFor(s, await facilityOf(sh.facilityId));
      if (now >= sh.plannedEnd) {
        const r = await SecurityShift.updateOne({ _id: sh._id, status: 'planned' }, { $set: { status: 'missed' } });
        if (r.modifiedCount) {
          stats.missed++;
          await addDossier({ workerId: sh.workerId, kind: 'missed', level: 'critical', facilityName: (await facilityOf(sh.facilityId) || {}).name, shiftId: sh._id, text: `Nije došao na smenu (${hm(sh.plannedStart)} - ${hm(sh.plannedEnd)}).` });
        }
        continue;
      }
      const minsLate = Math.floor((now - sh.plannedStart) / 60000);
      if (minsLate >= rules.lateMin && !sh.alarms.lateAt && await claim(sh._id, 'alarms.lateAt', { status: 'planned' })) {
        await dispatch.fireLate(sh, rules); stats.late++;
      }
      if (minsLate >= rules.masterMin && !sh.alarms.masterAt && await claim(sh._id, 'alarms.masterAt', { status: 'planned' })) {
        await dispatch.fireMaster(sh, rules); stats.master++;
      }
    }

    // B) checkpoint alarmi za aktivne smene
    const active = await SecurityShift.find({ status: 'active', 'rounds.0': { $exists: true } });
    for (const sh of active) {
      const rules = rulesFor(s, await facilityOf(sh.facilityId));
      for (let i = 0; i < sh.rounds.length; i++) {
        const r = sh.rounds[i];
        if (r.scannedAt) continue;
        if (!r.alarm1At && now.getTime() >= r.dueAt.getTime() + rules.checkpointTolMin * 60000) {
          if (await claim(sh._id, `rounds.${i}.alarm1At`, { status: 'active', [`rounds.${i}.scannedAt`]: null })) {
            await dispatch.fireCheckpoint1(sh, i, rules); stats.cp1++;
          }
        } else if (r.alarm1At && !r.alarm2At) {
          const due2 = r.snoozedUntil ? r.snoozedUntil.getTime() : r.alarm1At.getTime() + rules.snoozeMin * 60000;
          if (now.getTime() >= due2 && await claim(sh._id, `rounds.${i}.alarm2At`, { status: 'active', [`rounds.${i}.scannedAt`]: null })) {
            const fresh = await SecurityShift.findById(sh._id);
            await dispatch.fireCheckpoint2(fresh, i, rules); stats.cp2++;
          }
        }
      }
    }

    // C) nema odjave posle kraja smene
    if (s.alarms.noClockOutEnabled) {
      const late = await SecurityShift.find({ status: 'active', 'alarms.noClockOutAt': null, plannedEnd: { $lte: new Date(now.getTime() - s.alarms.noClockOutMin * 60000) } });
      for (const sh of late) {
        if (await claim(sh._id, 'alarms.noClockOutAt', { status: 'active' })) {
          await dispatch.fireNoClockOut(sh, rulesFor(s, await facilityOf(sh.facilityId)));
          stats.noClockOut++;
          const { sendShiftReport } = require('./reportService');
          await SecurityShift.updateOne({ _id: sh._id }, { $set: { 'report.noClockOut': true } });
          await sendShiftReport(sh._id, { reason: 'no_clock_out' }).catch((e) => console.error('[Security] izveštaj bez odjave:', e.message));
        }
      }
    }

    // D) izveštaji koji nisu otišli (greška pri slanju) - do 3 pokušaja
    const unsent = await SecurityShift.find({ status: 'done', 'report.sentAt': null, 'report.attempts': { $lt: 3 }, 'clockOut.at': { $lte: new Date(now.getTime() - 60000) } }).select('_id').limit(10);
    if (unsent.length) {
      const { sendShiftReport } = require('./reportService');
      for (const u of unsent) { await sendShiftReport(u._id, { reason: 'retry' }).catch(() => {}); stats.reports++; }
    }
    return stats;
  } catch (e) {
    console.error('[Security] alarm engine greška:', e);
    return { error: e.message };
  } finally {
    running = false;
  }
}

module.exports = { runEngine };
