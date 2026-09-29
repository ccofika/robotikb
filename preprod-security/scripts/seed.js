// Seed za Security pre-prod bazu: nalozi, objekti, radnici, NFC tagovi (NTAG215), plan obilaska,
// raspored ±14 dana, odrađene smene sa očitavanjima i jedna aktivna smena po objektu.
// Upotreba: node preprod-security/scripts/seed.js --reset
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
if (!/robotik_preprod_security$/.test(env.MONGODB_URI || '')) { console.error('[seed] STOP: pogrešna baza'); process.exit(1); }
Object.assign(process.env, env);

const Technician = require(path.join(B, 'models', 'Technician'));
const SecurityWorker = require(path.join(B, 'models', 'SecurityWorker'));
const SecurityFacility = require(path.join(B, 'models', 'SecurityFacility'));
const NfcTag = require(path.join(B, 'models', 'NfcTag'));
const SecurityShift = require(path.join(B, 'models', 'SecurityShift'));
const SecurityScan = require(path.join(B, 'models', 'SecurityScan'));
const SecurityObservation = require(path.join(B, 'models', 'SecurityObservation'));
const SecurityTask = require(path.join(B, 'models', 'SecurityTask'));
const SecuritySettings = require(path.join(B, 'models', 'SecuritySettings'));
const T = require(path.join(B, 'services', 'security', 'time'));

const PASSWORD = 'Preprod123!';
const DAY = 86400000;
let uidN = 1;
const uid = () => { const n = (uidN++).toString(16).padStart(4, '0').toUpperCase(); return `04:5E:${n.slice(0, 2)}:${n.slice(2)}:A1:3C:80`; };

