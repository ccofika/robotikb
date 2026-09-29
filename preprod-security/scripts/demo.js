// Živa situacija za stranicu Uživo (samo Security pre-prod, posle seed.js).
// Dodaje objekte TC Orbit, Klinika Aura i Data centar Zenit, pa za TRENUTNU smenu (dnevnu ili noćnu)
// pravi stanje kao u radu: radnici na dužnosti, obilasci očitani do sada, jedan propušten obilazak
// (kritičan alarm adminu), jedan checkpoint koji kasni (alarm radniku), odložen pa očitan alarm,
// nepoznati tagovi, zapažanja, primena ovlašćenja, zadaci, očitavanja bez interneta, van objekta i
// prebrza, i smena koja nije objavljena.
//
// Upotreba:  node demo.js                  napravi situaciju i izađi
//            node demo.js --simulate       napravi situaciju pa nastavi da "igra" radnike: očitavanja na vreme,
//                                          prijave i odjave na smenu, urađeni zadaci (dok se proces ne ugasi)
//            node demo.js --only-simulate  samo simulacija (security.ps1 demo je pokreće u pozadini)
const path = require('path');
const fs = require('fs');

// Koren projekta: preprod-security je u korenu (<koren>/preprod-security) ili u repou (<koren>/.wt/robotikb/preprod-security)
const PRE_DIR = path.resolve(__dirname, '..');
const ROOT = fs.existsSync(path.join(PRE_DIR, '..', '.wt', 'robotikb')) ? path.resolve(PRE_DIR, '..') : path.resolve(PRE_DIR, '..', '..', '..');
const B = path.join(ROOT, '.wt', 'robotikb');
const req = (m) => require(require.resolve(m, { paths: [B] }));
const dotenv = req('dotenv');
const mongoose = req('mongoose');
const bcrypt = req('bcrypt');

const env = dotenv.parse(fs.readFileSync(path.join(__dirname, '..', 'env', 'backend.env')));
if (!/robotik_preprod_security$/.test(env.MONGODB_URI || '')) { console.error('[demo] STOP: pogrešna baza'); process.exit(1); }
Object.assign(process.env, env);

const M = (n) => require(path.join(B, 'models', n));
const SecurityWorker = M('SecurityWorker');
const SecurityFacility = M('SecurityFacility');
const NfcTag = M('NfcTag');
const SecurityShift = M('SecurityShift');
const SecurityScan = M('SecurityScan');
const SecurityObservation = M('SecurityObservation');
const SecurityTask = M('SecurityTask');
const SecurityAlarm = M('SecurityAlarm');
const SecurityDossier = M('SecurityDossier');
const SecuritySettings = M('SecuritySettings');
const { Technician, Notification } = require(path.join(B, 'models'));
const T = require(path.join(B, 'services', 'security', 'time'));

const SIMULATE = process.argv.includes('--simulate');
const ONLY_SIM = process.argv.includes('--only-simulate'); // security.ps1 demo: situacija je već napravljena
const PASSWORD = 'Preprod123!';
const MIN = 60000;
const hm = (d) => T.instantToLocal(d).hhmm;
const log = (...a) => console.log(`[demo ${hm(new Date())}]`, ...a);

