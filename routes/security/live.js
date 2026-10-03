// Uživo: stanje svih objekata, otvoreni alarmi, događaji i sledeći obilasci
const express = require('express');
const SecurityFacility = require('../../models/SecurityFacility');
const SecurityShift = require('../../models/SecurityShift');
const SecurityAlarm = require('../../models/SecurityAlarm');
const SecurityScan = require('../../models/SecurityScan');
const SecurityObservation = require('../../models/SecurityObservation');
const SecurityTask = require('../../models/SecurityTask');
const SecurityWorker = require('../../models/SecurityWorker');
const { isSecurityStaff, facilityScope } = require('../../middleware/securityAuth');
const { getSettings, rulesFor } = require('../../services/security/settings');
const { shiftLabel } = require('../../services/security/shiftService');
const { instantToLocal, localToInstant, hhmmToMinutes, addDaysYmd, shiftWindow } = require('../../services/security/time');
const { ah } = require('./helpers');

const router = express.Router();
router.use(isSecurityStaff);

const OPEN = ['open', 'snoozed', 'escalated', 'ack'];
const SCAN_TEXT = {
  clock_in: (s) => `${s.workerName} se prijavio na smenu${s.lateMin ? `, kašnjenje ${s.lateMin} min` : ''}`,
  clock_out: (s) => `${s.workerName} se odjavio sa smene`,
  checkpoint: (s) => `${s.workerName}: ${s.tagName}${s.lateMin > 0 ? ` (${s.lateMin} min posle plana)` : ''}`,
  extra: (s) => `${s.workerName}: ${s.tagName} van plana`,
  unknown_tag: (s) => `${s.workerName} je očitao nepoznat tag ${s.uid}`,
  replaced_tag: (s) => `${s.workerName} je očitao zamenjen tag (${s.tagName})`,
  retired_tag: (s) => `${s.workerName} je očitao uklonjen tag (${s.tagName})`,
  no_shift: (s) => `${s.workerName} je očitao ${s.tagName}, a nema smenu`,
  no_clock_in: (s) => `${s.workerName} je očitao ${s.tagName} pre prijave`,
  shift_done: (s) => `${s.workerName} je očitao ${s.tagName} posle kraja smene`
};
const SCAN_LEVEL = { clock_in: 'ok', clock_out: 'ok', checkpoint: 'ok', extra: 'info', unknown_tag: 'warn', replaced_tag: 'warn', retired_tag: 'warn', no_shift: 'warn', no_clock_in: 'warn', shift_done: 'info' };

