// Objekti: lista, detalji, radnici na objektu, plan obilaska, stalni zadaci, email adrese
const express = require('express');
const SecurityFacility = require('../../models/SecurityFacility');
const SecurityWorker = require('../../models/SecurityWorker');
const NfcTag = require('../../models/NfcTag');
const SecurityShift = require('../../models/SecurityShift');
const SecurityTask = require('../../models/SecurityTask');
const { isSecurityStaff, isSecurityAdmin, facilityScope, canAccessFacility } = require('../../middleware/securityAuth');
const { getSettings } = require('../../services/security/settings');
const { hhmmToMinutes } = require('../../services/security/time');
const { ah, httpError, requireId, str, isHHMM, isEmail } = require('./helpers');

const router = express.Router();
router.use(isSecurityStaff);

const pickFacility = (b) => {
  const out = {};
  ['name', 'type', 'address', 'city', 'contactName', 'contactPhone'].forEach((k) => { if (b[k] !== undefined) out[k] = str(b[k], 200); });
  ['description', 'instructions'].forEach((k) => { if (b[k] !== undefined) out[k] = str(b[k], 4000); });
  if (b.geo && (b.geo.lat === null || typeof b.geo.lat === 'number')) out.geo = { lat: b.geo.lat, lng: b.geo.lng };
  if (Array.isArray(b.reportEmails)) out.reportEmails = b.reportEmails.map((e) => str(e, 200).toLowerCase()).filter(isEmail);
  return out;
};

async function loadAccessible(req, id) {
  requireId(id, 'objekat');
  if (!(await canAccessFacility(req, id))) throw httpError(403, 'Nemate pristup ovom objektu.');
  const f = await SecurityFacility.findById(id);
  if (!f) throw httpError(404, 'Objekat nije pronađen.');
  return f;
}

// GET /api/security/facilities
router.get('/', ah(async (req, res) => {
  const scope = await facilityScope(req);
  const q = req.query.all === '1' ? {} : { active: true };
  if (scope) q._id = { $in: scope };
  const list = await SecurityFacility.find(q).sort({ name: 1 }).lean();
  const ids = list.map((f) => f._id);
  const [workers, tags] = await Promise.all([
    SecurityWorker.find({ facilityIds: { $in: ids }, isActive: true }).select('name role facilityIds').lean(),
    NfcTag.find({ facilityId: { $in: ids }, status: 'active' }).select('facilityId category').lean()
  ]);
  res.json(list.map((f) => {
    const fid = String(f._id);
    const ws = workers.filter((w) => w.facilityIds.some((x) => String(x) === fid));
    const ts = tags.filter((t) => String(t.facilityId) === fid);
    return {
      ...f,
      guardCount: ws.filter((w) => w.role === 'guard').length,
      coordinators: ws.filter((w) => w.role === 'coordinator').map((w) => ({ _id: w._id, name: w.name })),
      workplaceTags: ts.filter((t) => t.category === 'workplace').length,
      checkpointTags: ts.filter((t) => t.category === 'checkpoint').length
    };
  }));
}));

// POST /api/security/facilities
router.post('/', isSecurityAdmin, ah(async (req, res) => {
  const data = pickFacility(req.body || {});
  if (!data.name || data.name.length < 2) throw httpError(400, 'Upiši naziv objekta.');
  const f = await SecurityFacility.create({ ...data, createdById: req.user._id, createdByName: req.user.name });
  res.status(201).json(f);
}));

// GET /api/security/facilities/:id
router.get('/:id', ah(async (req, res) => {
  const f = await loadAccessible(req, req.params.id);
  const [tags, people, upcoming] = await Promise.all([
    NfcTag.find({ facilityId: f._id }).sort({ status: 1, category: -1, name: 1 }).lean(),
    SecurityWorker.find({ facilityIds: f._id }).select('name role isActive phone email contract hourlyRate facilityIds licenses').populate('facilityIds', 'name').lean(),
    SecurityTask.find({ facilityId: f._id, status: 'open', dueAt: { $gte: new Date(Date.now() - 24 * 3600000) } }).sort({ dueAt: 1 }).limit(50).lean()
  ]);
  const tagName = new Map(tags.map((t) => [String(t._id), t]));
  const plan = (arr) => (arr || []).map((p) => ({ tagId: p.tagId, time: p.time, tagName: tagName.get(String(p.tagId))?.name || 'Uklonjen tag', tagStatus: tagName.get(String(p.tagId))?.status || 'retired' }))
    .sort((a, b) => a.time.localeCompare(b.time));
  res.json({
    ...f.toObject(),
    roundPlan: { day: plan(f.roundPlan.day), night: plan(f.roundPlan.night) },
    tags,
    guards: people.filter((p) => p.role === 'guard'),
    coordinators: people.filter((p) => p.role === 'coordinator'),
    upcomingTasks: upcoming
  });
}));

