// Radnici obezbeđenja i koordinatori: lista, dosije, licence, dokumenti, ugovor, satnica
const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const multer = require('multer');
const axios = require('axios');
const { Technician } = require('../../models');
const SecurityWorker = require('../../models/SecurityWorker');
const SecurityDossier = require('../../models/SecurityDossier');
const SecurityShift = require('../../models/SecurityShift');
const { isSecurityStaff, isSecurityAdmin, isAdminRole, facilityScope } = require('../../middleware/securityAuth');
const { saveFile, deleteFile, cloudinaryConfigured } = require('../../services/security/storage');
const { cloudinary } = require('../../config/cloudinary');
const { addDossier } = require('../../services/security/events');
const { ah, httpError, requireId, str, isEmail } = require('./helpers');

const router = express.Router();
router.use(isSecurityStaff);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const DAY = 86400000;
const parseDate = (v) => { if (v === null || v === '' || v === undefined) return null; const d = new Date(v); return isNaN(d.getTime()) ? undefined : d; };

async function nameTaken(name, excludeId) {
  const rx = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  const [t, w] = await Promise.all([
    Technician.exists({ name: rx }),
    SecurityWorker.exists({ name: rx, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })
  ]);
  return !!(t || w);
}

function workerFields(b, isCreate) {
  const out = {};
  ['phone', 'address', 'jmbg', 'notes'].forEach((k) => { if (b[k] !== undefined) out[k] = str(b[k], k === 'notes' ? 4000 : 200); });
  if (b.email !== undefined) {
    const e = str(b.email, 200).toLowerCase();
    if (e && !isEmail(e)) throw httpError(400, 'Email adresa nije ispravna.');
    out.email = e;
  }
  if (b.jmbg !== undefined && out.jmbg && !/^\d{13}$/.test(out.jmbg)) throw httpError(400, 'JMBG mora imati 13 cifara.');
  if (b.birthDate !== undefined) { const d = parseDate(b.birthDate); if (d === undefined) throw httpError(400, 'Neispravan datum rođenja.'); out.birthDate = d; }
  if (b.contract !== undefined) {
    const from = parseDate(b.contract.from), until = parseDate(b.contract.until);
    if (from === undefined || until === undefined) throw httpError(400, 'Neispravan datum ugovora.');
    if (from && until && until < from) throw httpError(400, 'Ugovor ne može da ističe pre početka.');
    out.contract = { from, until };
  }
  if (b.hourlyRate !== undefined) out.hourlyRate = b.hourlyRate === null || b.hourlyRate === '' ? null : Math.max(0, Number(b.hourlyRate) || 0);
  if (isCreate || b.role !== undefined) out.role = b.role === 'coordinator' ? 'coordinator' : 'guard';
  return out;
}

async function loadWorker(req) {
  requireId(req.params.id, 'radnik');
  const w = await SecurityWorker.findById(req.params.id);
  if (!w) throw httpError(404, 'Radnik nije pronađen.');
  const scope = await facilityScope(req);
  if (scope && !w.facilityIds.some((f) => scope.includes(String(f)))) throw httpError(403, 'Radnik nije na vašim objektima.');
  return w;
}

// GET /api/security/workers?role=&q=&facility=&active=
router.get('/', ah(async (req, res) => {
  const scope = await facilityScope(req);
  const q = {};
  if (req.query.role === 'guard' || req.query.role === 'coordinator') q.role = req.query.role;
  if (req.query.active === '0') q.isActive = false; else if (req.query.active !== 'all') q.isActive = true;
  if (req.query.facility) { requireId(req.query.facility, 'objekat'); q.facilityIds = req.query.facility; }
  if (scope) q.facilityIds = q.facilityIds && scope.includes(String(q.facilityIds)) ? q.facilityIds : { $in: scope };
  if (req.query.q) q.name = { $regex: str(req.query.q, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const workers = await SecurityWorker.find(q).select('-password -alertsSent').populate('facilityIds', 'name').sort({ name: 1 }).lean();
  const now = new Date();
  const onDuty = await SecurityShift.find({ status: 'active', workerId: { $in: workers.map((w) => w._id) } }).populate('facilityId', 'name').lean();
  const lateNow = await SecurityShift.find({ status: 'planned', published: true, workerId: { $in: workers.map((w) => w._id) }, plannedStart: { $lte: now }, plannedEnd: { $gte: now } }).populate('facilityId', 'name').lean();
  res.json(workers.map((w) => {
    const duty = onDuty.find((s) => String(s.workerId) === String(w._id));
    const late = lateNow.find((s) => String(s.workerId) === String(w._id));
    return {
      ...w,
      pushToken: undefined,
      appConnected: !!w.pushToken,
      jmbg: w.jmbg ? `•••••••••${w.jmbg.slice(-4)}` : '',
      contractDaysLeft: w.contract && w.contract.until ? Math.ceil((new Date(w.contract.until) - now) / DAY) : null,
      duty: duty ? { status: 'on', facilityName: duty.facilityId ? duty.facilityId.name : '', since: duty.clockIn ? duty.clockIn.at : null }
        : late ? { status: 'late', facilityName: late.facilityId ? late.facilityId.name : '', minutes: Math.floor((now - late.plannedStart) / 60000) } : { status: 'off' }
    };
  }));
}));

// POST /api/security/workers
router.post('/', isSecurityAdmin, ah(async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 80);
  if (name.length < 3) throw httpError(400, 'Upiši ime i prezime (najmanje 3 slova).');
  if (await nameTaken(name)) throw httpError(409, 'Već postoji nalog sa tim imenom. Imena moraju biti jedinstvena jer se njima prijavljuje.');
  const password = String(b.password || '');
  if (password.length < 6) throw httpError(400, 'Lozinka mora imati najmanje 6 znakova.');
  const data = workerFields(b, true);
  const facilityIds = (b.facilityIds || []).filter((x) => /^[a-f0-9]{24}$/i.test(String(x)));
  const w = await SecurityWorker.create({ ...data, name, password: await bcrypt.hash(password, 10), facilityIds, createdById: req.user._id, createdByName: req.user.name });
  res.status(201).json(w.toSafe());
}));