// Stabilan "slučajan" broj 0..1 iz teksta (isto stanje pri svakom pokretanju)
function rnd(key) {
  let h = 2166136261;
  for (const ch of String(key)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

const EXTRA = [
  {
    key: 'orbit', name: 'TC Orbit', type: 'Tržni centar', address: 'Omladinskih brigada 90', city: 'Novi Beograd', geo: { lat: 44.8127, lng: 20.4185 },
    description: 'Tržni centar sa 120 lokala, dve garaže (P1 i P2) i utovarnom zonom.',
    instructions: 'Posle 22:00 zaključati ulaze 2 i 3. Ključevi lokala su u kasi na info pultu.',
    contactName: 'Uprava centra', contactPhone: '011 555 0400', reportEmails: ['uprava@tc-orbit.test'],
    rules: { snoozeMin: 30 },
    standingTasks: [{ text: 'Provera garaža P1 i P2 na početku smene' }, { text: 'Obilazak po planu' }, { text: 'Zaključavanje ulaza 2 i 3 posle 22:00' }],
    tags: [['wp', 'Info pult, ulaz 1', 'Prizemlje'], ['p2', 'Parking P2', 'Garaža -2'], ['utovar', 'Utovarna zona', 'Dvorište'], ['krov', 'Krov, klima komore', 'Krov'], ['hodnik', 'Hodnik 2. sprat', '2. sprat'], ['izlaz', 'Izlaz za evakuaciju', 'Istočna strana']],
    plan: {
      day: [['p2', '08:30'], ['utovar', '10:00'], ['hodnik', '11:30'], ['krov', '13:00'], ['izlaz', '14:30'], ['p2', '15:30'], ['utovar', '17:00'], ['hodnik', '18:30']],
      night: [['p2', '20:00'], ['utovar', '21:30'], ['izlaz', '23:00'], ['krov', '00:30'], ['p2', '02:00'], ['hodnik', '03:30'], ['utovar', '05:00'], ['izlaz', '06:30']]
    },
    crew: { day: 'Nikola Pavlović', night: 'Bojan Radić' }
  },
  {
    key: 'aura', name: 'Klinika Aura', type: 'Zdravstvena ustanova', address: 'Bulevar oslobođenja 44', city: 'Vračar', geo: { lat: 44.7942, lng: 20.4719 },
    description: 'Privatna klinika sa hitnom službom, laboratorijom i apotekom. Radi 24 h.',
    instructions: 'Ulaz hitne pomoći mora biti slobodan u svakom trenutku. Magacin lekova otvara samo dežurni farmaceut.',
    contactName: 'Dežurni lekar', contactPhone: '011 555 0500', reportEmails: ['uprava@klinika-aura.test'],
    standingTasks: [{ text: 'Provera ulaza hitne pomoći', requireComment: true }, { text: 'Obilazak po planu' }, { text: 'Kontrola parkinga za vozila hitne pomoći' }],
    tags: [['wp', 'Glavni ulaz, portirnica', 'Prizemlje'], ['hitna', 'Ulaz hitne pomoći', 'Prizemlje, zapad'], ['lab', 'Laboratorija', '1. sprat'], ['apoteka', 'Apoteka', 'Prizemlje'], ['parking', 'Parking', 'Dvorište'], ['magacin', 'Magacin lekova', 'Podrum']],
    plan: {
      day: [['hitna', '08:00'], ['lab', '09:00'], ['parking', '10:00'], ['apoteka', '11:00'], ['hitna', '12:00'], ['magacin', '13:00'], ['lab', '14:00'], ['parking', '15:00'], ['hitna', '16:00'], ['apoteka', '17:00'], ['magacin', '18:00']],
      night: [['hitna', '20:00'], ['parking', '21:30'], ['magacin', '23:00'], ['hitna', '00:30'], ['lab', '02:00'], ['parking', '03:30'], ['hitna', '05:00'], ['apoteka', '06:30']]
    },
    crew: { day: 'Jelena Đorđević', night: 'Marija Stanković' }
  },
  {
    key: 'zenit', name: 'Data centar Zenit', type: 'Data centar', address: 'Batajnički drum 12', city: 'Zemun', geo: { lat: 44.8795, lng: 20.3490 },
    description: 'Data centar sa dve server hale, UPS sistemom i agregatom. Danju ga čuva tehnička služba, obezbeđenje je noću.',
    instructions: 'Ulaz u server hale samo uz karticu. Svaki alarm UPS-a odmah javiti dežurnom inženjeru.',
    contactName: 'Dežurni inženjer', contactPhone: '011 555 0600', reportEmails: ['noc@zenit-dc.test'],
    standingTasks: [{ text: 'Provera UPS panela i agregata', requireComment: true }, { text: 'Obilazak po planu' }],
    tags: [['wp', 'Kontrolna soba', 'Prizemlje'], ['hala1', 'Server hala A', '1. sprat'], ['hala2', 'Server hala B', '1. sprat'], ['ups', 'UPS i agregat', 'Podrum'], ['ograda', 'Ograda i kapija', 'Dvorište']],
    plan: {
      day: [],
      night: [['ograda', '20:00'], ['hala1', '21:30'], ['hala2', '23:00'], ['ups', '00:30'], ['ograda', '02:00'], ['hala1', '03:30'], ['hala2', '05:00'], ['ups', '06:30']]
    },
    crew: { day: null, night: 'Vladimir Savić' }
  }
];
const EXTRA_WORKERS = [
  { name: 'Nikola Pavlović', phone: '064 222 3101', facilities: ['orbit'], until: 240, lic: [['Službenik obezbeđenja, bez oružja', 'LOB-0811', null]] },
  { name: 'Bojan Radić', phone: '063 222 3102', facilities: ['orbit'], until: 150, lic: [['Službenik obezbeđenja, bez oružja', 'LOB-0812', null]] },
  { name: 'Jelena Đorđević', phone: '065 222 3103', facilities: ['aura'], until: 320, lic: [['Službenik obezbeđenja, bez oružja', 'LOB-0813', null], ['Prva pomoć', 'PPM-915', 52]] },
  { name: 'Marija Stanković', phone: '060 222 3104', facilities: ['aura'], until: 12, lic: [['Službenik obezbeđenja, bez oružja', 'LOB-0814', null]] },
  { name: 'Vladimir Savić', phone: '061 222 3105', facilities: ['zenit'], until: 200, lic: [['Službenik obezbeđenja, sa oružjem', 'LOB-0815', null]] },
  { name: 'Uroš Janković', phone: '062 222 3106', facilities: ['nord'], until: 180, lic: [['Službenik obezbeđenja, bez oružja', 'LOB-0816', null]] }
];
const UNKNOWN_UIDS = ['04:A7:3B:19:C2:5D:80', '04:11:9E:6A:22:B4:80'];

async function connect() {
  await mongoose.connect(env.MONGODB_URI);
}

// ---------- 1) dodatni objekti, radnici, tagovi i planovi (idempotentno) ----------
async function ensureExtras() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const now = new Date();
  const F = {};
  for (const f of EXTRA) {
    const { key, tags, plan, crew, standingTasks, ...data } = f;
    let doc = await SecurityFacility.findOne({ name: data.name });
    if (!doc) doc = await SecurityFacility.create({ ...data, standingTasks, active: true, createdByName: 'E2E Admin' });
    else { Object.assign(doc, data, { active: true }); if (!doc.standingTasks.length) doc.standingTasks = standingTasks; await doc.save(); }
    const tagDocs = {};
    let n = 0;
    for (const [k, name, location] of tags) {
      n++;
      const uid = `04:${(0x60 + EXTRA.indexOf(f)).toString(16).toUpperCase()}:D${n}:7C:A1:3C:80`;
      let t = await NfcTag.findOne({ facilityId: doc._id, name });
      if (!t) t = await NfcTag.create({ facilityId: doc._id, category: k === 'wp' ? 'workplace' : 'checkpoint', name, location, uid, chip: 'NTAG215', history: [{ action: 'created', byName: 'E2E Admin', details: 'demo' }], createdByName: 'E2E Admin' });
      tagDocs[k] = t;
    }
    doc.roundPlan = {
      day: plan.day.map(([k, time]) => ({ tagId: tagDocs[k]._id, time })),
      night: plan.night.map(([k, time]) => ({ tagId: tagDocs[k]._id, time }))
    };
    await doc.save();
    F[key] = doc;
  }
  const byKey = { ...F };
  for (const k of ['aurora', 'delta', 'nord']) {
    const name = { aurora: 'Hotel Aurora', delta: 'Poslovni centar Delta', nord: 'Magacin Nord' }[k];
    byKey[k] = await SecurityFacility.findOne({ name });
  }
  for (const w of EXTRA_WORKERS) {
    const licenses = (w.lic || []).map(([type, number, days]) => ({ type, number, issuedAt: new Date(now.getTime() - 400 * 86400000), validUntil: days ? new Date(now.getTime() + days * 86400000) : null }));
    await SecurityWorker.findOneAndUpdate({ name: w.name }, {
      $set: { name: w.name, role: 'guard', isActive: true, phone: w.phone, address: 'Beograd', facilityIds: w.facilities.map((k) => byKey[k]._id), licenses, contract: { from: new Date(now.getTime() - 200 * 86400000), until: new Date(now.getTime() + w.until * 86400000) } },
      $setOnInsert: { password: hash, birthDate: new Date(1992, 5, 2), jmbg: '0206992710456', alertsSent: [] }
    }, { upsert: true, new: true, setDefaultsOnInsert: true });
  }
  // Koordinatori: Sanja vodi i Orbit i Auru, Milan i Zenit
  await SecurityWorker.updateOne({ name: 'Sanja Kostić' }, { $addToSet: { facilityIds: { $each: [byKey.orbit._id, byKey.aura._id] } } });
  await SecurityWorker.updateOne({ name: 'Milan Ilić' }, { $addToSet: { facilityIds: byKey.zenit._id } });
  return byKey;
}

// Trenutna smena (dnevna ili noćna) i sledeće dve
function windows(settings, now) {
  const loc = T.instantToLocal(now);
  const ds = T.hhmmToMinutes(settings.dayStart || '07:00');
  const ns = T.hhmmToMinutes(settings.nightStart || '19:00');
  let type, ymd;
  if (loc.minutes >= ds && loc.minutes < ns) { type = 'day'; ymd = loc.ymd; } else { type = 'night'; ymd = loc.minutes >= ns ? loc.ymd : T.addDaysYmd(loc.ymd, -1); }
  const cur = { type, ymd, ...T.shiftWindow(ymd, type, settings) };
  const next = type === 'day' ? { type: 'night', ymd } : { type: 'day', ymd: T.addDaysYmd(ymd, 1) };
  Object.assign(next, T.shiftWindow(next.ymd, next.type, settings));
  const prev = type === 'day' ? { type: 'night', ymd: T.addDaysYmd(ymd, -1) } : { type: 'day', ymd };
  Object.assign(prev, T.shiftWindow(prev.ymd, prev.type, settings));
  const after = next.type === 'day' ? { type: 'night', ymd: next.ymd } : { type: 'day', ymd: T.addDaysYmd(next.ymd, 1) };
  Object.assign(after, T.shiftWindow(after.ymd, after.type, settings));
  return { cur, next, prev, after };
}

async function roundsFor(facility, win, settings) {
  const plan = (facility.roundPlan && facility.roundPlan[win.type]) || [];
  const tags = await NfcTag.find({ _id: { $in: plan.map((p) => p.tagId) } });
  const byId = new Map(tags.map((t) => [String(t._id), t]));
  return plan.map((p) => ({ tagId: p.tagId, tagName: (byId.get(String(p.tagId)) || {}).name || '', dueAt: T.planTimeInShift(win.ymd, win.type, p.time, settings) }))
    .filter((r) => r.dueAt >= win.start && r.dueAt <= win.end)
    .sort((a, b) => a.dueAt - b.dueAt);
}

const scanDoc = (sh, facility, worker, tag, result, at, extra = {}) => ({
  at, receivedAt: extra.receivedAt || at, workerId: worker._id, workerName: worker.name, shiftId: sh._id,
  facilityId: facility._id, facilityName: facility.name, tagId: tag._id, tagName: tag.name, uid: tag.uid,
  category: tag.category, result, lateMin: extra.lateMin || 0, offline: !!extra.offline, flags: extra.flags || [],
  source: 'nfc', message: extra.message || '', geo: extra.geo || facility.geo
});

// ---------- 2) živa situacija za trenutnu smenu ----------
async function buildScenario(F) {
  const now = new Date();
  const settings = await SecuritySettings.findOne({ key: 'global' }).lean();
  const tol = (settings.alarms && settings.alarms.checkpointTolMin) || 5;
  const snooze = (settings.alarms && settings.alarms.snoozeMin) || 10;
  const W = windows(settings, now);
  const { cur, next, prev, after } = W;
  const elapsed = Math.round((now - cur.start) / MIN);
  log(`trenutna smena: ${cur.type === 'day' ? 'dnevna' : 'noćna'} ${hm(cur.start)}-${hm(cur.end)} (${elapsed} min od početka)`);
  if (elapsed < 45) log('UPOZORENJE: smena je tek počela, deo situacije (propušten obilazak) će biti skromniji. Pokreni demo ponovo kasnije.');

  const admins = await Technician.find({ role: { $in: ['admin', 'superadmin'] } }).select('_id name gmail role');
  const workerByName = async (name) => SecurityWorker.findOne({ name });
  const facIds = Object.values(F).map((f) => f._id);
  const tagsOf = async (f) => NfcTag.find({ facilityId: f._id });

  // Smene se brišu zajedno sa svim što je vezano za njih (očitavanja, dosije, zadaci, zapažanja, alarmi)
  const dropShifts = async (filter) => {
    const ids = (await SecurityShift.find(filter).select('_id')).map((s) => s._id);
    if (!ids.length) return;
    await Promise.all([
      SecurityScan.deleteMany({ shiftId: { $in: ids } }),
      SecurityDossier.deleteMany({ shiftId: { $in: ids } }),
      SecurityTask.deleteMany({ shiftId: { $in: ids } }),
      SecurityObservation.deleteMany({ shiftId: { $in: ids } }),
      SecurityAlarm.deleteMany({ shiftId: { $in: ids } })
    ]);
    await SecurityShift.deleteMany({ _id: { $in: ids } });
  };

  // Čišćenje: alarmi, security obaveštenja i sve što je vezano za trenutnu smenu
  await SecurityAlarm.deleteMany({});
  await Notification.deleteMany({ type: /^security_/ });
  await SecurityScan.deleteMany({ facilityId: { $in: facIds }, at: { $gte: cur.start } });
  await SecurityScan.deleteMany({ result: 'unknown_tag' });
  await SecurityObservation.deleteMany({ facilityId: { $in: facIds }, at: { $gte: new Date(cur.start.getTime() - 60 * MIN) } });
  await SecurityTask.deleteMany({ facilityId: { $in: facIds }, dueAt: { $gte: new Date(cur.start.getTime() - 60 * MIN) } });

  // Posada trenutne smene: postojeće smene iz seed-a za Auroru i Deltu, ostali po planu
  const current = {};
  for (const key of Object.keys(F)) {
    const f = F[key];
    const existing = await SecurityShift.find({ facilityId: f._id, plannedStart: cur.start, status: { $ne: 'cancelled' } }).sort({ createdAt: 1 });
    let workerName = null;
    if ((key === 'aurora' || key === 'delta') && existing.length) {
      const w = await SecurityWorker.findById(existing[0].workerId);
      workerName = w && w.name;
    }
    if (!workerName) {
      const extra = EXTRA.find((e) => e.key === key);
      workerName = extra ? extra.crew[cur.type] : { nord: cur.type === 'day' ? 'Miloš Nikolić' : 'Uroš Janković', aurora: 'Stefan Jovanović', delta: 'Dragan Stojanović' }[key];
    }
    await dropShifts({ _id: { $in: existing.map((s) => s._id) } });
    if (!workerName) continue; // Zenit danju nema obezbeđenje
    const worker = await workerByName(workerName);
    // radnik ne sme da ima drugu smenu koja se preklapa (seed ciklus) na drugom objektu
    await dropShifts({ workerId: worker._id, plannedStart: { $lt: cur.end }, plannedEnd: { $gt: cur.start } });
    const sh = new SecurityShift({ facilityId: f._id, workerId: worker._id, date: cur.ymd, type: cur.type, plannedStart: cur.start, plannedEnd: cur.end, published: true, publishedAt: new Date(now.getTime() - 5 * 86400000), createdByName: 'E2E Admin' });
    current[key] = { sh, worker, f, tags: await tagsOf(f) };
  }

  // Sledeće smene: Nord noću dobija Uroša (seed stavlja Miloša 24 h), novi objekti po posadi, Zenit nije objavljen
  for (const win of [next, after]) {
    for (const key of ['orbit', 'aura', 'zenit', 'nord']) {
      const f = F[key];
      const extra = EXTRA.find((e) => e.key === key);
      const name = extra ? extra.crew[win.type] : (win.type === 'night' ? 'Uroš Janković' : 'Miloš Nikolić');
      await dropShifts({ facilityId: f._id, plannedStart: win.start });
      if (!name) continue;
      const worker = await workerByName(name);
      await dropShifts({ workerId: worker._id, plannedStart: { $lt: win.end }, plannedEnd: { $gt: win.start } });
      const published = !(key === 'zenit' && win === next);
      await SecurityShift.create({ facilityId: f._id, workerId: worker._id, date: win.ymd, type: win.type, plannedStart: win.start, plannedEnd: win.end, published, publishedAt: published ? new Date(now.getTime() - 5 * 86400000) : null, createdByName: 'E2E Admin' });
    }
  }

  // Prethodna smena za nove objekte: odrađena, sa izveštajem poslatim posle odjave
  for (const key of ['orbit', 'aura', 'zenit']) {
    const f = F[key];
    const extra = EXTRA.find((e) => e.key === key);
    const name = extra.crew[prev.type];
    await dropShifts({ facilityId: f._id, plannedStart: prev.start });
    if (!name) continue;
    const worker = await workerByName(name);
    const tags = await tagsOf(f);
    const wp = tags.find((t) => t.category === 'workplace');
    const inAt = new Date(prev.start.getTime() - 3 * MIN);
    const outAt = new Date(prev.end.getTime() + 2 * MIN);
    const rounds = (await roundsFor(f, prev, settings)).map((r, i) => ({ ...r, scannedAt: new Date(r.dueAt.getTime() + Math.round(rnd(`${key}p${i}`) * 3) * MIN), lateMin: 0 }));
    const sh = await SecurityShift.create({
      facilityId: f._id, workerId: worker._id, date: prev.ymd, type: prev.type, plannedStart: prev.start, plannedEnd: prev.end, published: true, publishedAt: new Date(now.getTime() - 6 * 86400000),
      status: 'done', clockIn: { at: inAt, receivedAt: inAt, tagId: wp._id, uid: wp.uid, source: 'nfc' }, clockOut: { at: outAt, receivedAt: outAt, tagId: wp._id, uid: wp.uid, source: 'nfc' },
      rounds, standingDone: f.standingTasks.map((t) => ({ taskId: t._id, text: t.text, doneAt: new Date(inAt.getTime() + 15 * MIN), comment: t.requireComment ? 'Sve u redu.' : '' })),
      handover: { radio: 'RS-11', items: ['Ključevi', 'Kartice'], condition: 'ok', at: outAt },
      report: { sentAt: new Date(outAt.getTime() + MIN), sentTo: f.reportEmails, attempts: 1 }, createdByName: 'E2E Admin'
    });
    const byId = new Map(tags.map((t) => [String(t._id), t]));
    await SecurityScan.insertMany([
      scanDoc(sh, f, worker, wp, 'clock_in', inAt),
      ...rounds.map((r) => scanDoc(sh, f, worker, byId.get(String(r.tagId)), 'checkpoint', r.scannedAt)),
      scanDoc(sh, f, worker, wp, 'clock_out', outAt)
    ]);
  }

  // Istorija trenutne smene po objektu
  const plans = {
    aurora: { inMin: -4, lateRound: 'mid' },
    delta: { inMin: 4, snoozeRound: 'mid' },
    nord: { inMin: -2, missRound: true },
    orbit: { inMin: -3, warnRound: true, offlineRound: 1, farRound: 2 },
    aura: { inMin: -5, fastRound: 2 }
  };
  const summary = [];
  for (const [key, c] of Object.entries(current)) {
    const { sh, worker, f, tags } = c;
    const p = plans[key] || { inMin: -3 };
    const wp = tags.find((t) => t.category === 'workplace');
    const byId = new Map(tags.map((t) => [String(t._id), t]));
    const inAt = new Date(Math.min(cur.start.getTime() + p.inMin * MIN, now.getTime() - MIN));
    sh.status = 'active';
    sh.lateMin = Math.max(0, p.inMin);
    sh.clockIn = { at: inAt, receivedAt: inAt, tagId: wp._id, uid: wp.uid, source: 'nfc', geo: f.geo };
    let rounds = await roundsFor(f, cur, settings);
    const pastIdx = rounds.map((r, i) => (r.dueAt.getTime() <= now.getTime() - 2 * MIN ? i : -1)).filter((i) => i >= 0);
    const scans = [scanDoc(sh, f, worker, wp, 'clock_in', inAt, { lateMin: sh.lateMin, message: sh.lateMin ? `Prijavljen u ${hm(inAt)}, kašnjenje ${sh.lateMin} min` : `Prijavljen na smenu u ${hm(inAt)}` })];
    const alarms = [];
    const dossier = [];
    const skip = new Set();
    let special = null;

    // Poslednji dospeli obilazak se pomera na "target" (ako je predaleko), da alarm bude svež kao u radu,
    // a redosled tačaka ostaje isti.
    const moveLastPast = (target) => {
      if (!rounds.length) return undefined;
      let i = pastIdx.length ? pastIdx[pastIdx.length - 1] : 0;
      const prevDue = i > 0 ? rounds[i - 1].dueAt.getTime() : cur.start.getTime();
      const nextDue = rounds[i + 1] ? rounds[i + 1].dueAt.getTime() : cur.end.getTime();
      const due = rounds[i].dueAt.getTime();
      if (Math.abs(due - target) <= 4 * MIN) return i;
      if (target > prevDue + 5 * MIN && target < nextDue - 5 * MIN) { rounds[i].dueAt = new Date(target); return i; }
      if (i > 0 && due > target) return i - 1;
      return i;
    };
    // Nord: obilazak pre ~24 min nije očitan -> prvi alarm radniku, pa drugi adminu pre ~9 min (kritičan)
    if (p.missRound && elapsed > tol + snooze + 12) {
      const i = moveLastPast(now.getTime() - (tol + snooze + 9) * MIN);
      if (i !== undefined) {
        rounds[i].alarm1At = new Date(rounds[i].dueAt.getTime() + tol * MIN);
        rounds[i].alarm2At = new Date(rounds[i].dueAt.getTime() + (tol + snooze) * MIN);
        skip.add(i);
        special = { kind: 'miss', i };
      }
    }
    // Orbit: checkpoint pre ~8 min nije očitan -> prvi alarm radniku (upozorenje), drugi tek za 30 min
    if (p.warnRound && elapsed > tol + 10) {
      const i = moveLastPast(now.getTime() - (tol + 3) * MIN);
      if (i !== undefined) {
        rounds[i].alarm1At = new Date(rounds[i].dueAt.getTime() + tol * MIN);
        skip.add(i);
        special = { kind: 'warn', i };
      }
    }

    rounds = rounds.map((r, i) => {
      if (skip.has(i) || r.dueAt.getTime() > now.getTime() - 2 * MIN) return r;
      let delay = Math.round(rnd(`${key}${i}${cur.ymd}`) * 3);
      if (p.lateRound === 'mid' && i === pastIdx[Math.floor(pastIdx.length / 2)] && pastIdx.length > 1) delay = tol + 2;
      if (p.snoozeRound === 'mid' && i === pastIdx[Math.floor(pastIdx.length / 2)] && pastIdx.length > 1) delay = tol + 8;
      const at = new Date(Math.min(r.dueAt.getTime() + delay * MIN + Math.round(rnd(`${key}s${i}`) * 50000), now.getTime() - 30000));
      return { ...r, scannedAt: at, lateMin: Math.max(0, Math.floor((at - r.dueAt) / MIN)) };
    });

    rounds.forEach((r, i) => {
      if (!r.scannedAt) return;
      const tag = byId.get(String(r.tagId));
      const extra = { lateMin: r.lateMin, message: r.lateMin > tol ? `${tag.name} očitan ${r.lateMin} min posle plana (${hm(r.dueAt)})` : `${tag.name} očitan u ${hm(r.scannedAt)}` };
      const order = pastIdx.indexOf(i);
      if (p.offlineRound !== undefined && order === p.offlineRound) { extra.offline = true; extra.receivedAt = new Date(Math.min(r.scannedAt.getTime() + 23 * MIN, now.getTime())); }
      if (p.farRound !== undefined && order === p.farRound) { extra.flags = ['far']; extra.geo = { lat: f.geo.lat + 0.0062, lng: f.geo.lng + 0.0041, acc: 18 }; }
      scans.push(scanDoc(sh, f, worker, tag, 'checkpoint', r.scannedAt, extra));
      if (p.fastRound !== undefined && order === p.fastRound) {
        const other = tags.find((t) => t.category === 'checkpoint' && String(t._id) !== String(r.tagId));
        scans.push(scanDoc(sh, f, worker, other, 'extra', new Date(r.scannedAt.getTime() + 9000), { flags: ['fast'], message: `${other.name} očitan 9 s posle prethodnog taga` }));
      }
      if (r.lateMin > tol) {
        // kasnio je: prvi alarm radniku je poslat, pa se rešio sam kad je očitao
        const snoozed = p.snoozeRound === 'mid';
        const a1 = new Date(r.dueAt.getTime() + tol * MIN);
        const reason = 'Serviser klime je u server sali, ulazim čim izađe.';
        const snoozeAt = new Date(a1.getTime() + 2 * MIN);
        const alarm = {
          kind: 'checkpoint1', level: 'warn', title: `Kasni checkpoint: ${r.tagName}`, message: `Planirano ${hm(r.dueAt)}, tolerancija ${tol} min. Prvi alarm radniku.`,
          facilityId: f._id, facilityName: f.name, shiftId: sh._id, workerId: worker._id, workerName: worker.name, roundIndex: i, tagName: r.tagName,
          firedAt: a1, state: 'resolved', resolvedAt: r.scannedAt, resolution: `Očitano ${hm(r.scannedAt)}`,
          recipients: [{ name: worker.name, role: 'guard' }], channels: ['push'], snoozes: []
        };
        if (snoozed) {
          alarm.snoozes = [{ at: snoozeAt, until: new Date(snoozeAt.getTime() + snooze * MIN), reason }];
          r.alarm1At = a1; r.snoozedUntil = alarm.snoozes[0].until; r.snoozes = alarm.snoozes;
          dossier.push({ kind: 'cp_snooze', level: 'warn', text: `Odložen alarm za ${r.tagName} (plan ${hm(r.dueAt)}) za ${snooze} min. Razlog: ${reason}.`, at: snoozeAt });
        } else { r.alarm1At = a1; }
        alarms.push(alarm);
        dossier.push({ kind: 'cp_late', level: 'warn', text: `Checkpoint ${r.tagName} očitan ${r.lateMin} min posle plana (${hm(r.dueAt)})${snoozed ? `. Razlog: ${reason}` : ''}.`, at: r.scannedAt });
      }
    });

    if (special && special.kind === 'miss') {
      const r = rounds[special.i];
      const coords = await SecurityWorker.find({ role: 'coordinator', facilityIds: f._id }).select('name');
      alarms.push({
        kind: 'checkpoint1', level: 'warn', title: `Kasni checkpoint: ${r.tagName}`, message: `Planirano ${hm(r.dueAt)}, tolerancija ${tol} min. Prvi alarm radniku.`,
        facilityId: f._id, facilityName: f.name, shiftId: sh._id, workerId: worker._id, workerName: worker.name, roundIndex: special.i, tagName: r.tagName,
        firedAt: r.alarm1At, state: 'escalated', recipients: [{ name: worker.name, role: 'guard' }], channels: ['push']
      });
      alarms.push({
        kind: 'checkpoint2', level: 'critical', title: `Drugi alarm: ${r.tagName}`, message: `Checkpoint nije očitan (plan ${hm(r.dueAt)}). Obavešten administrator.`,
        facilityId: f._id, facilityName: f.name, shiftId: sh._id, workerId: worker._id, workerName: worker.name, roundIndex: special.i, tagName: r.tagName,
        firedAt: r.alarm2At, state: 'open',
        recipients: [{ name: worker.name, role: 'guard' }, ...admins.map((a) => ({ name: a.name, role: a.role })), ...coords.map((x) => ({ name: x.name, role: 'coordinator' }))],
        channels: ['push', 'web', 'email']
      });
      dossier.push({ kind: 'cp_admin', level: 'critical', text: `Checkpoint ${r.tagName}: drugi alarm, obavešten administrator (plan ${hm(r.dueAt)}).`, at: r.alarm2At });
      for (const a of admins) {
        const n = await Notification.create({ type: 'security_alarm', priority: 'high', recipientId: a._id, title: `Propušten obilazak · ${f.name}`, message: `${worker.name}: ${r.tagName} nije očitan (plan ${hm(r.dueAt)}).`, targetPage: '/security', targetId: String(sh._id) });
        await Notification.collection.updateOne({ _id: n._id }, { $set: { createdAt: r.alarm2At } });
      }
      summary.push(`${f.name}: propušten obilazak ${r.tagName} (plan ${hm(r.dueAt)}), kritičan alarm od ${hm(r.alarm2At)}`);
    }
    if (special && special.kind === 'warn') {
      const r = rounds[special.i];
      alarms.push({
        kind: 'checkpoint1', level: 'warn', title: `Kasni checkpoint: ${r.tagName}`, message: `Planirano ${hm(r.dueAt)}, tolerancija ${tol} min. Prvi alarm radniku.`,
        facilityId: f._id, facilityName: f.name, shiftId: sh._id, workerId: worker._id, workerName: worker.name, roundIndex: special.i, tagName: r.tagName,
        firedAt: r.alarm1At, state: 'open', recipients: [{ name: worker.name, role: 'guard' }], channels: ['push']
      });
      summary.push(`${f.name}: kasni ${r.tagName} (plan ${hm(r.dueAt)}), alarm radniku od ${hm(r.alarm1At)}, drugi alarm u ${hm(new Date(r.alarm1At.getTime() + 30 * MIN))}`);
    }

    sh.rounds = rounds;
    sh.standingDone = f.standingTasks.slice(0, 2).map((t, k) => ({ taskId: t._id, text: t.text, doneAt: new Date(inAt.getTime() + (12 + k * 20) * MIN), comment: t.requireComment ? 'Pregledano, bez grešaka.' : '' }));
    await sh.save();
    await SecurityScan.insertMany(scans);
    if (sh.lateMin > 0) dossier.push({ kind: 'late', level: 'warn', text: `Kašnjenje na smenu ${sh.lateMin} min (prijava ${hm(inAt)}, početak ${hm(sh.plannedStart)}).`, at: inAt });
    for (const a of alarms) await SecurityAlarm.create({ ...a, shiftId: sh._id });
    for (const d of dossier) await SecurityDossier.create({ workerId: worker._id, facilityId: f._id, facilityName: f.name, shiftId: sh._id, ...d });
    const last = scans.reduce((m, s) => (s.at > m ? s.at : m), inAt);
    await NfcTag.updateOne({ _id: wp._id }, { $set: { lastScanAt: inAt, lastScanByName: worker.name } });
    summary.push(`${f.name}: ${worker.name} od ${hm(inAt)}, očitano ${rounds.filter((r) => r.scannedAt).length}/${rounds.length}, poslednje ${hm(last)}`);
    c.sh = sh;
  }

  // Zapažanja, primena ovlašćenja i zadaci
  const pick = (key, minFromStart) => new Date(Math.min(Math.max(cur.start.getTime() + minFromStart * MIN, cur.start.getTime() + 10 * MIN), now.getTime() - 3 * MIN));
  const ago = (min) => new Date(Math.max(now.getTime() - min * MIN, cur.start.getTime() + 8 * MIN));
  const soon = (min) => new Date(Math.min(now.getTime() + min * MIN, cur.end.getTime() - 10 * MIN));
  const obs = [];
  if (current.aurora) obs.push({ key: 'aurora', kind: 'observation', at: pick('aurora', 20), text: 'Smenu preuzeo sa blokadom alarma za sistemsku grešku na 6. spratu, na ekranu PP centrale. Obavešten tehničar hotela.' });
  if (current.delta) obs.push({ key: 'delta', kind: 'authority', at: ago(130), power: 'Udaljavanje lica iz objekta', subject: 'Nepoznato muško lice u garaži -1', witnesses: 'Recepcionerka Ana Perić', text: 'Lice je zatečeno u garaži bez ulaznice. Legitimisano i udaljeno iz objekta, bez upotrebe sile. Snimak sa kamere 3 sačuvan.' });
  if (current.orbit) obs.push({ key: 'orbit', kind: 'observation', at: ago(50), text: 'Rampa na izlazu iz garaže P2 se ne podiže do kraja. Obavestio upravu centra, serviser dolazi sutra ujutru.' });
  if (current.aura) obs.push({ key: 'aura', kind: 'observation', at: ago(200), text: 'Vozilo dostave je parkirano na mestu za hitnu pomoć. Vozač je pomerio vozilo posle upozorenja.' });
  for (const o of obs) {
    const { sh, worker, f } = current[o.key];
    const { key, ...data } = o;
    await SecurityObservation.create({ ...data, shiftId: sh._id, facilityId: f._id, facilityName: f.name, workerId: worker._id, workerName: worker.name });
  }
  const tasks = [];
  if (current.aurora) tasks.push({ key: 'aurora', dueAt: soon(40), text: 'Doček dobavljača opreme za sutrašnji događaj u sali na 1. spratu. Uputi ga na teretni lift.', createdByName: 'Milan Ilić' });
  if (current.orbit) tasks.push({ key: 'orbit', dueAt: soon(95), text: 'Posle zatvaranja proveri bravu na izlazu za evakuaciju i fotografiši je.', createdByName: 'Sanja Kostić' });
  if (current.aura) tasks.push({ key: 'aura', dueAt: pick('aura', 300), text: 'Otključaj salu za sastanke na 2. spratu i zaključaj je posle sastanka.', createdByName: 'Sanja Kostić', done: 'Otključano na vreme, zaključano posle sastanka. Sve u redu.' });
  if (current.delta) tasks.push({ key: 'delta', dueAt: soon(25), text: 'Pusti ekipu za čišćenje fasade na krov, proveri da imaju dozvolu uprave.', createdByName: 'Sanja Kostić' });
  for (const t of tasks) {
    if (!t.done && t.dueAt.getTime() <= now.getTime()) continue; // smena se završava, nema smisla novi zadatak
    const { sh, worker, f } = current[t.key];
    const doc = { facilityId: f._id, shiftId: sh._id, dueAt: t.dueAt, text: t.text, createdByName: t.createdByName, status: 'open' };
    if (t.done) Object.assign(doc, { status: 'done', doneAt: new Date(t.dueAt.getTime() + 4 * MIN), doneById: worker._id, doneByName: worker.name, comment: t.done });
    await SecurityTask.create(doc);
  }

  // Nepoznati tagovi (radnik je prislonio telefon na tag koji niko nije registrovao)
  const unk = [];
  if (current.orbit) unk.push({ key: 'orbit', uid: UNKNOWN_UIDS[0], at: ago(100) });
  if (current.delta) unk.push({ key: 'delta', uid: UNKNOWN_UIDS[1], at: ago(185) });
  for (const u of unk) {
    const { sh, worker, f } = current[u.key];
    await SecurityScan.create({ at: u.at, receivedAt: u.at, workerId: worker._id, workerName: worker.name, shiftId: sh._id, facilityId: f._id, facilityName: f.name, uid: u.uid, result: 'unknown_tag', source: 'nfc', geo: f.geo, handled: false });
    for (const a of admins) {
      const n = await Notification.create({ type: 'security_unknown_tag', priority: 'medium', recipientId: a._id, title: 'Očitan nepoznat NFC tag', message: `${worker.name} na objektu ${f.name} je očitao tag koji nije registrovan (${u.uid}). Registruj ga jednim klikom.`, targetPage: '/security/objekti?nepoznati=1', targetId: `${u.uid}:${cur.ymd}` });
      await Notification.collection.updateOne({ _id: n._id }, { $set: { createdAt: u.at } });
    }
  }

  log('situacija:');
  summary.forEach((s) => log(`  ${s}`));
  log(`  nepoznati tagovi: ${unk.length}, zadaci: ${tasks.length}, zapažanja: ${obs.length}`);
  log(`  sledeća smena ${hm(next.start)}: Data centar Zenit nije objavljen (upozorenje "smena nije objavljena")`);
  return W;
}

// ---------- 3) simulacija radnika (očitavanja na vreme, prijave, odjave, zadaci) ----------
async function simulate() {
  const { processScan } = require(path.join(B, 'services', 'security', 'scanService'));
  const settings = await SecuritySettings.findOne({ key: 'global' }).lean();
  const tol = (settings.alarms && settings.alarms.checkpointTolMin) || 5;
  log('simulacija radnika je pokrenuta (Ctrl+C ili security.ps1 stop za kraj)');
  const tagCache = new Map();
  const tagById = async (id) => { const k = String(id); if (!tagCache.has(k)) tagCache.set(k, await NfcTag.findById(id)); return tagCache.get(k); };
  const facCache = new Map();
  const facById = async (id) => { const k = String(id); if (!facCache.has(k)) facCache.set(k, await SecurityFacility.findById(id).lean()); return facCache.get(k); };
  const scan = async (worker, tag, f, extra = {}) => {
    try {
      const r = await processScan(worker, { uid: tag.uid, source: 'nfc', geo: f && f.geo && f.geo.lat != null ? { lat: f.geo.lat + 0.0002, lng: f.geo.lng, acc: 12 } : undefined, clientId: `demo-${tag._id}-${Date.now()}`, ...extra });
      log(`${worker.name} @ ${f ? f.name : '?'}: ${tag.name} -> ${r.result}${r.lateMin ? ` (+${r.lateMin} min)` : ''}`);
    } catch (e) { log(`greška pri očitavanju (${tag.name}): ${e.message}`); }
  };
  const tick = async () => {
    const now = Date.now();
    // prijave na smenu: 8 min pre početka do 3 min posle
    const planned = await SecurityShift.find({ status: 'planned', published: true, plannedStart: { $lte: new Date(now + 8 * MIN), $gte: new Date(now - 90 * MIN) } });
    for (const sh of planned) {
      const roll = rnd(`in${sh._id}`);
      const at = sh.plannedStart.getTime() + (roll > 0.86 ? 16 + Math.round(rnd(`inl${sh._id}`) * 4) : Math.round(roll * 11) - 8) * MIN;
      if (now < at) continue;
      const worker = await SecurityWorker.findById(sh.workerId);
      const f = await facById(sh.facilityId);
      const wp = await NfcTag.findOne({ facilityId: sh.facilityId, category: 'workplace', status: 'active' });
      if (worker && wp) await scan(worker, wp, f);
    }
    const active = await SecurityShift.find({ status: 'active' });
    for (const sh of active) {
      const worker = await SecurityWorker.findById(sh.workerId);
      const f = await facById(sh.facilityId);
      if (!worker) continue;
      for (let i = 0; i < sh.rounds.length; i++) {
        const r = sh.rounds[i];
        if (r.scannedAt) continue;
        if (r.alarm2At) continue; // propušten obilazak ostaje dok ga admin ne reši
        // ~30% tačaka radnik očita sa zakašnjenjem 8-13 min: stigne mu prvi alarm, pa očita pre drugog
        const late = rnd(`late${sh._id}${i}`) < 0.3;
        let at = late
          ? r.dueAt.getTime() + (tol + 3 + Math.round(rnd(`lm${sh._id}${i}`) * 5)) * MIN
          : r.dueAt.getTime() + (Math.round(rnd(`cp${sh._id}${i}`) * 5) - 2) * 30000; // -60 s .. +90 s
        // objekat sa dužim odlaganjem (Orbit, 30 min): upozorenje traje ~17 min pa radnik ipak očita
        if (r.alarm1At && f && f.rules && f.rules.snoozeMin >= 20) at = Math.max(at, r.alarm1At.getTime() + 17 * MIN);
        if (now < at) continue;
        const tag = await tagById(r.tagId);
        if (tag) await scan(worker, tag, f);
      }
      // odjava 0-6 min posle kraja smene
      const outAt = sh.plannedEnd.getTime() + Math.round(rnd(`out${sh._id}`) * 6) * MIN;
      if (now >= outAt) {
        const wp = await NfcTag.findOne({ facilityId: sh.facilityId, category: 'workplace', status: 'active' });
        if (wp) await scan(worker, wp, f, { confirmEarly: true });
      }
    }
    // zadaci: radnik ih zatvara 2-6 min posle roka, uz komentar
    const tasks = await SecurityTask.find({ status: 'open', dueAt: { $lte: new Date(now - 2 * MIN) } });
    for (const t of tasks) {
      if (now < t.dueAt.getTime() + (2 + Math.round(rnd(`t${t._id}`) * 4)) * MIN) continue;
      const sh = t.shiftId ? await SecurityShift.findById(t.shiftId) : null;
      if (!sh || sh.status !== 'active') continue;
      const worker = await SecurityWorker.findById(sh.workerId);
      await SecurityTask.updateOne({ _id: t._id, status: 'open' }, { $set: { status: 'done', doneAt: new Date(), doneById: worker._id, doneByName: worker.name, comment: 'Urađeno, bez problema.' } });
      log(`${worker.name}: urađen zadatak "${t.text.slice(0, 40)}..."`);
    }
  };
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try { await tick(); } catch (e) { log('greška u simulaciji:', e.message); }
    await new Promise((r) => setTimeout(r, 20000));
  }
}

(async () => {
  await connect();
  if (!ONLY_SIM) {
    const F = await ensureExtras();
    await buildScenario(F);
  }
  if (SIMULATE || ONLY_SIM) await simulate();
  else await mongoose.disconnect();
})().catch(async (e) => { console.error('[demo] greška:', e); await mongoose.disconnect().catch(() => {}); process.exit(1); });