// PUT /api/security/facilities/:id  (osnovni podaci)
router.put('/:id', ah(async (req, res) => {
  const f = await loadAccessible(req, req.params.id);
  const data = pickFacility(req.body || {});
  const admin = ['admin', 'superadmin', 'supervisor'].includes(req.user.role);
  if (!admin) { // koordinator menja samo operativne podatke
    Object.keys(data).forEach((k) => { if (!['instructions', 'reportEmails', 'contactName', 'contactPhone'].includes(k)) delete data[k]; });
  }
  if (data.name !== undefined && data.name.length < 2) throw httpError(400, 'Naziv objekta je prekratak.');
  Object.assign(f, data);
  if (admin && req.body.rules) {
    const r = req.body.rules;
    f.rules = {
      checkpointTolMin: r.checkpointTolMin === null || r.checkpointTolMin === '' ? null : Math.max(0, Math.min(60, Number(r.checkpointTolMin))),
      snoozeMin: r.snoozeMin === null || r.snoozeMin === '' ? null : Math.max(1, Math.min(60, Number(r.snoozeMin)))
    };
  }
  await f.save();
  res.json(f);
}));

router.post('/:id/archive', isSecurityAdmin, ah(async (req, res) => {
  const f = await loadAccessible(req, req.params.id);
  const future = await SecurityShift.countDocuments({ facilityId: f._id, status: { $in: ['planned', 'active'] }, plannedEnd: { $gte: new Date() } });
  if (future && req.body.force !== true) throw httpError(409, `Objekat ima ${future} predstojećih smena. Obriši ih ili potvrdi arhiviranje.`, { futureShifts: future });
  f.active = false;
  await f.save();
  res.json(f);
}));

router.post('/:id/restore', isSecurityAdmin, ah(async (req, res) => {
  const f = await loadAccessible(req, req.params.id);
  f.active = true;
  await f.save();
  res.json(f);
}));

// PUT /api/security/facilities/:id/people { role: 'guard'|'coordinator', workerIds: [] }
router.put('/:id/people', isSecurityAdmin, ah(async (req, res) => {
  const f = await loadAccessible(req, req.params.id);
  const role = req.body.role === 'coordinator' ? 'coordinator' : 'guard';
  const ids = (req.body.workerIds || []).filter((x) => /^[a-f0-9]{24}$/i.test(String(x)));
  await SecurityWorker.updateMany({ role, facilityIds: f._id, _id: { $nin: ids } }, { $pull: { facilityIds: f._id } });
  await SecurityWorker.updateMany({ role, _id: { $in: ids } }, { $addToSet: { facilityIds: f._id } });
  res.json({ ok: true });
}));

// PUT /api/security/facilities/:id/round-plan { day: [{tagId, time}], night: [...] }
router.put('/:id/round-plan', isSecurityAdmin, ah(async (req, res) => {
  const f = await loadAccessible(req, req.params.id);
  const s = await getSettings();
  const dayStart = hhmmToMinutes(s.dayStart), nightStart = hhmmToMinutes(s.nightStart);
  const tags = await NfcTag.find({ facilityId: f._id, status: 'active', category: 'checkpoint' }).select('_id');
  const allowed = new Set(tags.map((t) => String(t._id)));
  const clean = (arr, type) => (Array.isArray(arr) ? arr : []).map((p) => {
    if (!allowed.has(String(p.tagId))) throw httpError(400, 'U planu može biti samo aktivan checkpoint ovog objekta.');
    if (!isHHMM(p.time)) throw httpError(400, `Neispravno vreme: ${p.time}`);
    const m = hhmmToMinutes(p.time);
    const inDay = m >= dayStart && m < nightStart;
    if (type === 'day' && !inDay) throw httpError(400, `${p.time} nije u dnevnoj smeni (${s.dayStart}-${s.nightStart}).`);
    if (type === 'night' && inDay) throw httpError(400, `${p.time} nije u noćnoj smeni (${s.nightStart}-${s.dayStart}).`);
    return { tagId: p.tagId, time: p.time };
  });
  f.roundPlan = { day: clean(req.body.day, 'day'), night: clean(req.body.night, 'night') };
  await f.save();
  res.json({ ok: true, roundPlan: f.roundPlan });
}));

// PUT /api/security/facilities/:id/standing-tasks { tasks: [{ _id?, text, requireComment }] }
router.put('/:id/standing-tasks', ah(async (req, res) => {
  const f = await loadAccessible(req, req.params.id);
  const tasks = (req.body.tasks || []).map((t, i) => ({ ...(t._id && /^[a-f0-9]{24}$/i.test(t._id) ? { _id: t._id } : {}), text: str(t.text, 300), requireComment: !!t.requireComment, order: i }))
    .filter((t) => t.text.length >= 2);
  f.standingTasks = tasks;
  await f.save();
  res.json({ ok: true, standingTasks: f.standingTasks });
}));

// PUT /api/security/facilities/:id/report-emails { emails: [] }
router.put('/:id/report-emails', ah(async (req, res) => {
  const f = await loadAccessible(req, req.params.id);
  const emails = [...new Set((req.body.emails || []).map((e) => str(e, 200).toLowerCase()))];
  const bad = emails.filter((e) => !isEmail(e));
  if (bad.length) throw httpError(400, `Neispravna adresa: ${bad.join(', ')}`);
  f.reportEmails = emails;
  await f.save();
  res.json({ ok: true, reportEmails: f.reportEmails });
}));

module.exports = router;
