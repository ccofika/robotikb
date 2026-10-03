// Alarmi: dnevnik, preuzimanje i ručno rešavanje
const express = require('express');
const SecurityAlarm = require('../../models/SecurityAlarm');
const { isSecurityStaff, facilityFilter, canAccessFacility, isAdminRole } = require('../../middleware/securityAuth');
const { ah, httpError, requireId, str } = require('./helpers');

const router = express.Router();
router.use(isSecurityStaff);

// GET /api/security/alarms?state=open|all&facility=&kind=&limit=
router.get('/', ah(async (req, res) => {
  const q = { ...(await facilityFilter(req)) };
  if (!isAdminRole(req.user.role)) delete q.workerId;
  if (req.query.state !== 'all') q.state = { $in: ['open', 'snoozed', 'escalated', 'ack'] };
  if (req.query.facility) {
    requireId(req.query.facility, 'objekat');
    // filter po objektu ne sme da zaobiđe prava koordinatora (vidi samo svoje objekte)
    if (!(await canAccessFacility(req, req.query.facility))) throw httpError(403, 'Nemate pristup ovom objektu.');
    q.facilityId = req.query.facility;
  }
  if (req.query.kind) q.kind = { $in: String(req.query.kind).split(',') };
  // Istek ugovora/licence nema objekat: vide ga samo admini
  if (!isAdminRole(req.user.role)) q.kind = q.kind || { $nin: ['contract', 'license'] };
  const limit = Math.min(300, Math.max(10, Number(req.query.limit) || 100));
  const list = await SecurityAlarm.find(q).sort({ firedAt: -1 }).limit(limit).lean();
  res.json(list);
}));

async function loadAlarm(req) {
  requireId(req.params.id, 'alarm');
  const a = await SecurityAlarm.findById(req.params.id);
  if (!a) throw httpError(404, 'Alarm nije pronađen.');
  if (a.facilityId && !(await canAccessFacility(req, a.facilityId))) throw httpError(403, 'Nemate pristup ovom alarmu.');
  if (!a.facilityId && !isAdminRole(req.user.role)) throw httpError(403, 'Nemate pristup ovom alarmu.');
  return a;
}

// POST /api/security/alarms/:id/ack  (neko je preuzeo alarm i reaguje)
// Preuzimanje i rešavanje su atomski: ako je alarm u istoj sekundi rešen (radnik je očitao tačku, drugi admin),
// preuzimanje ga ne vraća u "preuzet", a drugo rešavanje ne prepisuje prvo.
const resolvedMsg = (a) => `Alarm je već rešen${a && a.resolution ? `: ${a.resolution}` : ''}.`;

router.post('/:id/ack', ah(async (req, res) => {
  const a = await loadAlarm(req);
  if (a.state === 'resolved') throw httpError(409, resolvedMsg(a));
  if (a.state === 'ack') return res.json(a);
  const upd = await SecurityAlarm.findOneAndUpdate(
    { _id: a._id, state: { $in: ['open', 'snoozed', 'escalated'] } },
    { $set: { state: 'ack', ackById: req.user._id, ackByName: req.user.name, ackAt: new Date() } },
    { new: true }
  );
  if (upd) return res.json(upd);
  const cur = await SecurityAlarm.findById(a._id);
  if (!cur || cur.state === 'resolved') throw httpError(409, resolvedMsg(cur));
  res.json(cur);
}));

// POST /api/security/alarms/:id/resolve { note }
router.post('/:id/resolve', ah(async (req, res) => {
  const a = await loadAlarm(req);
  const note = str(req.body.note, 500);
  if (note.length < 3) throw httpError(400, 'Upiši kako je alarm rešen.');
  const now = new Date();
  const upd = await SecurityAlarm.findOneAndUpdate(
    { _id: a._id, state: { $ne: 'resolved' } },
    { $set: { state: 'resolved', resolvedAt: now, resolution: `${note} (${req.user.name})` } },
    { new: true }
  );
  if (!upd) throw httpError(409, resolvedMsg(await SecurityAlarm.findById(a._id)));
  if (!upd.ackAt) {
    await SecurityAlarm.updateOne({ _id: upd._id, ackAt: null }, { $set: { ackById: req.user._id, ackByName: req.user.name, ackAt: now } });
    upd.ackById = req.user._id; upd.ackByName = req.user.name; upd.ackAt = now;
  }
  res.json(upd);
}));

module.exports = router;
