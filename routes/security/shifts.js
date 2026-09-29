// Raspored smena: pregled po objektu ili radniku, dodavanje, zamena radnika, brisanje, objava, ručna prijava/odjava
const express = require('express');
const SecurityShift = require('../../models/SecurityShift');
const SecurityWorker = require('../../models/SecurityWorker');
const SecurityFacility = require('../../models/SecurityFacility');
const SecurityScan = require('../../models/SecurityScan');
const SecurityAlarm = require('../../models/SecurityAlarm');
const SecurityObservation = require('../../models/SecurityObservation');
const SecurityTask = require('../../models/SecurityTask');
const { isSecurityStaff, facilityScope, canAccessFacility } = require('../../middleware/securityAuth');
const { getSettings, rulesFor } = require('../../services/security/settings');
const { shiftWindow, localToInstant, addDaysYmd, instantToLocal } = require('../../services/security/time');
const { checkConflicts, describeConflict, buildRounds, shiftLabel } = require('../../services/security/shiftService');
const { pushToWorker } = require('../../services/security/notify');
const { resolveAlarms, addDossier, hm } = require('../../services/security/events');
const { ah, httpError, requireId, str, isYmd } = require('./helpers');

const router = express.Router();
router.use(isSecurityStaff);

async function assertFacility(req, facilityId) {
  requireId(facilityId, 'objekat');
  if (!(await canAccessFacility(req, facilityId))) throw httpError(403, 'Nemate pristup ovom objektu.');
  const f = await SecurityFacility.findById(facilityId);
  if (!f) throw httpError(404, 'Objekat nije pronađen.');
  return f;
}

// GET /api/security/shifts?facility=&worker=&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/', ah(async (req, res) => {
  const scope = await facilityScope(req);
  const q = { status: { $ne: 'cancelled' } };
  if (req.query.facility) { requireId(req.query.facility, 'objekat'); q.facilityId = req.query.facility; }
  if (req.query.worker) { requireId(req.query.worker, 'radnik'); q.workerId = req.query.worker; }
  if (scope) q.facilityId = q.facilityId ? (scope.includes(String(q.facilityId)) ? q.facilityId : null) : { $in: scope };
  const from = isYmd(req.query.from) ? req.query.from : null;
  const to = isYmd(req.query.to) ? req.query.to : null;
  if (from || to) {
    q.plannedStart = {};
    if (from) q.plannedStart.$gte = localToInstant(from, '00:00');
    if (to) q.plannedStart.$lt = localToInstant(addDaysYmd(to, 1), '00:00');
  }
  const list = await SecurityShift.find(q).populate('workerId', 'name role isActive').populate('facilityId', 'name').sort({ plannedStart: 1 }).limit(2000).lean();
  res.json(list.map((s) => ({
    _id: s._id, date: s.date, type: s.type, plannedStart: s.plannedStart, plannedEnd: s.plannedEnd,
    status: s.status, published: s.published, note: s.note,
    worker: s.workerId ? { _id: s.workerId._id, name: s.workerId.name } : null,
    facility: s.facilityId ? { _id: s.facilityId._id, name: s.facilityId.name } : null,
    clockIn: s.clockIn ? s.clockIn.at : null, clockOut: s.clockOut ? s.clockOut.at : null,
    lateMin: s.lateMin, roundsDone: (s.rounds || []).filter((r) => r.scannedAt).length, roundsTotal: (s.rounds || []).length
  })));
}));