// GET /api/security/workers/:id  (dosije)
router.get('/:id', ah(async (req, res) => {
  const w = await loadWorker(req);
  await w.populate('facilityIds', 'name');
  const now = new Date();
  const monthStart = new Date(now.getTime() - 31 * DAY);
  const [dossier, recent, upcoming] = await Promise.all([
    SecurityDossier.find({ workerId: w._id }).sort({ at: -1 }).limit(200).lean(),
    SecurityShift.find({ workerId: w._id, plannedStart: { $gte: monthStart, $lte: now } }).populate('facilityId', 'name').sort({ plannedStart: -1 }).lean(),
    SecurityShift.find({ workerId: w._id, plannedStart: { $gt: now } }).populate('facilityId', 'name').sort({ plannedStart: 1 }).limit(10).lean()
  ]);
  const done = recent.filter((s) => s.status === 'done');
  const safe = w.toSafe();
  const showJmbg = isAdminRole(req.user.role);
  res.json({
    ...safe,
    appConnected: !!w.pushToken,
    jmbg: showJmbg ? safe.jmbg : (safe.jmbg ? `•••••••••${safe.jmbg.slice(-4)}` : ''),
    contractDaysLeft: w.contract && w.contract.until ? Math.ceil((w.contract.until - now) / DAY) : null,
    dossier,
    stats: {
      shifts30: done.length,
      hours30: Math.round(done.reduce((a, s) => a + Math.max(0, (Math.min(s.plannedEnd, s.clockOut ? s.clockOut.at : s.plannedEnd) - Math.max(s.plannedStart, s.clockIn ? s.clockIn.at : s.plannedStart)) / 3600000), 0)),
      late30: recent.filter((s) => s.lateMin > 0).length,
      missed30: recent.filter((s) => s.status === 'missed').length,
      master30: dossier.filter((d) => d.kind === 'master' && new Date(d.at) >= monthStart).length
    },
    recentShifts: recent.slice(0, 20),
    upcomingShifts: upcoming
  });
}));

// PUT /api/security/workers/:id
router.put('/:id', isSecurityAdmin, ah(async (req, res) => {
  const w = await loadWorker(req);
  const b = req.body || {};
  if (b.name !== undefined) {
    const name = str(b.name, 80);
    if (name.length < 3) throw httpError(400, 'Ime je prekratko.');
    if (name.toLowerCase() !== w.name.toLowerCase() && await nameTaken(name, w._id)) throw httpError(409, 'Već postoji nalog sa tim imenom.');
    w.name = name;
  }
  if (b.password) {
    if (String(b.password).length < 6) throw httpError(400, 'Lozinka mora imati najmanje 6 znakova.');
    w.password = await bcrypt.hash(String(b.password), 10);
  }
  Object.assign(w, workerFields(b, false));
  if (Array.isArray(b.facilityIds)) w.facilityIds = b.facilityIds.filter((x) => /^[a-f0-9]{24}$/i.test(String(x)));
  if (b.contract && b.contract.until !== undefined) w.alertsSent = (w.alertsSent || []).filter((a) => !a.key.startsWith('contract:'));
  await w.save();
  res.json(w.toSafe());
}));

// PUT /api/security/workers/:id/active { isActive }
router.put('/:id/active', isSecurityAdmin, ah(async (req, res) => {
  const w = await loadWorker(req);
  w.isActive = !!req.body.isActive;
  if (!w.isActive) w.pushToken = null;
  await w.save();
  res.json(w.toSafe());
}));