(async () => {
  await mongoose.connect(env.MONGODB_URI);
  if (process.argv.includes('--reset')) { await mongoose.connection.db.dropDatabase(); console.log('[seed] baza obrisana'); }
  const hash = await bcrypt.hash(PASSWORD, 10);
  const now = new Date();
  const today = T.todayYmd(now);

  // Montaža nalozi (admini upravljaju i Security delom)
  for (const s of [
    { name: 'E2E Admin', role: 'admin', isAdmin: true, gmail: 'e2e.admin@preprod.local' },
    { name: 'E2E Superadmin', role: 'superadmin', isAdmin: true, gmail: 'e2e.superadmin@preprod.local' },
    { name: 'E2E Tehnicar', role: 'technician', phoneNumber: '0601111111' }
  ]) {
    await Technician.findOneAndUpdate({ name: s.name }, { $set: { ...s, password: hash, isActive: true }, $setOnInsert: { materials: [], equipment: [], basicEquipment: [] } }, { upsert: true, setDefaultsOnInsert: true });
  }
  await SecuritySettings.findOneAndUpdate({ key: 'global' }, { $setOnInsert: { key: 'global' } }, { upsert: true, setDefaultsOnInsert: true });

  // Objekti
  const F = {};
  const facilities = [
    { key: 'aurora', name: 'Hotel Aurora', type: 'Hotel', address: 'Kneza Miloša 10', city: 'Beograd', geo: { lat: 44.8069, lng: 20.4623 },
      description: 'Hotel sa 8 spratova i dve podzemne garaže. Sala na 1. spratu se iznajmljuje za događaje.',
      instructions: 'PP centrala je na recepciji. Ključevi i kartice su u kasi iza pulta obezbeđenja. Posle 23:00 ulaz za dostavu mora biti zaključan.',
      contactName: 'Recepcija hotela', contactPhone: '011 555 0100', reportEmails: ['uprava@hotel-aurora.test', 'recepcija@hotel-aurora.test'],
      standingTasks: [{ text: 'Provera PP centrale na početku smene', requireComment: true }, { text: 'Obilazak po planu' }, { text: 'Zaključavanje ulaza za dostavu posle 23:00' }, { text: 'Primopredaja ključeva i kartica' }] },
    { key: 'delta', name: 'Poslovni centar Delta', type: 'Poslovna zgrada', address: 'Bulevar Mihajla Pupina 100', city: 'Novi Beograd', geo: { lat: 44.8176, lng: 20.4204 },
      description: 'Poslovna zgrada sa 12 spratova i garažom na -1. Recepcija radi do 20:00.',
      instructions: 'Posle 20:00 posetioce pušta obezbeđenje, uz upis u knjigu posetilaca.', contactName: 'Facility služba', contactPhone: '011 555 0200',
      reportEmails: ['facility@pc-delta.test'], standingTasks: [{ text: 'Provera kamera i snimača' }, { text: 'Kontrola ulaza posle 20:00' }, { text: 'Primopredaja ključeva' }] },
    { key: 'nord', name: 'Magacin Nord', type: 'Logistički centar', address: 'Autoput za Novi Sad 5', city: 'Zemun', geo: { lat: 44.8712, lng: 20.3561 },
      description: 'Logistički centar sa šest rampi. Kamioni stižu i noću.', instructions: 'Svaki kamion posle 22:00 se upisuje na kapiji.',
      contactName: 'Šef magacina', contactPhone: '011 555 0300', reportEmails: ['logistika@nord.test'], standingTasks: [{ text: 'Provera rampi i kapije' }, { text: 'Evidencija kamiona posle 22:00', requireComment: true }] }
  ];
  for (const f of facilities) {
    const { key, standingTasks, ...data } = f;
    F[key] = await SecurityFacility.findOneAndUpdate({ name: data.name }, { $set: { ...data, standingTasks, active: true } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  }

  // Radnici i koordinatori
  const W = {};
  const workers = [
    { key: 'milan', name: 'Milan Ilić', role: 'coordinator', phone: '064 555 0102', email: 'milan.ilic@preprod.local', facilities: ['aurora', 'nord'] },
    { key: 'sanja', name: 'Sanja Kostić', role: 'coordinator', phone: '064 555 0203', email: 'sanja.kostic@preprod.local', facilities: ['delta'] },
    { key: 'stefan', name: 'Stefan Jovanović', phone: '064 123 4567', facilities: ['aurora'], until: 28, lic: [['Službenik obezbeđenja, bez oružja', 'LOB-0418', null], ['PP obuka', 'PP-2291', 900]] },
    { key: 'nenad', name: 'Nenad Lukić', phone: '063 118 2200', facilities: ['aurora'], until: 20, lic: [['Službenik obezbeđenja, bez oružja', 'LOB-0233', null]] },
    { key: 'marko', name: 'Marko Petrović', phone: '065 901 4400', facilities: ['aurora', 'delta'], until: 188, rate: 450, lic: [['Službenik obezbeđenja, sa oružjem', 'LOB-0091', null], ['PP obuka', 'PP-1102', 45]] },
    { key: 'lazar', name: 'Lazar Todorović', phone: '062 770 5500', facilities: ['aurora'], until: 112, lic: [['Službenik obezbeđenja, bez oružja', 'LOB-0512', null]] },
    { key: 'dragan', name: 'Dragan Stojanović', phone: '064 314 0000', facilities: ['delta'], until: 97, rate: 450, lic: [['Službenik obezbeđenja, sa oružjem', 'LOB-0044', null]] },
    { key: 'ivana', name: 'Ivana Marković', phone: '060 541 9000', facilities: ['delta'], until: null, lic: [['Službenik obezbeđenja, bez oružja', 'LOB-0620', null], ['Prva pomoć', 'PPM-802', 400]] },
    { key: 'petar', name: 'Petar Ristić', phone: '063 400 2000', facilities: ['delta'], until: 216, lic: [['Službenik obezbeđenja, bez oružja', 'LOB-0701', null]] },
    { key: 'milos', name: 'Miloš Nikolić', phone: '061 128 8000', facilities: ['nord'], until: 277, lic: [['Službenik obezbeđenja, bez oružja', 'LOB-0377', null]] },
    // ASCII nalozi za E2E testove (Maestro ne kuca dijakritike pouzdano)
    { key: 'e2eGuard', name: 'E2E Cuvar', phone: '060 000 1001', facilities: ['aurora'], until: 365 },
    { key: 'e2eGuard2', name: 'E2E Cuvar Dva', phone: '060 000 1002', facilities: ['delta'], until: 365 },
    { key: 'e2eCoord', name: 'E2E Koordinator', role: 'coordinator', phone: '060 000 2001', email: 'e2e.koordinator@preprod.local', facilities: ['aurora'] }
  ];
  for (const w of workers) {
    const licenses = (w.lic || []).map(([type, number, days]) => ({ type, number, issuedAt: new Date(now.getTime() - 400 * DAY), validUntil: days ? new Date(now.getTime() + days * DAY) : null }));
    W[w.key] = await SecurityWorker.findOneAndUpdate({ name: w.name }, {
      $set: {
        name: w.name, password: hash, role: w.role || 'guard', isActive: true, phone: w.phone, email: w.email || '',
        address: 'Beograd', birthDate: new Date(1990, 2, 14), jmbg: '1403990710123',
        contract: { from: new Date(now.getTime() - 300 * DAY), until: w.until === undefined || w.until === null ? null : new Date(now.getTime() + w.until * DAY) },
        hourlyRate: w.rate || null, facilityIds: w.facilities.map((k) => F[k]._id), licenses, alertsSent: []
      }
    }, { upsert: true, new: true, setDefaultsOnInsert: true });
  }

  // NFC tagovi (NTAG215) i plan obilaska
  const TG = {};
  const tagDefs = {
    aurora: [['wp', 'Recepcija, pult obezbeđenja', 'Prizemlje'], ['pp', 'PP centrala', 'Prizemlje, recepcija'], ['sala', 'Sala 1. sprat', '1. sprat'], ['garaza', 'Garaža -2', 'Garaža -2'], ['hodnik', 'Hodnik 6. sprat', '6. sprat, PP detektor'], ['dostava', 'Ulaz za dostavu', 'Dvorište'], ['krov', 'Krov, mašinska sala', 'Krov']],
    delta: [['wp', 'Recepcija, ulaz A', 'Prizemlje'], ['g1', 'Garaža -1', 'Garaža -1'], ['server', 'Server sala 3. sprat', '3. sprat'], ['stepenice', 'Požarno stepenište', 'Sve etaže'], ['krov', 'Krov', 'Krov']],
    nord: [['wp', 'Kapija, portirnica', 'Ulaz'], ['r1', 'Rampa 1', 'Rampe'], ['r4', 'Rampa 4', 'Rampe'], ['skl', 'Skladište B', 'Hala B'], ['ograda', 'Ograda istok', 'Dvorište']]
  };
  await NfcTag.deleteMany({ facilityId: { $in: Object.values(F).map((f) => f._id) } });
  for (const [fk, defs] of Object.entries(tagDefs)) {
    TG[fk] = {};
    for (const [k, name, location] of defs) {
      TG[fk][k] = await NfcTag.create({ facilityId: F[fk]._id, category: k === 'wp' ? 'workplace' : 'checkpoint', name, location, uid: uid(), chip: 'NTAG215', history: [{ action: 'created', byName: 'E2E Admin', details: 'seed' }], createdByName: 'E2E Admin' });
    }
  }
  const plan = (fk, items) => items.map(([k, time]) => ({ tagId: TG[fk][k]._id, time }));
  F.aurora.roundPlan = {
    day: plan('aurora', [['pp', '09:00'], ['sala', '11:00'], ['garaza', '13:00'], ['hodnik', '15:00'], ['dostava', '17:00'], ['pp', '18:30']]),
    night: plan('aurora', [['pp', '20:00'], ['sala', '21:00'], ['garaza', '22:00'], ['hodnik', '23:30'], ['dostava', '01:00'], ['krov', '03:00'], ['garaza', '05:00'], ['pp', '06:30']])
  };
  F.delta.roundPlan = { day: plan('delta', [['g1', '10:00'], ['server', '13:00'], ['stepenice', '16:00'], ['krov', '18:00']]), night: plan('delta', [['g1', '21:00'], ['server', '00:00'], ['stepenice', '03:00'], ['krov', '06:00']]) };
  F.nord.roundPlan = { day: plan('nord', [['r1', '09:00'], ['r4', '12:00'], ['skl', '15:00'], ['ograda', '18:00']]), night: plan('nord', [['r1', '21:00'], ['r4', '00:00'], ['skl', '03:00'], ['ograda', '05:30']]) };
  for (const f of Object.values(F)) await f.save();

  // Raspored: ciklus dan, noć, slobodan, slobodan (4 radnika pokrivaju objekat 24/7)
  await SecurityShift.deleteMany({});
  await SecurityScan.deleteMany({});
  await SecurityObservation.deleteMany({});
  await SecurityTask.deleteMany({});
  const settings = await SecuritySettings.findOne({ key: 'global' });
  const cycles = { aurora: ['stefan', 'nenad', 'marko', 'lazar'], delta: ['dragan', 'ivana', 'petar', 'marko'] };
  const dayIdx = (ymd) => Math.round((Date.UTC(...ymd.split('-').map((x, i) => (i === 1 ? x - 1 : +x))) - Date.UTC(2026, 0, 5)) / DAY);
  const shiftsToMake = [];
  for (let d = -14; d <= 14; d++) {
    const ymd = T.addDaysYmd(today, d);
    const idx = dayIdx(ymd);
    for (const [fk, crew] of Object.entries(cycles)) {
      for (let k = 0; k < 4; k++) {
        const pos = (((idx - k) % 4) + 4) % 4;
        if (pos > 1) continue;
        const who = crew[k];
        if (fk === 'delta' && who === 'marko') continue; // Marko je na Delti samo povremeno
        shiftsToMake.push({ fk, who, ymd, type: pos === 0 ? 'day' : 'night' });
      }
    }
    // Delta: Marko pokriva rupe na Delti kad je slobodan u hotelu
    shiftsToMake.push(...(d % 5 === 0 ? [{ fk: 'nord', who: 'milos', ymd, type: 'night' }] : []));
    if (d >= -14 && d <= 14 && d % 2 === 0) shiftsToMake.push({ fk: 'nord', who: 'milos', ymd, type: 'day' });
  }
  const seen = new Set();
  let created = 0;
  for (const sm of shiftsToMake) {
    const key = `${sm.who}|${sm.ymd}|${sm.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { start, end } = T.shiftWindow(sm.ymd, sm.type, settings);
    // radnik ne sme da ima dve smene koje se preklapaju
    const clash = await SecurityShift.findOne({ workerId: W[sm.who]._id, plannedStart: { $lt: end }, plannedEnd: { $gt: start } });
    if (clash) continue;
    const published = start.getTime() < now.getTime() + 7 * DAY;
    const sh = new SecurityShift({ facilityId: F[sm.fk]._id, workerId: W[sm.who]._id, date: sm.ymd, type: sm.type, plannedStart: start, plannedEnd: end, published, publishedAt: published ? new Date(now.getTime() - 10 * DAY) : null, createdByName: 'E2E Admin' });
    const facility = F[sm.fk];
    const buildRounds = () => (facility.roundPlan[sm.type] || []).map((p) => ({ tagId: p.tagId, tagName: [...Object.values(TG[sm.fk])].find((t) => String(t._id) === String(p.tagId)).name, dueAt: T.planTimeInShift(sm.ymd, sm.type, p.time, settings) })).sort((a, b) => a.dueAt - b.dueAt);
    const wp = TG[sm.fk].wp;
    const worker = W[sm.who];
    const isNordToday = sm.fk === 'nord' && start <= now && end > now;
    if (end <= now) {
      // odrađena smena
      const late = (created % 9 === 4) ? 6 : 0;
      const inAt = new Date(start.getTime() + (late ? late : -4) * 60000);
      const outAt = new Date(end.getTime() + 2 * 60000);
      sh.status = 'done'; sh.lateMin = late;
      sh.clockIn = { at: inAt, receivedAt: inAt, tagId: wp._id, uid: wp.uid, source: 'nfc' };
      sh.clockOut = { at: outAt, receivedAt: outAt, tagId: wp._id, uid: wp.uid, source: 'nfc' };
      sh.rounds = buildRounds().map((r, i) => { const lm = (created + i) % 11 === 3 ? 7 : 0; return { ...r, scannedAt: new Date(r.dueAt.getTime() + (lm || 1) * 60000), lateMin: lm }; });
      sh.standingDone = facility.standingTasks.map((t) => ({ taskId: t._id, text: t.text, doneAt: new Date(inAt.getTime() + 15 * 60000), comment: t.requireComment ? 'Bez grešaka na displeju.' : '' }));
      sh.handover = { radio: 'RS-04', items: ['Kartice', 'Ključevi', 'Mob. tel.'], condition: 'ok', at: outAt };
      sh.report = { sentAt: new Date(outAt.getTime() + 60000), sentTo: facility.reportEmails, attempts: 1 };
      await sh.save();
      const scans = [{ at: inAt, result: 'clock_in', tag: wp, lateMin: late }, ...sh.rounds.map((r) => ({ at: r.scannedAt, result: 'checkpoint', tag: Object.values(TG[sm.fk]).find((t) => String(t._id) === String(r.tagId)), lateMin: r.lateMin })), { at: outAt, result: 'clock_out', tag: wp }];
      await SecurityScan.insertMany(scans.map((s) => ({ at: s.at, receivedAt: s.at, workerId: worker._id, workerName: worker.name, shiftId: sh._id, facilityId: facility._id, facilityName: facility.name, tagId: s.tag._id, tagName: s.tag.name, uid: s.tag.uid, category: s.tag.category, result: s.result, lateMin: s.lateMin || 0, source: 'nfc' })));
    } else if (start <= now && !isNordToday) {
      // aktivna smena (radnik je prijavljen, deo obilaska je urađen)
      const late = sm.fk === 'delta' ? 4 : 0;
      const inAt = new Date(start.getTime() + (late || -4) * 60000);
      sh.status = 'active'; sh.lateMin = late;
      sh.clockIn = { at: inAt, receivedAt: inAt, tagId: wp._id, uid: wp.uid, source: 'nfc' };
      sh.rounds = buildRounds().map((r) => (r.dueAt.getTime() < now.getTime() - 10 * 60000 ? { ...r, scannedAt: new Date(r.dueAt.getTime() + 2 * 60000), lateMin: 2 } : r));
      await sh.save();
      await SecurityScan.create({ at: inAt, receivedAt: inAt, workerId: worker._id, workerName: worker.name, shiftId: sh._id, facilityId: facility._id, facilityName: facility.name, tagId: wp._id, tagName: wp.name, uid: wp.uid, category: 'workplace', result: 'clock_in', lateMin: late, source: 'nfc' });
      for (const r of sh.rounds.filter((x) => x.scannedAt)) {
        const tg = Object.values(TG[sm.fk]).find((t) => String(t._id) === String(r.tagId));
        await SecurityScan.create({ at: r.scannedAt, receivedAt: r.scannedAt, workerId: worker._id, workerName: worker.name, shiftId: sh._id, facilityId: facility._id, facilityName: facility.name, tagId: tg._id, tagName: tg.name, uid: tg.uid, category: 'checkpoint', result: 'checkpoint', lateMin: 2, source: 'nfc' });
      }
      if (sm.fk === 'aurora') {
        await SecurityObservation.create({ kind: 'observation', shiftId: sh._id, facilityId: facility._id, facilityName: facility.name, workerId: worker._id, workerName: worker.name, at: new Date(inAt.getTime() + 20 * 60000), text: 'Smenu preuzeo sa blokadom alarma za sistemsku grešku na 6. spratu, na ekranu PP centrale.' });
        const due = new Date(Math.min(end.getTime() - 60 * 60000, Math.max(now.getTime() + 45 * 60000, start.getTime() + 60 * 60000)));
        await SecurityTask.create({ facilityId: facility._id, shiftId: sh._id, dueAt: due, text: 'Doček dobavljača opreme za sutrašnji događaj u sali na 1. spratu. Uputi ga na teretni lift.', createdByName: 'Milan Ilić' });
      }
      if (sm.fk === 'delta') {
        await require(path.join(B, 'models', 'SecurityDossier')).create({ workerId: worker._id, kind: 'late', level: 'warn', text: `Kašnjenje na smenu ${late} min (prijava ${T.instantToLocal(inAt).hhmm}).`, facilityId: facility._id, facilityName: facility.name, shiftId: sh._id, at: inAt });
      }
    } else {
      await sh.save();
    }
    created++;
  }
  console.log(`[seed] smena: ${created}`);
  // Poslednje očitavanje svakog taga (kao u radu: vidi se koji tag se koristi, a koji je možda oštećen)
  const lastScans = await SecurityScan.aggregate([{ $match: { tagId: { $ne: null } } }, { $sort: { at: -1 } }, { $group: { _id: '$tagId', at: { $first: '$at' }, name: { $first: '$workerName' } } }]);
  for (const l of lastScans) await NfcTag.updateOne({ _id: l._id }, { $set: { lastScanAt: l.at, lastScanByName: l.name } });
  console.log('[seed] nalozi (lozinka za sve: Preprod123!):');
  console.log('  web:  E2E Admin, E2E Superadmin, Milan Ilić / E2E Koordinator (koordinator)');
  console.log('  app:  Stefan Jovanović, E2E Cuvar (radnik obezbeđenja)');
  await mongoose.disconnect();
})().catch(async (e) => { console.error('[seed] greška:', e); await mongoose.disconnect().catch(() => {}); process.exit(1); });
