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
  if (req.query.facility) { requireId(req.query.facility, 'objekat'); q.facilityId = req.query.facility; }
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
router.post('/:id/ack', ah(async (req, res) => {
  const a = await loadAlarm(req);
  if (a.state === 'resolved') throw httpError(409, 'Alarm je već rešen.');
  if (a.state !== 'ack') {
    a.state = 'ack'; a.ackById = req.user._id; a.ackByName = req.user.name; a.ackAt = new Date();
    await a.save();
  }
  res.json(a);
}));

// POST /api/security/alarms/:id/resolve { note }
router.post('/:id/resolve', ah(async (req, res) => {
  const a = await loadAlarm(req);
  const note = str(req.body.note, 500);
  if (note.length < 3) throw httpError(400, 'Upiši kako je alarm rešen.');
  a.state = 'resolved'; a.resolvedAt = new Date(); a.resolution = `${note} (${req.user.name})`;
  if (!a.ackAt) { a.ackById = req.user._id; a.ackByName = req.user.name; a.ackAt = new Date(); }
  await a.save();
  res.json(a);
}));

module.exports = router;