// Licence (sa opcionim skeniranim dokumentom)
router.post('/:id/licenses', isSecurityAdmin, upload.single('file'), ah(async (req, res) => {
  const w = await loadWorker(req);
  const type = str(req.body.type, 150);
  if (type.length < 2) throw httpError(400, 'Upiši vrstu licence.');
  const lic = { type, number: str(req.body.number, 80), issuedAt: parseDate(req.body.issuedAt) || null, validUntil: parseDate(req.body.validUntil) || null };
  if (req.file) {
    const saved = await saveFile(req.file, 'documents');
    Object.assign(lic, { docUrl: saved.url, docPublicId: saved.publicId, docLocal: saved.local, docName: req.file.originalname });
  }
  w.licenses.push(lic);
  await w.save();
  res.status(201).json(w.toSafe());
}));

router.put('/:id/licenses/:lid', isSecurityAdmin, upload.single('file'), ah(async (req, res) => {
  const w = await loadWorker(req);
  const lic = w.licenses.id(req.params.lid);
  if (!lic) throw httpError(404, 'Licenca nije pronađena.');
  if (req.body.type !== undefined) lic.type = str(req.body.type, 150) || lic.type;
  if (req.body.number !== undefined) lic.number = str(req.body.number, 80);
  if (req.body.issuedAt !== undefined) lic.issuedAt = parseDate(req.body.issuedAt) || null;
  if (req.body.validUntil !== undefined) {
    lic.validUntil = parseDate(req.body.validUntil) || null;
    w.alertsSent = (w.alertsSent || []).filter((a) => !a.key.startsWith(`license:${lic._id}`));
  }
  if (req.file) {
    await deleteFile({ local: lic.docLocal, publicId: lic.docPublicId }, 'documents');
    const saved = await saveFile(req.file, 'documents');
    Object.assign(lic, { docUrl: saved.url, docPublicId: saved.publicId, docLocal: saved.local, docName: req.file.originalname });
  }
  await w.save();
  res.json(w.toSafe());
}));

router.delete('/:id/licenses/:lid', isSecurityAdmin, ah(async (req, res) => {
  const w = await loadWorker(req);
  const lic = w.licenses.id(req.params.lid);
  if (!lic) throw httpError(404, 'Licenca nije pronađena.');
  await deleteFile({ local: lic.docLocal, publicId: lic.docPublicId }, 'documents');
  lic.deleteOne();
  await w.save();
  res.json(w.toSafe());
}));

// Dokumenti (ugovor, lekarsko...)
router.post('/:id/documents', isSecurityAdmin, upload.single('file'), ah(async (req, res) => {
  const w = await loadWorker(req);
  if (!req.file) throw httpError(400, 'Izaberi fajl.');
  const saved = await saveFile(req.file, 'documents');
  w.documents.push({ name: str(req.body.name, 150) || req.file.originalname, url: saved.url, publicId: saved.publicId, local: saved.local, fileType: req.file.mimetype, fileSize: req.file.size });
  await w.save();
  res.status(201).json(w.toSafe());
}));

router.delete('/:id/documents/:did', isSecurityAdmin, ah(async (req, res) => {
  const w = await loadWorker(req);
  const doc = w.documents.id(req.params.did);
  if (!doc) throw httpError(404, 'Dokument nije pronađen.');
  await deleteFile(doc, 'documents');
  doc.deleteOne();
  await w.save();
  res.json(w.toSafe());
}));

// GET /api/security/workers/:id/files/:fileId  (preuzimanje licence ili dokumenta kroz server)
router.get('/:id/files/:fileId', ah(async (req, res) => {
  const w = await loadWorker(req);
  const lic = w.licenses.id(req.params.fileId);
  const doc = w.documents.id(req.params.fileId);
  const item = lic ? { local: lic.docLocal, publicId: lic.docPublicId, url: lic.docUrl, name: lic.docName } : doc ? { local: doc.local, publicId: doc.publicId, url: doc.url, name: doc.name } : null;
  if (!item || !item.url) throw httpError(404, 'Fajl nije pronađen.');
  if (item.local) {
    const p = path.join(__dirname, '..', '..', 'uploads', 'security', 'documents', path.basename(item.publicId));
    if (!fs.existsSync(p)) throw httpError(404, 'Fajl nije pronađen.');
    return res.sendFile(p);
  }
  if (!cloudinaryConfigured()) throw httpError(404, 'Fajl nije dostupan.');
  const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(item.url);
  const url = cloudinary.utils.private_download_url(item.publicId, isImage ? 'webp' : '', { resource_type: isImage ? 'image' : 'raw', type: 'upload', expires_at: Math.floor(Date.now() / 1000) + 600 });
  const r = await axios.get(url, { responseType: 'stream', maxRedirects: 5 });
  if (r.headers['content-type']) res.setHeader('Content-Type', r.headers['content-type']);
  r.data.pipe(res);
}));

// POST /api/security/workers/:id/dossier { text }  (ručna beleška u dosijeu)
router.post('/:id/dossier', ah(async (req, res) => {
  const w = await loadWorker(req);
  const text = str(req.body.text, 1000);
  if (text.length < 3) throw httpError(400, 'Upiši belešku.');
  const d = await addDossier({ workerId: w._id, kind: 'note', level: 'info', text, byName: req.user.name });
  res.status(201).json(d);
}));

module.exports = router;
