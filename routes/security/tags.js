// NFC tagovi: registracija, preimenovanje, premeštanje, zamena oštećenog, uklanjanje, vraćanje,
// i "nepoznati tagovi" koje su radnici očitali, da ih admin registruje jednim klikom
const express = require('express');
const NfcTag = require('../../models/NfcTag');
const SecurityFacility = require('../../models/SecurityFacility');
const SecurityScan = require('../../models/SecurityScan');
const { isSecurityStaff, isSecurityAdmin, facilityScope, canAccessFacility } = require('../../middleware/securityAuth');
const { normalizeUid } = require('../../services/security/scanService');
const { ah, httpError, requireId, str } = require('./helpers');

const router = express.Router();
router.use(isSecurityStaff);

const CAT_LABEL = { workplace: 'radno mesto', checkpoint: 'checkpoint' };
const hist = (req, action, details) => ({ at: new Date(), byId: req.user._id, byName: req.user.name, action, details });

async function removeFromPlans(tagId) {
  await SecurityFacility.updateMany({}, { $pull: { 'roundPlan.day': { tagId }, 'roundPlan.night': { tagId } } });
}

async function describeUid(uid, excludeId) {
  const active = await NfcTag.findOne({ uid, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).populate('facilityId', 'name');
  if (active) return { status: active.status, tag: active };
  const replaced = await NfcTag.findOne({ 'previousUids.uid': uid }).populate('facilityId', 'name');
  if (replaced) return { status: 'replaced', tag: replaced };
  return { status: 'free', tag: null };
}

// GET /api/security/tags?facility=&status=
router.get('/', ah(async (req, res) => {
  const scope = await facilityScope(req);
  const q = {};
  if (req.query.facility) { requireId(req.query.facility, 'objekat'); q.facilityId = req.query.facility; }
  if (scope) q.facilityId = q.facilityId ? (scope.includes(String(q.facilityId)) ? q.facilityId : null) : { $in: scope };
  if (req.query.status) q.status = req.query.status;
  const tags = await NfcTag.find(q).populate('facilityId', 'name').sort({ status: 1, name: 1 }).lean();
  res.json(tags);
}));

// GET /api/security/tags/unknown  (očitani, a neregistrovani tagovi)
router.get('/unknown', ah(async (req, res) => {
  const scope = await facilityScope(req);
  const match = { result: 'unknown_tag', handled: false, at: { $gte: new Date(Date.now() - 30 * 86400000) } };
  if (scope) match.facilityId = { $in: scope.map((x) => require('mongoose').Types.ObjectId.createFromHexString(x)) };
  const rows = await SecurityScan.aggregate([
    { $match: match },
    { $sort: { at: -1 } },
    { $group: { _id: '$uid', count: { $sum: 1 }, lastAt: { $first: '$at' }, workerName: { $first: '$workerName' }, facilityId: { $first: '$facilityId' }, facilityName: { $first: '$facilityName' } } },
    { $sort: { lastAt: -1 } },
    { $limit: 50 }
  ]);
  res.json(rows.map((r) => ({ uid: r._id, count: r.count, lastAt: r.lastAt, workerName: r.workerName, facilityId: r.facilityId, facilityName: r.facilityName })));
}));

router.post('/unknown/:uid/dismiss', isSecurityAdmin, ah(async (req, res) => {
  const uid = normalizeUid(req.params.uid);
  if (!uid) throw httpError(400, 'Neispravan broj taga.');
  await SecurityScan.updateMany({ uid, result: 'unknown_tag' }, { $set: { handled: true } });
  res.json({ ok: true });
}));

// GET /api/security/tags/lookup/:uid
router.get('/lookup/:uid', ah(async (req, res) => {
  const uid = normalizeUid(req.params.uid);
  if (!uid) throw httpError(400, 'Neispravan broj taga.');
  const info = await describeUid(uid);
  res.json({ uid, status: info.status, tag: info.tag });
}));

// POST /api/security/tags  (registracija novog taga)
router.post('/', isSecurityAdmin, ah(async (req, res) => {
  const b = req.body || {};
  requireId(b.facilityId, 'objekat');
  const facility = await SecurityFacility.findById(b.facilityId);
  if (!facility) throw httpError(404, 'Objekat nije pronađen.');
  const category = b.category === 'checkpoint' ? 'checkpoint' : b.category === 'workplace' ? 'workplace' : null;
  if (!category) throw httpError(400, 'Izaberi da li je tag radno mesto ili checkpoint.');
  const name = str(b.name, 120);
  if (name.length < 2) throw httpError(400, 'Upiši naziv taga.');
  const uid = normalizeUid(b.uid);
  if (!uid) throw httpError(400, 'Tag nije očitan. Prisloni telefon na tag ili upiši broj taga.');

  const info = await describeUid(uid);
  if (info.status === 'active') throw httpError(409, `Ovaj tag je već registrovan: ${info.tag.name} (${info.tag.facilityId ? info.tag.facilityId.name : ''}).`, { code: 'active', tagId: info.tag._id });
  if (info.status === 'retired') throw httpError(409, `Ovaj tag je ranije uklonjen iz upotrebe (${info.tag.name}). Možeš da ga vratiš u upotrebu sa novim podacima.`, { code: 'retired', tagId: info.tag._id });
  if (info.status === 'replaced' && b.force !== true) throw httpError(409, `Ovaj čip je ranije zamenjen na tagu ${info.tag.name}. Potvrdi ako ga namerno koristiš ponovo.`, { code: 'replaced', tagId: info.tag._id });

  const tag = await NfcTag.create({
    facilityId: facility._id, category, name,
    location: str(b.location, 200), note: str(b.note, 1000), uid,
    chip: str(b.chip || 'NTAG215', 40),
    geo: b.geo && typeof b.geo.lat === 'number' ? { lat: b.geo.lat, lng: b.geo.lng, acc: b.geo.acc } : undefined,
    ndef: { written: !!(b.ndef && b.ndef.written), locked: !!(b.ndef && b.ndef.locked) },
    history: [hist(req, 'created', `${CAT_LABEL[category]} · ${facility.name}${b.source ? ` · ${b.source}` : ''}`)],
    createdById: req.user._id, createdByName: req.user.name
  });
  await SecurityScan.updateMany({ uid, result: 'unknown_tag' }, { $set: { handled: true } });
  res.status(201).json(tag);
}));

async function loadTag(req) {
  requireId(req.params.id, 'tag');
  const tag = await NfcTag.findById(req.params.id);
  if (!tag) throw httpError(404, 'Tag nije pronađen.');
  if (!(await canAccessFacility(req, tag.facilityId))) throw httpError(403, 'Nemate pristup ovom tagu.');
  return tag;
}

// PUT /api/security/tags/:id  (naziv, lokacija, napomena, kategorija, objekat)
router.put('/:id', isSecurityAdmin, ah(async (req, res) => {
  const tag = await loadTag(req);
  const b = req.body || {};
  if (b.name !== undefined) {
    const name = str(b.name, 120);
    if (name.length < 2) throw httpError(400, 'Naziv taga je prekratak.');
    if (name !== tag.name) { tag.history.push(hist(req, 'renamed', `${tag.name} → ${name}`)); tag.name = name; }
  }
  if (b.location !== undefined && str(b.location, 200) !== tag.location) {
    tag.history.push(hist(req, 'moved', `${tag.location || '-'} → ${str(b.location, 200) || '-'}`));
    tag.location = str(b.location, 200);
    if (b.geo && typeof b.geo.lat === 'number') tag.geo = { lat: b.geo.lat, lng: b.geo.lng, acc: b.geo.acc };
  }
  if (b.note !== undefined) tag.note = str(b.note, 1000);
  if (b.category && b.category !== tag.category && ['workplace', 'checkpoint'].includes(b.category)) {
    tag.history.push(hist(req, 'category', `${CAT_LABEL[tag.category]} → ${CAT_LABEL[b.category]}`));
    if (tag.category === 'checkpoint') await removeFromPlans(tag._id);
    tag.category = b.category;
  }
  if (b.facilityId && String(b.facilityId) !== String(tag.facilityId)) {
    requireId(b.facilityId, 'objekat');
    const to = await SecurityFacility.findById(b.facilityId);
    if (!to) throw httpError(404, 'Objekat nije pronađen.');
    const from = await SecurityFacility.findById(tag.facilityId);
    await removeFromPlans(tag._id);
    tag.history.push(hist(req, 'transferred', `${from ? from.name : '-'} → ${to.name}`));
    tag.facilityId = to._id;
  }
  await tag.save();
  res.json(await tag.populate('facilityId', 'name'));
}));

// POST /api/security/tags/:id/replace { uid, reason }  (oštećen ili izgubljen tag: novi čip, sve ostalo ostaje)
router.post('/:id/replace', isSecurityAdmin, ah(async (req, res) => {
  const tag = await loadTag(req);
  const uid = normalizeUid(req.body.uid);
  if (!uid) throw httpError(400, 'Novi tag nije očitan.');
  if (uid === tag.uid) throw httpError(400, 'To je isti tag. Prisloni telefon na novi tag.');
  const info = await describeUid(uid, tag._id);
  if (info.status === 'active' || info.status === 'retired') throw httpError(409, `Novi čip je već registrovan kao ${info.tag.name}.`, { code: info.status, tagId: info.tag._id });
  const reason = str(req.body.reason, 300) || 'Zamena taga';
  tag.previousUids.push({ uid: tag.uid, replacedAt: new Date(), reason });
  tag.history.push(hist(req, 'replaced', `${tag.uid} → ${uid} · ${reason}`));
  tag.uid = uid;
  tag.ndef = { written: !!(req.body.ndef && req.body.ndef.written), locked: !!(req.body.ndef && req.body.ndef.locked) };
  if (tag.status === 'retired') { tag.status = 'active'; tag.history.push(hist(req, 'reactivated', 'Vraćen u upotrebu uz novi čip')); }
  await tag.save();
  await SecurityScan.updateMany({ uid, result: 'unknown_tag' }, { $set: { handled: true } });
  res.json(await tag.populate('facilityId', 'name'));
}));

// POST /api/security/tags/:id/retire { reason }
router.post('/:id/retire', isSecurityAdmin, ah(async (req, res) => {
  const tag = await loadTag(req);
  if (tag.status === 'retired') return res.json(tag);
  tag.status = 'retired';
  tag.history.push(hist(req, 'retired', str(req.body.reason, 300) || 'Uklonjen iz upotrebe'));
  await tag.save();
  await removeFromPlans(tag._id);
  res.json(await tag.populate('facilityId', 'name'));
}));

// POST /api/security/tags/:id/reactivate { facilityId?, category?, name?, location? }
router.post('/:id/reactivate', isSecurityAdmin, ah(async (req, res) => {
  const tag = await loadTag(req);
  const b = req.body || {};
  if (b.facilityId && String(b.facilityId) !== String(tag.facilityId)) {
    requireId(b.facilityId, 'objekat');
    if (!(await SecurityFacility.exists({ _id: b.facilityId }))) throw httpError(404, 'Objekat nije pronađen.');
    tag.facilityId = b.facilityId;
  }
  if (b.category && ['workplace', 'checkpoint'].includes(b.category)) tag.category = b.category;
  if (b.name && str(b.name, 120).length >= 2) tag.name = str(b.name, 120);
  if (b.location !== undefined) tag.location = str(b.location, 200);
  tag.status = 'active';
  tag.history.push(hist(req, 'reactivated', 'Vraćen u upotrebu'));
  await tag.save();
  await SecurityScan.updateMany({ uid: tag.uid, result: 'unknown_tag' }, { $set: { handled: true } });
  res.json(await tag.populate('facilityId', 'name'));
}));

// PUT /api/security/tags/:id/ndef { written, locked }
router.put('/:id/ndef', isSecurityAdmin, ah(async (req, res) => {
  const tag = await loadTag(req);
  tag.ndef = { written: !!req.body.written, locked: !!req.body.locked };
  tag.history.push(hist(req, 'ndef', `${tag.ndef.written ? 'Upisan link za otvaranje aplikacije' : 'Bez linka'}${tag.ndef.locked ? ', tag zaključan' : ''}`));
  await tag.save();
  res.json(tag);
}));

// DELETE /api/security/tags/:id  (samo tag koji nikad nije očitan; ostali se uklanjaju iz upotrebe)
router.delete('/:id', isSecurityAdmin, ah(async (req, res) => {
  const tag = await loadTag(req);
  const used = await SecurityScan.countDocuments({ tagId: tag._id });
  if (used) throw httpError(409, 'Tag ima očitavanja u istoriji. Ukloni ga iz upotrebe umesto brisanja.', { code: 'has_scans' });
  await removeFromPlans(tag._id);
  await tag.deleteOne();
  res.json({ ok: true });
}));

module.exports = router;