// Pravi jednu smenu (sa proverom preklapanja i odmora). Vraća { shift } ili baca grešku.
async function createShift(req, { facilityId, workerId, date, type, force, note }, settings) {
  const facility = await assertFacility(req, facilityId);
  requireId(workerId, 'radnik');
  if (!isYmd(date)) throw httpError(400, 'Neispravan datum.');
  if (!['day', 'night'].includes(type)) throw httpError(400, 'Smena može biti dnevna ili noćna.');
  const worker = await SecurityWorker.findById(workerId);
  if (!worker || worker.role !== 'guard') throw httpError(404, 'Radnik nije pronađen.');
  if (!worker.isActive) throw httpError(400, `${worker.name} je deaktiviran.`);
  if (!worker.facilityIds.some((f) => String(f) === String(facility._id))) {
    throw httpError(409, `${worker.name} nije dodeljen objektu ${facility.name}.`, { code: 'not_assigned', workerName: worker.name, facilityName: facility.name });
  }
  const { start, end } = shiftWindow(date, type, settings);
  const conf = await checkConflicts({ workerId, start, end });
  if (conf.overlap) throw httpError(409, describeConflict(conf, worker.name).message, { code: 'overlap' });
  if (conf.rest.length && !force) throw httpError(409, describeConflict(conf, worker.name).message, { code: 'rest', canForce: true });
  const shift = await SecurityShift.create({
    facilityId, workerId, date, type, plannedStart: start, plannedEnd: end, note: str(note, 300),
    createdById: req.user._id, createdByName: req.user.name
  });
  return shift;
}

// POST /api/security/shifts { facilityId, workerId, date, type, force? }
router.post('/', ah(async (req, res) => {
  const s = await getSettings();
  const shift = await createShift(req, req.body || {}, s);
  res.status(201).json(shift);
}));

