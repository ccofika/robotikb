// Rute za radnika obezbeđenja (Android aplikacija): trenutna smena, skeniranje, zadaci, zapažanja, raspored
const express = require('express');
const multer = require('multer');
const SecurityWorker = require('../../models/SecurityWorker');
const SecurityShift = require('../../models/SecurityShift');
const SecurityFacility = require('../../models/SecurityFacility');
const SecurityTask = require('../../models/SecurityTask');
const SecurityAlarm = require('../../models/SecurityAlarm');
const SecurityObservation = require('../../models/SecurityObservation');
const NfcTag = require('../../models/NfcTag');
const { isGuard } = require('../../middleware/securityAuth');
const { processScan } = require('../../services/security/scanService');
const { getSettings, rulesFor } = require('../../services/security/settings');
const { shiftLabel } = require('../../services/security/shiftService');
const { saveFile } = require('../../services/security/storage');
const { addDossier, hm } = require('../../services/security/events');
const { adminRecipients, coordinatorsOf, webNotify } = require('../../services/security/notify');
const { localToInstant, addDaysYmd, todayYmd } = require('../../services/security/time');
const { ah, httpError, requireId, str } = require('./helpers');

const router = express.Router();
router.use(isGuard);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 6 } });

const ALARM_KINDS = ['late', 'master', 'checkpoint1', 'checkpoint2', 'no_clock_out'];
const POWERS = ['Provera identiteta', 'Upozorenje i naređenje', 'Zabrana ulaska ili izlaska', 'Privremeno zadržavanje lica', 'Pregled lica, predmeta i prtljaga', 'Upotreba fizičke snage', 'Upotreba sredstava za vezivanje', 'Drugo'];

const me = async (req) => {
  const w = await SecurityWorker.findById(req.user.id);
  if (!w) throw httpError(401, 'Nalog nije pronađen.');
  return w;
};

async function myShift(req, id) {
  requireId(id, 'smena');
  const sh = await SecurityShift.findOne({ _id: id, workerId: req.user.id });
  if (!sh) throw httpError(404, 'Smena nije pronađena.');
  return sh;
}

async function pickCurrent(workerId, now) {
  const active = await SecurityShift.findOne({ workerId, status: 'active' }).sort({ plannedStart: -1 });
  if (active) return active;
  const soon = await SecurityShift.findOne({ workerId, published: true, status: 'planned', plannedStart: { $lte: new Date(now.getTime() + 12 * 3600000) }, plannedEnd: { $gte: now } }).sort({ plannedStart: 1 });
  if (soon) return soon;
  return SecurityShift.findOne({ workerId, status: { $in: ['done', 'missed'] }, plannedEnd: { $gte: new Date(now.getTime() - 3 * 3600000) } }).sort({ plannedEnd: -1 });
}

