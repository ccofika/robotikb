// Povremeni zadaci: izdaju se za tačno određenu smenu i vreme
const express = require('express');
const SecurityTask = require('../../models/SecurityTask');
const SecurityShift = require('../../models/SecurityShift');
const SecurityFacility = require('../../models/SecurityFacility');
const SecurityWorker = require('../../models/SecurityWorker');
const { isSecurityStaff, facilityFilter, canAccessFacility } = require('../../middleware/securityAuth');
const { pushToWorker } = require('../../services/security/notify');
const { localToInstant, addDaysYmd } = require('../../services/security/time');
const { hm } = require('../../services/security/events');
const { ah, httpError, requireId, str, isYmd, isHHMM } = require('./helpers');

const router = express.Router();
router.use(isSecurityStaff);

// GET /api/security/tasks?facility=&from=&to=&status=
router.get('/', ah(async (req, res) => {
  const q = { ...(await facilityFilter(req)) };
  if (req.query.facility) { requireId(req.query.facility, 'objekat'); if (!(await canAccessFacility(req, req.query.facility))) throw httpError(403, 'Nemate pristup.'); q.facilityId = req.query.facility; }
  if (req.query.status) q.status = req.query.status;
  if (isYmd(req.query.from) || isYmd(req.query.to)) {
    q.dueAt = {};
    if (isYmd(req.query.from)) q.dueAt.$gte = localToInstant(req.query.from, '00:00');
    if (isYmd(req.query.to)) q.dueAt.$lt = localToInstant(addDaysYmd(req.query.to, 1), '00:00');
  }
  res.json(await SecurityTask.find(q).sort({ dueAt: 1 }).limit(300).lean());
}));

// POST /api/security/tasks { facilityId, date, time, text }  ili { shiftId, time, text }
router.post('/', ah(async (req, res) => {
  const b = req.body || {};
  const text = str(b.text, 600);
  if (text.length < 3) throw httpError(400, 'Upiši zadatak.');
  let facilityId = b.facilityId, dueAt = null, shift = null;
  if (b.shiftId) {
    requireId(b.shiftId, 'smena');
    shift = await SecurityShift.findById(b.shiftId);
    if (!shift) throw httpError(404, 'Smena nije pronađena.');
    facilityId = shift.facilityId;
    if (!isHHMM(b.time)) throw httpError(400, 'Izaberi vreme zadatka.');
    // vreme unutar smene (noćna smena prelazi ponoć)
    const cands = [0, 1].map((k) => localToInstant(addDaysYmd(shift.date, k), b.time));
    dueAt = cands.find((c) => c >= shift.plannedStart && c <= shift.plannedEnd);
    if (!dueAt) throw httpError(400, `Vreme ${b.time} nije u toku ove smene.`);
  } else {
    requireId(facilityId, 'objekat');
    if (!isYmd(b.date) || !isHHMM(b.time)) throw httpError(400, 'Izaberi datum i vreme zadatka.');
    dueAt = localToInstant(b.date, b.time);
  }
  if (!(await canAccessFacility(req, facilityId))) throw httpError(403, 'Nemate pristup ovom objektu.');
  const facility = await SecurityFacility.findById(facilityId);
  if (!facility) throw httpError(404, 'Objekat nije pronađen.');
  if (!shift) shift = await SecurityShift.findOne({ facilityId, status: { $in: ['planned', 'active'] }, plannedStart: { $lte: dueAt }, plannedEnd: { $gte: dueAt } });
  const task = await SecurityTask.create({ facilityId, shiftId: shift ? shift._id : null, dueAt, text, createdById: req.user._id, createdByName: req.user.name });
  let notified = false;
  if (shift && shift.published) {
    const w = await SecurityWorker.findById(shift.workerId);
    if (w) { const r = await pushToWorker(w, { title: `Novi zadatak za ${hm(dueAt)}`, body: text, data: { type: 'security_task', taskId: String(task._id) }, channelId: 'default' }); notified = r.sent; }
  }
  res.status(201).json({ ...task.toObject(), shiftFound: !!shift, notified });
}));

// PUT /api/security/tasks/:id { text }
router.put('/:id', ah(async (req, res) => {
  requireId(req.params.id, 'zadatak');
  const t = await SecurityTask.findById(req.params.id);
  if (!t) throw httpError(404, 'Zadatak nije pronađen.');
  if (!(await canAccessFacility(req, t.facilityId))) throw httpError(403, 'Nemate pristup.');
  if (t.status !== 'open') throw httpError(409, 'Urađen zadatak se ne menja.');
  const text = str(req.body.text, 600);
  if (text.length < 3) throw httpError(400, 'Upiši zadatak.');
  t.text = text;
  await t.save();
  res.json(t);
}));

// DELETE /api/security/tasks/:id  (otkazivanje)
router.delete('/:id', ah(async (req, res) => {
  requireId(req.params.id, 'zadatak');
  const t = await SecurityTask.findById(req.params.id);
  if (!t) throw httpError(404, 'Zadatak nije pronađen.');
  if (!(await canAccessFacility(req, t.facilityId))) throw httpError(403, 'Nemate pristup.');
  if (t.status === 'done') throw httpError(409, 'Urađen zadatak ne može da se otkaže.');
  t.status = 'cancelled';
  await t.save();
  res.json({ ok: true });
}));

module.exports = router;
