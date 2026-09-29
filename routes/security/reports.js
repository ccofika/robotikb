// Izveštaji smena: lista, pregled, PDF, ponovno slanje
const express = require('express');
const SecurityShift = require('../../models/SecurityShift');
const SecurityObservation = require('../../models/SecurityObservation');
const { isSecurityStaff, facilityFilter, canAccessFacility } = require('../../middleware/securityAuth');
const { buildReportData, renderPdf, sendShiftReport } = require('../../services/security/reportService');
const { shiftLabel } = require('../../services/security/shiftService');
const { localToInstant, addDaysYmd } = require('../../services/security/time');
const { ah, httpError, requireId, isYmd, isEmail } = require('./helpers');

const router = express.Router();
router.use(isSecurityStaff);

// GET /api/security/reports?facility=&from=&to=&page=
router.get('/', ah(async (req, res) => {
  const q = { ...(await facilityFilter(req)), status: { $in: ['active', 'done', 'missed'] } };
  if (req.query.facility) { requireId(req.query.facility, 'objekat'); if (!(await canAccessFacility(req, req.query.facility))) throw httpError(403, 'Nemate pristup.'); q.facilityId = req.query.facility; }
  if (isYmd(req.query.from) || isYmd(req.query.to)) {
    q.plannedStart = {};
    if (isYmd(req.query.from)) q.plannedStart.$gte = localToInstant(req.query.from, '00:00');
    if (isYmd(req.query.to)) q.plannedStart.$lt = localToInstant(addDaysYmd(req.query.to, 1), '00:00');
  }
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 30;
  const [total, list] = await Promise.all([
    SecurityShift.countDocuments(q),
    SecurityShift.find(q).populate('workerId', 'name').populate('facilityId', 'name').sort({ plannedStart: -1 }).skip((page - 1) * limit).limit(limit).lean()
  ]);
  const authority = await SecurityObservation.aggregate([{ $match: { kind: 'authority', shiftId: { $in: list.map((s) => s._id) } } }, { $group: { _id: '$shiftId', n: { $sum: 1 } } }]);
  const aMap = new Map(authority.map((a) => [String(a._id), a.n]));
  res.json({
    total, page, pages: Math.ceil(total / limit),
    items: list.map((s) => ({
      _id: s._id, date: s.date, type: s.type, label: shiftLabel(s), status: s.status,
      facility: s.facilityId ? { _id: s.facilityId._id, name: s.facilityId.name } : null,
      worker: s.workerId ? { _id: s.workerId._id, name: s.workerId.name } : null,
      lateMin: s.lateMin, roundsDone: (s.rounds || []).filter((r) => r.scannedAt).length, roundsTotal: (s.rounds || []).length,
      authority: aMap.get(String(s._id)) || 0,
      report: s.report || {}, review: s.review && s.review.at ? s.review : null
    }))
  });
}));

async function checkAccess(req) {
  requireId(req.params.shiftId, 'smena');
  const sh = await SecurityShift.findById(req.params.shiftId).select('facilityId');
  if (!sh) throw httpError(404, 'Smena nije pronađena.');
  if (!(await canAccessFacility(req, sh.facilityId))) throw httpError(403, 'Nemate pristup.');
}

router.get('/:shiftId', ah(async (req, res) => {
  await checkAccess(req);
  res.json(await buildReportData(req.params.shiftId));
}));

router.get('/:shiftId/pdf', ah(async (req, res) => {
  await checkAccess(req);
  const d = await buildReportData(req.params.shiftId);
  const pdf = await renderPdf(d);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="dnevnik-rada-${d.date.replace(/\./g, '-')}.pdf"`);
  res.send(pdf);
}));

// POST /api/security/reports/:shiftId/send { emails? }
router.post('/:shiftId/send', ah(async (req, res) => {
  await checkAccess(req);
  const to = Array.isArray(req.body.emails) ? req.body.emails.map((e) => String(e).trim().toLowerCase()).filter(isEmail) : undefined;
  const r = await sendShiftReport(req.params.shiftId, { to, reason: 'manual' });
  if (!r.sent) throw httpError(400, r.reason === 'no_recipients' ? 'Objekat nema email adrese za izveštaj. Dodaj ih na stranici objekta.' : `Slanje nije uspelo: ${r.reason}`);
  res.json(r);
}));

module.exports = router;