async function shiftPayload(sh, settings) {
  const facility = await SecurityFacility.findById(sh.facilityId).lean();
  const rules = rulesFor(settings, facility);
  const [tags, tasks, notes, coords] = await Promise.all([
    NfcTag.find({ facilityId: sh.facilityId, status: 'active' }).select('name category location uid').sort({ category: -1, name: 1 }).lean(),
    SecurityTask.find({ facilityId: sh.facilityId, status: { $ne: 'cancelled' }, $or: [{ shiftId: sh._id }, { shiftId: null, dueAt: { $gte: sh.plannedStart, $lte: sh.plannedEnd } }] }).sort({ dueAt: 1 }).lean(),
    SecurityObservation.find({ shiftId: sh._id }).sort({ at: -1 }).lean(),
    coordinatorsOf(sh.facilityId)
  ]);
  return {
    _id: sh._id, date: sh.date, type: sh.type, label: shiftLabel(sh),
    plannedStart: sh.plannedStart, plannedEnd: sh.plannedEnd, status: sh.status, published: sh.published,
    lateMin: sh.lateMin, earlyLeaveMin: sh.earlyLeaveMin,
    clockIn: sh.clockIn ? { at: sh.clockIn.at, source: sh.clockIn.source, offline: sh.clockIn.offline } : null,
    clockOut: sh.clockOut ? { at: sh.clockOut.at, early: sh.clockOut.early } : null,
    facility: facility ? {
      _id: facility._id, name: facility.name, address: [facility.address, facility.city].filter(Boolean).join(', '),
      instructions: facility.instructions, contactName: facility.contactName, contactPhone: facility.contactPhone,
      coordinators: coords.map((c) => ({ name: c.name, phone: c.phone || '' }))
    } : null,
    rules: { checkpointTolMin: rules.checkpointTolMin, snoozeMin: rules.snoozeMin, maxSnoozes: rules.maxSnoozes },
    rounds: (sh.rounds || []).map((r, index) => ({ index, tagId: r.tagId, tagName: r.tagName, dueAt: r.dueAt, scannedAt: r.scannedAt, lateMin: r.lateMin, alarm1At: r.alarm1At, alarm2At: r.alarm2At, snoozedUntil: r.snoozedUntil, snoozes: r.snoozes || [] })),
    plannedRounds: !sh.rounds.length && facility ? ((facility.roundPlan || {})[sh.type] || []).length : 0,
    standing: ((facility && facility.standingTasks) || []).map((t) => {
      const d = (sh.standingDone || []).find((x) => String(x.taskId) === String(t._id));
      return { _id: t._id, text: t.text, requireComment: !!t.requireComment, done: !!d, doneAt: d ? d.doneAt : null, comment: d ? d.comment : '' };
    }),
    occasional: tasks.map((t) => ({ _id: t._id, text: t.text, dueAt: t.dueAt, status: t.status, doneAt: t.doneAt, comment: t.comment, createdByName: t.createdByName })),
    notes: notes.map((n) => ({ _id: n._id, kind: n.kind, text: n.text, power: n.power, subject: n.subject, at: n.at, photos: n.photos })),
    handover: sh.handover || null,
    tags: tags.map((t) => ({ _id: t._id, name: t.name, category: t.category, location: t.location, uid: t.uid }))
  };
}

// GET /api/security/me/current
router.get('/current', ah(async (req, res) => {
  const now = new Date();
  const [w, settings] = await Promise.all([me(req), getSettings()]);
  await w.populate('facilityIds', 'name');
  const cur = await pickCurrent(w._id, now);
  const next = await SecurityShift.findOne({ workerId: w._id, published: true, status: 'planned', plannedStart: { $gt: cur && cur.status === 'planned' ? cur.plannedStart : now } })
    .sort({ plannedStart: 1 }).populate('facilityId', 'name').lean();
  const alarms = await SecurityAlarm.find({ workerId: w._id, kind: { $in: ALARM_KINDS }, state: { $in: ['open', 'snoozed', 'escalated', 'ack'] }, firedAt: { $gte: new Date(now.getTime() - 24 * 3600000) } }).sort({ firedAt: -1 }).lean();
  res.json({
    serverTime: now,
    settings: { dayStart: settings.dayStart, nightStart: settings.nightStart, earlyClockInMin: settings.alarms.earlyClockInMin, lateMin: settings.alarms.lateMin, masterMin: settings.alarms.masterMin },
    worker: { _id: w._id, name: w.name, phone: w.phone, facilities: w.facilityIds.map((f) => ({ _id: f._id, name: f.name })) },
    shift: cur ? await shiftPayload(cur, settings) : null,
    nextShift: next ? { _id: next._id, date: next.date, type: next.type, label: shiftLabel(next), plannedStart: next.plannedStart, plannedEnd: next.plannedEnd, facilityName: next.facilityId ? next.facilityId.name : '' } : null,
    alarms: alarms.map((a) => ({ _id: a._id, kind: a.kind, level: a.level, title: a.title, message: a.message, firedAt: a.firedAt, state: a.state, roundIndex: a.roundIndex, tagName: a.tagName, snoozes: a.snoozes || [], shiftId: a.shiftId }))
  });
}));

// GET /api/security/me/shifts?days=30  (30 dana unazad i 30 unapred, samo objavljene smene)
router.get('/shifts', ah(async (req, res) => {
  const days = Math.min(60, Math.max(7, Number(req.query.days) || 30));
  const today = todayYmd();
  const list = await SecurityShift.find({
    workerId: req.user.id, published: true, status: { $ne: 'cancelled' },
    plannedStart: { $gte: localToInstant(addDaysYmd(today, -days), '00:00'), $lt: localToInstant(addDaysYmd(today, days + 1), '00:00') }
  }).populate('facilityId', 'name').sort({ plannedStart: 1 }).lean();
  res.json(list.map((s) => ({
    _id: s._id, date: s.date, type: s.type, label: shiftLabel(s), plannedStart: s.plannedStart, plannedEnd: s.plannedEnd,
    status: s.status, facilityName: s.facilityId ? s.facilityId.name : '', clockIn: s.clockIn ? s.clockIn.at : null, clockOut: s.clockOut ? s.clockOut.at : null,
    lateMin: s.lateMin
  })));
}));