router.get('/', ah(async (req, res) => {
  const now = new Date();
  const scope = await facilityScope(req);
  const fq = { active: true };
  if (scope) fq._id = { $in: scope };
  const facilities = await SecurityFacility.find(fq).sort({ name: 1 }).lean();
  const fids = facilities.map((f) => f._id);
  const s = await getSettings();

  const [shifts, alarms, scans, notes, tasksDone, reportsSent, drafts] = await Promise.all([
    SecurityShift.find({
      facilityId: { $in: fids }, status: { $ne: 'cancelled' },
      plannedStart: { $lte: new Date(now.getTime() + 3 * 3600000) },
      plannedEnd: { $gte: new Date(now.getTime() - 2 * 3600000) }
    }).populate('workerId', 'name phone').lean(),
    SecurityAlarm.find({ facilityId: { $in: fids }, state: { $in: OPEN }, firedAt: { $gte: new Date(now.getTime() - 48 * 3600000) } }).sort({ firedAt: -1 }).limit(50).lean(),
    SecurityScan.find({ facilityId: { $in: fids }, at: { $gte: new Date(now.getTime() - 24 * 3600000) } }).sort({ at: -1 }).limit(60).lean(),
    SecurityObservation.find({ facilityId: { $in: fids }, at: { $gte: new Date(now.getTime() - 24 * 3600000) } }).sort({ at: -1 }).limit(20).lean(),
    SecurityTask.find({ facilityId: { $in: fids }, status: 'done', doneAt: { $gte: new Date(now.getTime() - 24 * 3600000) } }).sort({ doneAt: -1 }).limit(20).lean(),
    SecurityShift.find({ facilityId: { $in: fids }, 'report.sentAt': { $gte: new Date(now.getTime() - 24 * 3600000) } }).select('facilityId report').lean(),
    SecurityShift.countDocuments({ facilityId: { $in: fids }, published: false, status: 'planned', plannedStart: { $gte: now, $lte: new Date(now.getTime() + 24 * 3600000) } })
  ]);
  const recentAlarms = await SecurityAlarm.find({ facilityId: { $in: fids }, firedAt: { $gte: new Date(now.getTime() - 24 * 3600000) } }).sort({ firedAt: -1 }).limit(30).lean();
  const fName = new Map(facilities.map((f) => [String(f._id), f.name]));

  // Za tablu obilazaka: zadaci i poslednje očitavanje svake smene
  const shiftIds = shifts.map((x) => x._id);
  const [shiftTasks, freeTasks, lastScans] = await Promise.all([
    SecurityTask.find({ shiftId: { $in: shiftIds }, status: { $ne: 'cancelled' } }).sort({ dueAt: 1 }).lean(),
    // zadaci za objekat bez smene (više radnika u smeni u to vreme): prikazuju se kod svake smene koja ih pokriva
    SecurityTask.find({ shiftId: null, facilityId: { $in: fids }, status: { $ne: 'cancelled' }, dueAt: { $gte: new Date(now.getTime() - 26 * 3600000), $lte: new Date(now.getTime() + 16 * 3600000) } }).sort({ dueAt: 1 }).lean(),
    SecurityScan.aggregate([
      { $match: { shiftId: { $in: shiftIds }, result: { $in: ['clock_in', 'clock_out', 'checkpoint', 'extra'] } } },
      { $sort: { at: -1 } },
      { $group: { _id: '$shiftId', at: { $first: '$at' }, tagName: { $first: '$tagName' }, result: { $first: '$result' } } }
    ])
  ]);
  const tasksByShift = new Map();
  const addTask = (k, t) => { if (!tasksByShift.has(k)) tasksByShift.set(k, []); tasksByShift.get(k).push(t); };
  shiftTasks.forEach((t) => addTask(String(t.shiftId), t));
  freeTasks.forEach((t) => shifts
    .filter((x) => String(x.facilityId) === String(t.facilityId) && t.dueAt >= x.plannedStart && t.dueAt <= x.plannedEnd)
    .forEach((x) => addTask(String(x._id), t)));
  const lastByShift = new Map(lastScans.map((l) => [String(l._id), l]));

  // Trenutna smena (dnevna ili noćna) po podešavanjima: osa table obilazaka
  const loc = instantToLocal(now);
  const dayStartMin = hhmmToMinutes(s.dayStart || '07:00');
  const nightStartMin = hhmmToMinutes(s.nightStart || '19:00');
  const winType = loc.minutes >= dayStartMin && loc.minutes < nightStartMin ? 'day' : 'night';
  const winYmd = winType === 'day' || loc.minutes >= nightStartMin ? loc.ymd : addDaysYmd(loc.ymd, -1);
  const win = shiftWindow(winYmd, winType, s);

  let onDuty = 0, expected = 0, roundsDone = 0, roundsDue = 0;
  const upcoming = [];
  const rows = facilities.map((f) => {
    const rules = rulesFor(s, f);
    const mine = shifts.filter((x) => String(x.facilityId) === String(f._id)).sort((a, b) => new Date(a.plannedStart) - new Date(b.plannedStart));
    const current = mine.filter((x) => x.status === 'active' || (x.published && x.status === 'planned' && new Date(x.plannedStart) - now <= 60 * 60000) || (x.status === 'missed' && new Date(x.plannedEnd) > now));
    const items = current.map((x) => {
      const started = now >= new Date(x.plannedStart);
      if (started && now <= new Date(x.plannedEnd)) expected++;
      if (x.status === 'active') onDuty++;
      const rounds = x.rounds || [];
      const due = rounds.filter((r) => new Date(r.dueAt) <= now);
      roundsDone += rounds.filter((r) => r.scannedAt).length;
      roundsDue += due.length;
      const next = rounds.find((r) => !r.scannedAt);
      if (next && x.status === 'active') upcoming.push({ facilityId: f._id, facilityName: f.name, workerName: x.workerId ? x.workerId.name : '', tagName: next.tagName, dueAt: next.dueAt, state: next.alarm2At ? 'bad' : next.alarm1At ? 'warn' : 'info', snoozedUntil: next.snoozedUntil });
      const openAl = alarms.filter((a) => String(a.shiftId) === String(x._id));
      const worst = openAl.find((a) => a.level === 'critical' && a.state !== 'ack') || openAl.find((a) => a.state !== 'ack') || openAl[0] || null;
      let state = 'waiting';
      if (x.status === 'active') state = worst ? (worst.level === 'critical' ? 'bad' : 'warn') : 'ok';
      else if (x.status === 'missed') state = 'bad';
      else if (started) state = worst && worst.level === 'critical' ? 'bad' : 'warn';
      return {
        _id: x._id, type: x.type, label: shiftLabel(x), plannedStart: x.plannedStart, plannedEnd: x.plannedEnd, status: x.status, published: x.published,
        worker: x.workerId ? { _id: x.workerId._id, name: x.workerId.name, phone: x.workerId.phone } : null,
        clockIn: x.clockIn ? x.clockIn.at : null, lateMin: x.lateMin, minutesLate: x.status === 'planned' && started ? Math.floor((now - new Date(x.plannedStart)) / 60000) : 0,
        roundsDone: rounds.filter((r) => r.scannedAt).length, roundsDue: due.length, roundsTotal: rounds.length,
        nextRound: next ? { tagName: next.tagName, dueAt: next.dueAt, alarm1At: next.alarm1At, alarm2At: next.alarm2At, snoozedUntil: next.snoozedUntil } : null,
        alarm: worst ? { _id: worst._id, kind: worst.kind, level: worst.level, title: worst.title, state: worst.state } : null,
        state, tolMin: rules.checkpointTolMin, snoozeMin: rules.snoozeMin,
        rounds: rounds.map((r) => ({ tagName: r.tagName, dueAt: r.dueAt, scannedAt: r.scannedAt, lateMin: r.lateMin, alarm1At: r.alarm1At, alarm2At: r.alarm2At, snoozedUntil: r.snoozedUntil })),
        tasks: (tasksByShift.get(String(x._id)) || []).map((t) => ({ _id: t._id, text: t.text, dueAt: t.dueAt, status: t.status, doneAt: t.doneAt, doneByName: t.doneByName, createdByName: t.createdByName })),
        lastScan: lastByShift.has(String(x._id)) ? { at: lastByShift.get(String(x._id)).at, tagName: lastByShift.get(String(x._id)).tagName, result: lastByShift.get(String(x._id)).result } : null,
        standing: { done: (x.standingDone || []).length, total: (f.standingTasks || []).length }
      };
    });
    const nextShift = mine.find((x) => x.status === 'planned' && new Date(x.plannedStart) > now && !current.includes(x));
    const order = { bad: 0, warn: 1, ok: 2, waiting: 3 };
    const facilityState = items.length ? items.map((i) => i.state).sort((a, b) => order[a] - order[b])[0] : 'idle';
    return {
      _id: f._id, name: f.name, city: f.city, address: f.address, type: f.type,
      contactName: f.contactName || '', contactPhone: f.contactPhone || '',
      state: facilityState, shifts: items,
      nextShift: nextShift ? { _id: nextShift._id, label: shiftLabel(nextShift), plannedStart: nextShift.plannedStart, published: nextShift.published, workerName: nextShift.workerId ? nextShift.workerId.name : '' } : null
    };
  });

  const feed = [
    ...scans.map((x) => ({ id: `s${x._id}`, at: x.at, level: SCAN_LEVEL[x.result] || 'info', facilityName: x.facilityName || fName.get(String(x.facilityId)) || '', text: (SCAN_TEXT[x.result] || (() => x.result))(x), flags: x.flags || [], offline: x.offline, kind: 'scan', result: x.result, uid: x.uid })),
    ...recentAlarms.map((a) => ({ id: `a${a._id}`, at: a.firedAt, level: a.level === 'critical' ? 'bad' : 'warn', facilityName: a.facilityName, text: `${a.title}: ${a.message}`, kind: 'alarm', alarmId: a._id, state: a.state })),
    ...notes.map((n) => ({ id: `n${n._id}`, at: n.at, level: n.kind === 'authority' ? 'warn' : 'info', facilityName: n.facilityName, text: n.kind === 'authority' ? `${n.workerName}: primena ovlašćenja (${n.power})` : `${n.workerName}: ${n.text.slice(0, 140)}`, kind: 'note', photos: (n.photos || []).length })),
    ...tasksDone.map((t) => ({ id: `t${t._id}`, at: t.doneAt, level: 'ok', facilityName: fName.get(String(t.facilityId)) || '', text: `${t.doneByName}: urađen zadatak "${t.text.slice(0, 80)}". ${t.comment.slice(0, 100)}`, kind: 'task' })),
    ...reportsSent.map((r) => ({ id: `r${r._id}`, at: r.report.sentAt, level: 'info', facilityName: fName.get(String(r.facilityId)) || '', text: `Izveštaj smene poslat na ${(r.report.sentTo || []).length} adrese`, kind: 'report', shiftId: r._id }))
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 50);

  const todayStart = localToInstant(instantToLocal(now).ymd, '00:00');
  const unknownTags = await SecurityScan.distinct('uid', { result: 'unknown_tag', handled: false, at: { $gte: new Date(now.getTime() - 30 * 86400000) }, ...(scope ? { facilityId: { $in: fids } } : {}) });

  // Telefon radnika uz alarm (dugme "Pozovi")
  const alarmWorkerIds = [...new Set(alarms.map((a) => a.workerId && String(a.workerId)).filter(Boolean))];
  const phoneOf = new Map((await SecurityWorker.find({ _id: { $in: alarmWorkerIds } }).select('phone').lean()).map((w) => [String(w._id), w.phone || '']));

  // Treba srediti: nepoznati tagovi, smene koje nisu objavljene, ugovori i licence koje ističu
  const [unknownList, draftList] = await Promise.all([
    SecurityScan.aggregate([
      { $match: { result: 'unknown_tag', handled: false, at: { $gte: new Date(now.getTime() - 30 * 86400000) }, ...(scope ? { facilityId: { $in: fids } } : {}) } },
      { $sort: { at: -1 } },
      { $group: { _id: '$uid', at: { $first: '$at' }, facilityName: { $first: '$facilityName' }, workerName: { $first: '$workerName' }, count: { $sum: 1 } } },
      { $sort: { at: -1 } },
      { $limit: 10 }
    ]),
    SecurityShift.find({ facilityId: { $in: fids }, published: false, status: 'planned', plannedStart: { $gte: now, $lte: new Date(now.getTime() + 24 * 3600000) } })
      .sort({ plannedStart: 1 }).limit(10).populate('workerId', 'name').lean()
  ]);
  const DAY = 86400000;
  const contractDays = Math.max(...((s.expiry && s.expiry.contractDays && s.expiry.contractDays.length) ? s.expiry.contractDays : [30]));
  const licenseDays = s.expiry && s.expiry.licenseEnabled === false ? 0 : Math.max(...((s.expiry && s.expiry.licenseDays && s.expiry.licenseDays.length) ? s.expiry.licenseDays : [60]));
  const expWorkers = await SecurityWorker.find({
    isActive: true, ...(scope ? { facilityIds: { $in: fids } } : {}),
    $or: [{ 'contract.until': { $gte: now, $lte: new Date(now.getTime() + contractDays * DAY) } }, { 'licenses.validUntil': { $gte: now, $lte: new Date(now.getTime() + licenseDays * DAY) } }]
  }).select('name role contract licenses').lean();
  const expiring = [];
  for (const w of expWorkers) {
    const until = w.contract && w.contract.until ? new Date(w.contract.until) : null;
    if (until && until >= now && until - now <= contractDays * DAY) expiring.push({ workerId: w._id, workerName: w.name, kind: 'contract', label: 'Ugovor', until, daysLeft: Math.ceil((until - now) / DAY) });
    for (const l of w.licenses || []) {
      const lu = l.validUntil ? new Date(l.validUntil) : null;
      if (licenseDays && lu && lu >= now && lu - now <= licenseDays * DAY) expiring.push({ workerId: w._id, workerName: w.name, kind: 'license', label: l.type, until: lu, daysLeft: Math.ceil((lu - now) / DAY) });
    }
  }
  expiring.sort((a, b) => a.until - b.until);

  res.json({
    now,
    window: { type: winType, date: winYmd, start: win.start, end: win.end },
    rules: { lateMin: s.alarms.lateMin, masterMin: s.alarms.masterMin, checkpointTolMin: s.alarms.checkpointTolMin, snoozeMin: s.alarms.snoozeMin },
    kpis: {
      facilities: facilities.length, onDuty, expected,
      openAlarms: alarms.length, criticalAlarms: alarms.filter((a) => a.level === 'critical' && a.state !== 'ack').length,
      roundsDone, roundsDue,
      reportsToday: reportsSent.filter((r) => new Date(r.report.sentAt) >= todayStart).length,
      unknownTags: unknownTags.length, draftsSoon: drafts
    },
    facilities: rows,
    alarms: alarms.map((a) => ({ ...a, facilityName: a.facilityName || fName.get(String(a.facilityId)) || '', workerPhone: a.workerId ? phoneOf.get(String(a.workerId)) || '' : '' })),
    feed,
    upcoming: upcoming.sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt)).slice(0, 12),
    todo: {
      unknownTags: unknownList.map((u) => ({ uid: u._id, at: u.at, facilityName: u.facilityName, workerName: u.workerName, count: u.count })),
      drafts: draftList.map((d) => ({ _id: d._id, facilityId: d.facilityId, facilityName: fName.get(String(d.facilityId)) || '', workerName: d.workerId ? d.workerId.name : '', label: shiftLabel(d), plannedStart: d.plannedStart })),
      expiring: expiring.slice(0, 12)
    }
  });
}));

module.exports = router;
