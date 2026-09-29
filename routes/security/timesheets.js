// Satnica: mesečni obračun po radniku (samo administratori)
const express = require('express');
const SecurityWorker = require('../../models/SecurityWorker');
const { isSecurityAdmin } = require('../../middleware/securityAuth');
const { computeTimesheet } = require('../../services/security/payService');
const { getSettings } = require('../../services/security/settings');
const { todayYmd } = require('../../services/security/time');
const { ah, httpError, requireId } = require('./helpers');

const router = express.Router();
router.use(isSecurityAdmin);

// GET /api/security/timesheets?month=YYYY-MM&facility=
router.get('/', ah(async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : todayYmd().slice(0, 7);
  const scope = req.query.facility ? [requireId(req.query.facility, 'objekat')] : null;
  const settings = await getSettings();
  res.json(await computeTimesheet({ month, scope, settings }));
}));

// PUT /api/security/timesheets/rate { workerId, hourlyRate }  (null = podrazumevana satnica)
router.put('/rate', ah(async (req, res) => {
  requireId(req.body.workerId, 'radnik');
  const rate = req.body.hourlyRate === null || req.body.hourlyRate === '' ? null : Number(req.body.hourlyRate);
  if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 100000)) throw httpError(400, 'Neispravna satnica.');
  const w = await SecurityWorker.findByIdAndUpdate(req.body.workerId, { $set: { hourlyRate: rate } }, { new: true });
  if (!w) throw httpError(404, 'Radnik nije pronađen.');
  res.json({ ok: true, hourlyRate: w.hourlyRate });
}));

module.exports = router;