// POST /api/security/me/scans { uid, deviceAt, offline, geo, source, clientId, confirmEarly }
router.post('/scans', ah(async (req, res) => {
  const w = await me(req);
  const result = await processScan(w, req.body || {});
  res.json(result);
}));

// POST /api/security/me/shifts/:id/standing/:taskId { comment }  (stalni zadatak)
router.post('/shifts/:id/standing/:taskId', ah(async (req, res) => {
  const sh = await myShift(req, req.params.id);
  if (sh.status !== 'active') throw httpError(409, 'Zadaci se označavaju tokom smene.');
  const facility = await SecurityFacility.findById(sh.facilityId);
  const task = facility && facility.standingTasks.id(req.params.taskId);
  if (!task) throw httpError(404, 'Zadatak nije pronađen.');
  const comment = str(req.body.comment, 1000);
  if (task.requireComment && comment.length < 2) throw httpError(400, 'Za ovaj zadatak je komentar obavezan.');
  sh.standingDone = (sh.standingDone || []).filter((d) => String(d.taskId) !== String(task._id));
  sh.standingDone.push({ taskId: task._id, text: task.text, doneAt: new Date(), comment });
  await sh.save();
  res.json({ ok: true });
}));

router.delete('/shifts/:id/standing/:taskId', ah(async (req, res) => {
  const sh = await myShift(req, req.params.id);
  if (sh.status !== 'active') throw httpError(409, 'Smena nije aktivna.');
  sh.standingDone = (sh.standingDone || []).filter((d) => String(d.taskId) !== String(req.params.taskId));
  await sh.save();
  res.json({ ok: true });
}));

// POST /api/security/me/tasks/:id/done { comment }  (povremeni zadatak: komentar je uvek obavezan)
router.post('/tasks/:id/done', upload.array('photos', 4), ah(async (req, res) => {
  requireId(req.params.id, 'zadatak');
  const task = await SecurityTask.findById(req.params.id);
  if (!task) throw httpError(404, 'Zadatak nije pronađen.');
  const w = await me(req);
  if (!w.facilityIds.some((f) => String(f) === String(task.facilityId))) throw httpError(403, 'Zadatak nije za tvoj objekat.');
  if (task.status === 'done') throw httpError(409, 'Zadatak je već urađen.');
  const comment = str(req.body.comment, 1000);
  if (comment.length < 3) throw httpError(400, 'Upiši kratak komentar: šta je urađeno.');
  const photos = [];
  for (const f of req.files || []) photos.push(await saveFile(f, 'photos'));
  task.status = 'done'; task.doneAt = new Date(); task.doneById = w._id; task.doneByName = w.name; task.comment = comment; task.photos = photos;
  await task.save();
  res.json(task);
}));

// POST /api/security/me/shifts/:id/notes  (zapažanje ili izveštaj o primeni ovlašćenja, sa fotografijama)
router.post('/shifts/:id/notes', upload.array('photos', 6), ah(async (req, res) => {
  const sh = await myShift(req, req.params.id);
  const w = await me(req);
  const b = req.body || {};
  if (b.clientId) {
    const prev = await SecurityObservation.findOne({ clientId: b.clientId });
    if (prev) return res.json(prev);
  }
  const kind = b.kind === 'authority' ? 'authority' : 'observation';
  const text = str(b.text, 4000);
  if (text.length < 3) throw httpError(400, kind === 'authority' ? 'Opiši šta se desilo.' : 'Upiši zapažanje.');
  const power = kind === 'authority' ? str(b.power, 120) : '';
  if (kind === 'authority' && !power) throw httpError(400, 'Izaberi vrstu ovlašćenja.');
  const photos = [];
  for (const f of req.files || []) photos.push(await saveFile(f, 'photos'));
  const at = b.at && !isNaN(new Date(b.at).getTime()) && new Date(b.at) <= new Date() ? new Date(b.at) : new Date();
  const facility = await SecurityFacility.findById(sh.facilityId);
  const note = await SecurityObservation.create({
    kind, shiftId: sh._id, facilityId: sh.facilityId, facilityName: facility ? facility.name : '', workerId: w._id, workerName: w.name,
    at, clientId: b.clientId || null, text, power, subject: kind === 'authority' ? str(b.subject, 200) : '', witnesses: kind === 'authority' ? str(b.witnesses, 400) : '', photos
  });
  if (kind === 'authority') {
    const [admins, coords] = await Promise.all([adminRecipients(), coordinatorsOf(sh.facilityId)]);
    await webNotify([...coords, ...admins], {
      type: 'security_report', priority: 'high',
      title: `Primena ovlašćenja · ${facility ? facility.name : ''}`,
      message: `${w.name}: ${power}${note.subject ? `, lice: ${note.subject}` : ''}.`,
      targetPage: '/security', targetId: note._id
    });
  }
  res.status(201).json(note);
}));