// POST /api/security/shifts/bulk { items: [{facilityId, workerId, date, type}], force? }  (kopiranje nedelje, ciklus)
router.post('/bulk', ah(async (req, res) => {
  const s = await getSettings();
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 400) : [];
  const results = [];
  for (const it of items) {
    try {
      const sh = await createShift(req, { ...it, force: req.body.force === true }, s);
      results.push({ ok: true, id: sh._id, date: it.date, type: it.type, workerId: it.workerId });
    } catch (e) {
      results.push({ ok: false, date: it.date, type: it.type, workerId: it.workerId, error: e.message, code: e.extra && e.extra.code });
    }
  }
  res.json({ created: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
}));

// POST /api/security/shifts/publish { facilityId, from, to }
router.post('/publish', ah(async (req, res) => {
  const facility = await assertFacility(req, req.body.facilityId);
  const from = isYmd(req.body.from) ? req.body.from : null;
  const to = isYmd(req.body.to) ? req.body.to : null;
  if (!from || !to) throw httpError(400, 'Izaberi period za objavu.');
  const q = { facilityId: facility._id, published: false, status: 'planned', plannedStart: { $gte: localToInstant(from, '00:00'), $lt: localToInstant(addDaysYmd(to, 1), '00:00') } };
  const drafts = await SecurityShift.find(q).select('workerId');
  if (!drafts.length) return res.json({ published: 0, notified: 0 });
  await SecurityShift.updateMany(q, { $set: { published: true, publishedAt: new Date() } });
  const workerIds = [...new Set(drafts.map((d) => String(d.workerId)))];
  const workers = await SecurityWorker.find({ _id: { $in: workerIds } });
  for (const w of workers) {
    const n = drafts.filter((d) => String(d.workerId) === String(w._id)).length;
    await pushToWorker(w, { title: 'Raspored je objavljen', body: `${facility.name}: ${n} ${n === 1 ? 'nova smena' : 'novih smena'} od ${from.split('-').reverse().join('.')}. Pogledaj raspored.`, data: { type: 'security_schedule' }, channelId: 'default' });
  }
  res.json({ published: drafts.length, notified: workers.length });
}));

async function loadShift(req) {
  requireId(req.params.id, 'smena');
  const sh = await SecurityShift.findById(req.params.id);
  if (!sh) throw httpError(404, 'Smena nije pronađena.');
  if (!(await canAccessFacility(req, sh.facilityId))) throw httpError(403, 'Nemate pristup ovoj smeni.');
  return sh;
}

// GET /api/security/shifts/:id  (detalji smene za admin)
router.get('/:id', ah(async (req, res) => {
  const sh = await loadShift(req);
  await sh.populate('workerId', 'name phone');
  await sh.populate('facilityId', 'name standingTasks rules');
  const [scans, alarms, notes, tasks] = await Promise.all([
    SecurityScan.find({ shiftId: sh._id }).sort({ at: 1 }).lean(),
    SecurityAlarm.find({ shiftId: sh._id }).sort({ firedAt: 1 }).lean(),
    SecurityObservation.find({ shiftId: sh._id }).sort({ at: 1 }).lean(),
    SecurityTask.find({ facilityId: sh.facilityId._id, $or: [{ shiftId: sh._id }, { shiftId: null, dueAt: { $gte: sh.plannedStart, $lte: sh.plannedEnd } }] }).sort({ dueAt: 1 }).lean()
  ]);
  const r = rulesFor(await getSettings(), sh.facilityId);
  res.json({ ...sh.toObject(), label: shiftLabel(sh), scans, alarms, notes, tasks, rules: { checkpointTolMin: r.checkpointTolMin, snoozeMin: r.snoozeMin } });
}));

// PUT /api/security/shifts/:id { workerId?, note?, force? }  (zamena radnika)
router.put('/:id', ah(async (req, res) => {
  const sh = await loadShift(req);
  const b = req.body || {};
  if (b.note !== undefined) sh.note = str(b.note, 300);
  if (b.workerId && String(b.workerId) !== String(sh.workerId)) {
    if (sh.status !== 'planned') throw httpError(409, 'Smena je već počela. Zamena više nije moguća, zatvori smenu ručno.');
    requireId(b.workerId, 'radnik');
    const [to, from, facility] = await Promise.all([SecurityWorker.findById(b.workerId), SecurityWorker.findById(sh.workerId), SecurityFacility.findById(sh.facilityId)]);
    if (!to || to.role !== 'guard' || !to.isActive) throw httpError(404, 'Radnik nije pronađen ili nije aktivan.');
    if (!to.facilityIds.some((f) => String(f) === String(sh.facilityId))) {
      if (b.assign === true) await SecurityWorker.updateOne({ _id: to._id }, { $addToSet: { facilityIds: sh.facilityId } });
      else throw httpError(409, `${to.name} nije dodeljen objektu ${facility.name}.`, { code: 'not_assigned', workerName: to.name, facilityName: facility.name });
    }
    const conf = await checkConflicts({ workerId: to._id, start: sh.plannedStart, end: sh.plannedEnd, excludeId: sh._id });
    if (conf.overlap) throw httpError(409, describeConflict(conf, to.name).message, { code: 'overlap' });
    if (conf.rest.length && !b.force) throw httpError(409, describeConflict(conf, to.name).message, { code: 'rest', canForce: true });
    sh.replaced.push({ fromWorkerId: sh.workerId, fromName: from ? from.name : '', toName: to.name, at: new Date(), byName: req.user.name });
    sh.workerId = to._id;
    sh.alarms = { lateAt: null, masterAt: null, noClockOutAt: null };
    await resolveAlarms({ shiftId: sh._id, kind: { $in: ['late', 'master'] } }, `Zamena: ${to.name}`);
    if (sh.published) {
      await pushToWorker(to, { title: 'Nova smena (zamena)', body: `${facility.name}: ${shiftLabel(sh)}, ${sh.date.split('-').reverse().join('.')}.`, data: { type: 'security_schedule' }, channelId: 'default' });
      if (from) await pushToWorker(from, { title: 'Smena je promenjena', body: `${facility.name}: ${shiftLabel(sh)}, ${sh.date.split('-').reverse().join('.')} preuzima ${to.name}.`, data: { type: 'security_schedule' }, channelId: 'default' });
    }
  }
  await sh.save();
  res.json(sh);
}));

// DELETE /api/security/shifts/:id  (samo smena koja nije počela)
router.delete('/:id', ah(async (req, res) => {
  const sh = await loadShift(req);
  if (sh.clockIn) throw httpError(409, 'Smena je već počela i ne može se obrisati.');
  const worker = await SecurityWorker.findById(sh.workerId);
  const facility = await SecurityFacility.findById(sh.facilityId);
  await resolveAlarms({ shiftId: sh._id }, 'Smena obrisana');
  await sh.deleteOne();
  if (sh.published && worker) {
    await pushToWorker(worker, { title: 'Smena je otkazana', body: `${facility ? facility.name : ''}: ${shiftLabel(sh)}, ${sh.date.split('-').reverse().join('.')}.`, data: { type: 'security_schedule' }, channelId: 'default' });
  }
  res.json({ ok: true });
}));

// POST /api/security/shifts/:id/manual { type: 'in'|'out', time: 'HH:mm', note }
// Kad telefon ili tag ne rade: koordinator ili admin upisuje prijavu ili odjavu, uz napomenu
router.post('/:id/manual', ah(async (req, res) => {
  const sh = await loadShift(req);
  const b = req.body || {};
  const note = str(b.note, 300);
  if (note.length < 3) throw httpError(400, 'Upiši razlog ručnog upisa.');
  const s = await getSettings();
  const facility = await SecurityFacility.findById(sh.facilityId);
  let at = new Date();
  if (b.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.time)) {
    // Vreme (HH:mm) pretvaramo u trenutak najbliži početku (prijava) ili kraju (odjava) smene
    const startYmd = instantToLocal(sh.plannedStart).ymd;
    const anchor = (b.type === 'out' ? sh.plannedEnd : sh.plannedStart).getTime();
    at = [-1, 0, 1, 2].map((k) => localToInstant(addDaysYmd(startYmd, k), b.time))
      .sort((x, y) => Math.abs(x.getTime() - anchor) - Math.abs(y.getTime() - anchor))[0];
  }
  if (at.getTime() > Date.now() + 5 * 60000) throw httpError(400, 'Vreme ne može biti u budućnosti.');
  const punch = { at, receivedAt: new Date(), source: 'manual', byName: req.user.name };
  if (b.type === 'in') {
    if (sh.clockIn) throw httpError(409, 'Radnik je već prijavljen.');
    const lateMin = Math.max(0, Math.floor((at - sh.plannedStart) / 60000));
    sh.clockIn = punch; sh.status = 'active'; sh.lateMin = lateMin;
    sh.rounds = await buildRounds(sh, facility, s);
    await sh.save();
    await resolveAlarms({ shiftId: sh._id, kind: { $in: ['late', 'master'] } }, `Ručna prijava (${req.user.name})`);
    await addDossier({ workerId: sh.workerId, kind: lateMin ? 'late' : 'note', level: lateMin ? 'warn' : 'info', facility, shiftId: sh._id, byName: req.user.name, text: `Ručna prijava u ${hm(at)} (${req.user.name}): ${note}${lateMin ? `. Kašnjenje ${lateMin} min.` : ''}` });
  } else if (b.type === 'out') {
    if (!sh.clockIn) throw httpError(409, 'Radnik nije prijavljen.');
    if (sh.clockOut) throw httpError(409, 'Radnik je već odjavljen.');
    const early = at.getTime() < sh.plannedEnd.getTime() - 30 * 60000;
    sh.clockOut = { ...punch, early }; sh.status = 'done'; sh.earlyLeaveMin = early ? Math.floor((sh.plannedEnd - at) / 60000) : 0;
    await sh.save();
    await resolveAlarms({ shiftId: sh._id, kind: 'no_clock_out' }, `Ručna odjava (${req.user.name})`);
    await addDossier({ workerId: sh.workerId, kind: 'note', level: 'info', facility, shiftId: sh._id, byName: req.user.name, text: `Ručna odjava u ${hm(at)} (${req.user.name}): ${note}` });
    setImmediate(() => require('../../services/security/reportService').sendShiftReport(sh._id, { reason: 'manual' }).catch(() => {}));
  } else throw httpError(400, 'Izaberi prijavu ili odjavu.');
  res.json(sh);
}));

// PUT /api/security/shifts/:id/review { remark, note }  (kontrola izveštaja)
router.put('/:id/review', ah(async (req, res) => {
  const sh = await loadShift(req);
  sh.review = { byId: req.user._id, byName: req.user.name, at: new Date(), remark: !!req.body.remark, note: str(req.body.note, 500) };
  await sh.save();
  res.json(sh);
}));

module.exports = router;