// PUT /api/security/me/shifts/:id/handover { radio, items, condition, note }
router.put('/shifts/:id/handover', ah(async (req, res) => {
  const sh = await myShift(req, req.params.id);
  const b = req.body || {};
  const condition = b.condition === 'damaged' ? 'damaged' : 'ok';
  if (condition === 'damaged' && str(b.note, 500).length < 3) throw httpError(400, 'Opiši šta nije ispravno.');
  sh.handover = { radio: str(b.radio, 40), items: (Array.isArray(b.items) ? b.items : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 12), condition, note: str(b.note, 500), at: new Date() };
  await sh.save();
  res.json({ ok: true, handover: sh.handover });
}));

// POST /api/security/me/alarms/:id/snooze { reason }  (odlaganje alarma za checkpoint, razlog je obavezan)
router.post('/alarms/:id/snooze', ah(async (req, res) => {
  requireId(req.params.id, 'alarm');
  const alarm = await SecurityAlarm.findOne({ _id: req.params.id, workerId: req.user.id });
  if (!alarm) throw httpError(404, 'Alarm nije pronađen.');
  if (alarm.kind !== 'checkpoint1') throw httpError(409, 'Ovaj alarm ne može da se odloži.');
  if (!['open', 'snoozed'].includes(alarm.state)) throw httpError(409, 'Alarm više nije aktivan.');
  const reason = str(req.body.reason, 400);
  if (reason.length < 3) throw httpError(400, 'Razlog je obavezan.');
  const sh = await SecurityShift.findById(alarm.shiftId);
  const round = sh && sh.rounds[alarm.roundIndex];
  if (!round) throw httpError(404, 'Checkpoint nije pronađen.');
  if (round.scannedAt) throw httpError(409, 'Checkpoint je već očitan.');
  if (round.alarm2At) throw httpError(409, 'Drugi alarm je već aktiviran. Očitaj checkpoint.');
  const settings = await getSettings();
  const facility = await SecurityFacility.findById(sh.facilityId);
  const rules = rulesFor(settings, facility);
  if ((round.snoozes || []).length >= rules.maxSnoozes) throw httpError(409, 'Alarm je već odložen. Očitaj checkpoint.');
  const now = new Date();
  const until = new Date(now.getTime() + rules.snoozeMin * 60000);
  const i = alarm.roundIndex;
  const upd = await SecurityShift.updateOne(
    { _id: sh._id, [`rounds.${i}.scannedAt`]: null, [`rounds.${i}.alarm2At`]: null },
    { $set: { [`rounds.${i}.snoozedUntil`]: until }, $push: { [`rounds.${i}.snoozes`]: { at: now, until, reason } } }
  );
  if (!upd.modifiedCount) throw httpError(409, 'Alarm se u međuvremenu promenio. Osveži ekran.');
  alarm.state = 'snoozed';
  alarm.snoozes.push({ at: now, until, reason });
  await alarm.save();
  await addDossier({ workerId: req.user.id, kind: 'cp_snooze', level: 'warn', facility, shiftId: sh._id, alarmId: alarm._id, text: `Odložen alarm za ${round.tagName} (plan ${hm(round.dueAt)}) za ${rules.snoozeMin} min. Razlog: ${reason}.` });
  res.json({ ok: true, until });
}));

router.get('/powers', (req, res) => res.json(POWERS));

module.exports = router;
