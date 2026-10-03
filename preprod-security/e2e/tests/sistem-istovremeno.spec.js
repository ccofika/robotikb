// Ceo sistem u ISTOM trenutku: radnik (telefon), admin i koordinator (web) i mehanizam alarma (server, svake
// minute) rade nešto u istoj sekundi. Svaka trka se ponavlja sa pomacima 0-60 ms u oba redosleda (ishod zavisi
// od toga koji upit prvi stigne do baze), a posle svakog pokušaja stanje mora biti dosledno: nema alarma koji
// visi posle očitavanja, nema dve prijave ni dva izveštaja, ništa se ne gubi i nema greške 500.
// Radnje idu istim API pozivima koje šalju aplikacija i web; tokovi kroz prave ekrane su u sistem-tokovi.spec.js.
const { test, expect } = require('@playwright/test');
const S = require('../helpers/scenarios');
const { setup, createShiftNow, moveShift, guardApi, scanAs, runEngine, hhmm, MIN, addDays, belgrade } = require('../helpers/api');
const db = require('../helpers/db');
const { raceAll, ok, val, sleep, clientFor, httpStatus } = require('../helpers/sistem');
const { BACKEND_DIR } = require('../helpers/env');

const { ObjectId } = require(require.resolve('mongodb', { paths: [BACKEND_DIR] }));
const oid = (x) => new ObjectId(String(x));

// Testovi su nezavisni (svaki pravi svoje stanje), pa greška u jednom ne zaustavlja ostale
test.describe.configure({ mode: 'default', timeout: 8 * 60 * 1000 });

let base; // admin, objekat Hotel Aurora, test radnik E2E Cuvar, tagovi
let g; // E2E Cuvar (telefon)
let coord; // E2E Koordinator (web)
let guard2; // E2E Cuvar Dva (zamena)
let planSnapshot;

const log = (name) => (line) => console.log(`[${name}] ${line}`);
const tagOf = (round) => base.tags.find((t) => String(t._id) === String(round.tagId));
const isOpen = (a) => a.state !== 'resolved';
const rejectedNot409 = (r) => r.status === 'rejected' && httpStatus(r) !== 409;

async function alarmsOf(shiftId, kinds) {
  return db.withDb((d) => d.collection('securityalarms').find({ shiftId: oid(shiftId), ...(kinds ? { kind: { $in: kinds } } : {}) }).toArray());
}
async function scansOf(filter) {
  return db.withDb((d) => d.collection('securityscans').find(filter).toArray());
}
async function setShift(shiftId, set) {
  return db.withDb((d) => d.collection('securityshifts').updateOne({ _id: oid(shiftId) }, { $set: set }));
}

// Plan obilaska i tagovi kao posle seed-a (povlačenje taga ih menja)
async function restoreFacility() {
  await db.withDb(async (d) => {
    await d.collection('securityfacilities').updateOne({ _id: oid(base.facility._id) }, { $set: { roundPlan: planSnapshot } });
    await d.collection('nfctags').updateMany({ facilityId: oid(base.facility._id), status: 'retired', name: { $in: base.tags.map((t) => t.name) } }, { $set: { status: 'active' } });
  });
}

async function fresh() {
  await db.resetGuard();
  return base;
}

// Radnik je prijavljen (smena iz rasporeda), tačke su u budućnosti; tačka `index` dospeva pre `dueMin` minuta
async function activeWithDue(index = 0, dueMin = -5.2, opts = {}) {
  const ctx = await fresh();
  const sh = await S.active(ctx, { firstMin: 40, stepMin: 30, ...opts });
  if (dueMin !== null) await ctx.api.post('/_test/round-due', { shiftId: sh._id, index, offsetMin: dueMin });
  return db.shift(sh._id);
}

// Mehanizam alarma između "rezervacije" alarma i upisa radi nekoliko upita (lokalno ~1 ms, na Render-u i Atlasu
// više). Test kuka produži taj razmak, pa se trka sa očitavanjem pouzdano ponavlja; ispravan kod mora da izdrži.
async function withAlarmDelay(ms, fn) {
  await base.api.post('/_test/delays', { raiseAlarm: ms });
  try { return await fn(); } finally { await base.api.post('/_test/delays', {}); }
}

// Posle odjave izveštaj se šalje u pozadini: čeka se da pokušaj slanja bude upisan
async function settledReport(shiftId, ms = 12000) {
  const end = Date.now() + ms;
  let sh = await db.shift(shiftId);
  while (!(sh.report && sh.report.attempts) && Date.now() < end) { await sleep(300); sh = await db.shift(shiftId); }
  await sleep(1500);
  return db.shift(shiftId);
}

test.beforeAll(async () => {
  base = await setup();
  g = await guardApi();
  coord = await clientFor('E2E Koordinator');
  guard2 = (await base.api.get('/workers?role=guard')).find((w) => w.name === 'E2E Cuvar Dva');
  if (!guard2) throw new Error('radnik "E2E Cuvar Dva" ne postoji (security.ps1 seed e2e)');
  planSnapshot = (await db.withDb((d) => d.collection('securityfacilities').findOne({ _id: oid(base.facility._id) }))).roundPlan;
});

test.afterAll(async () => {
  await restoreFacility();
  await db.resetGuard();
  await db.resetGuard('E2E Cuvar Dva');
  await db.withDb((d) => d.collection('securityworkers').updateOne({ _id: oid(guard2._id) }, { $pull: { facilityIds: oid(base.facility._id) } }));
});

// ---------------------------------------------------------------- alarmi i radnik u istoj sekundi

test('prijava na smenu u istoj sekundi kad se pali alarm za kašnjenje (15 min)', async () => {
  const r = await withAlarmDelay(40, () => raceAll({
    log: log('kasnjenje'),
    setup: async () => createShiftNow(await fresh(), { startMin: -15.1, endMin: 705 }),
    act: () => ({ a: () => scanAs(g, base.workplace.uid), b: () => runEngine(base) }),
    check: async (sh, res) => {
      const p = [];
      const s = await db.shift(sh._id);
      if ((val(res.a) || {}).result !== 'clock_in') p.push(`prijava nije prošla (${(val(res.a) || {}).result})`);
      if (s.status !== 'active') p.push(`smena je "${s.status}"`);
      const open = (await alarmsOf(sh._id, ['late', 'master'])).filter(isOpen);
      if (open.length) p.push(`alarm "${open[0].kind}" ostao otvoren iako je radnik prijavljen`);
      return p;
    },
  }));
  expect(r.failures, r.failures.join('\n')).toEqual([]);
});

test('prijava na smenu u istoj sekundi kad ide MASTER alarm (30 min)', async () => {
  const r = await withAlarmDelay(40, () => raceAll({
    log: log('master'),
    setup: async () => createShiftNow(await fresh(), { startMin: -30.1, endMin: 690 }),
    act: () => ({ a: () => scanAs(g, base.workplace.uid), b: () => runEngine(base) }),
    check: async (sh, res) => {
      const p = [];
      if ((val(res.a) || {}).result !== 'clock_in') p.push(`prijava nije prošla (${(val(res.a) || {}).result})`);
      const open = (await alarmsOf(sh._id, ['late', 'master'])).filter(isOpen);
      if (open.length) p.push(`alarm "${open.map((a) => a.kind).join(', ')}" ostao otvoren iako je radnik prijavljen`);
      return p;
    },
  }));
  expect(r.failures, r.failures.join('\n')).toEqual([]);
});

test('očitavanje tačke u istoj sekundi kad se pali alarm za tu tačku', async () => {
  const r = await withAlarmDelay(40, () => raceAll({
    log: log('tacka-alarm1'),
    setup: () => activeWithDue(0, -5.2),
    act: (sh) => ({ a: () => scanAs(g, tagOf(sh.rounds[0]).uid), b: () => runEngine(base) }),
    check: async (sh) => {
      const p = [];
      const s = await db.shift(sh._id);
      if (!s.rounds[0].scannedAt) p.push('tačka nije upisana kao očitana');
      const open = (await alarmsOf(sh._id, ['checkpoint1', 'checkpoint2'])).filter((a) => a.roundIndex === 0 && isOpen(a));
      if (s.rounds[0].scannedAt && open.length) p.push(`alarm "${open[0].kind}" za očitanu tačku ostao "${open[0].state}"`);
      return p;
    },
  }));
  expect(r.failures, r.failures.join('\n')).toEqual([]);
});

test('očitavanje tačke u istoj sekundi kad drugi alarm ide administratoru', async () => {
  const r = await withAlarmDelay(40, () => raceAll({
    log: log('tacka-alarm2'),
    setup: async () => {
      const sh = await activeWithDue(0, -16);
      await runEngine(base); // prvi alarm radniku
      await setShift(sh._id, { 'rounds.0.alarm1At': new Date(Date.now() - 10.2 * MIN) }); // 10 min posle prvog: sledi drugi
      return db.shift(sh._id);
    },
    act: (sh) => ({ a: () => scanAs(g, tagOf(sh.rounds[0]).uid), b: () => runEngine(base) }),
    check: async (sh) => {
      const p = [];
      const s = await db.shift(sh._id);
      if (!s.rounds[0].scannedAt) p.push('tačka nije upisana kao očitana');
      const open = (await alarmsOf(sh._id, ['checkpoint1', 'checkpoint2'])).filter((a) => a.roundIndex === 0 && isOpen(a));
      if (s.rounds[0].scannedAt && open.length) p.push(`alarm "${open.map((a) => `${a.kind}:${a.state}`).join(', ')}" ostao otvoren iako je tačka očitana`);
      return p;
    },
  }));
  expect(r.failures, r.failures.join('\n')).toEqual([]);
});

test('odjava u istoj sekundi kad se pali alarm "nema odjave" (30 min posle kraja)', async () => {
  const r = await withAlarmDelay(40, () => raceAll({
    log: log('bez-odjave'),
    settleMs: 200,
    setup: async () => {
      const ctx = await fresh();
      const sh = await S.active(ctx, { firstMin: 40, stepMin: 30 });
      return moveShift(ctx, sh._id, { endMin: -30.2 });
    },
    act: () => ({ a: () => scanAs(g, base.workplace.uid), b: () => runEngine(base) }),
    check: async (sh, res) => {
      const p = [];
      if ((val(res.a) || {}).result !== 'clock_out') p.push(`odjava nije prošla (${(val(res.a) || {}).result})`);
      const s = await settledReport(sh._id);
      const open = (await alarmsOf(sh._id, ['no_clock_out'])).filter(isOpen);
      if (s.status === 'done' && open.length) p.push('alarm "nema odjave" ostao otvoren iako je radnik odjavljen');
      if ((s.report && s.report.attempts) > 2) p.push(`izveštaj poslat ${s.report.attempts} puta`);
      return p;
    },
  }));
  expect(r.failures, r.failures.join('\n')).toEqual([]);
});

// ---------------------------------------------------------------- web i telefon u istoj sekundi

test('koordinator ručno prijavljuje radnika (web) dok se radnik prijavljuje tagom (telefon)', async () => {
  const r = await raceAll({
    log: log('rucna-prijava'),
    setup: async () => createShiftNow(await fresh(), { startMin: -1, endMin: 719 }),
    act: (sh) => ({
      a: () => coord.post(`/shifts/${sh._id}/manual`, { type: 'in', note: 'Radnik javio da mu telefon ne radi' }),
      b: () => scanAs(g, base.workplace.uid),
    }),
    check: async (sh, res) => {
      const p = [];
      const wins = (ok(res.a) ? 1 : 0) + ((val(res.b) || {}).result === 'clock_in' ? 1 : 0);
      if (wins !== 1) p.push(`prijava upisana ${wins} puta (web: ${ok(res.a) ? 'uspeh' : httpStatus(res.a)}, telefon: ${(val(res.b) || {}).result})`);
      if (rejectedNot409(res.a)) p.push(`web dobio grešku ${httpStatus(res.a)}`);
      if ((await db.shift(sh._id)).status !== 'active') p.push('smena nije aktivna');
      return p;
    },
  });
  expect(r.failures, r.failures.join('\n')).toEqual([]);
});

test('koordinator ručno odjavljuje radnika (web) dok se radnik odjavljuje tagom (telefon)', async () => {
  const r = await raceAll({
    log: log('rucna-odjava'),
    settleMs: 200,
    setup: async () => {
      const sh = await activeWithDue(0, null, { endMin: 10 });
      return sh;
    },
    act: (sh) => ({
      a: () => coord.post(`/shifts/${sh._id}/manual`, { type: 'out', note: 'Radnik javio da odlazi' }),
      b: () => scanAs(g, base.workplace.uid),
    }),
    check: async (sh, res) => {
      const p = [];
      const wins = (ok(res.a) ? 1 : 0) + ((val(res.b) || {}).result === 'clock_out' ? 1 : 0);
      if (wins !== 1) p.push(`odjava upisana ${wins} puta (web: ${ok(res.a) ? 'uspeh' : httpStatus(res.a)}, telefon: ${(val(res.b) || {}).result})`);
      if (rejectedNot409(res.a)) p.push(`web dobio grešku ${httpStatus(res.a)}`);
      const s = await settledReport(sh._id);
      if (s.status !== 'done') p.push(`smena je "${s.status}"`);
      if ((s.report && s.report.attempts) !== 1) p.push(`izveštaj poslat ${(s.report && s.report.attempts) || 0} puta`);
      return p;
    },
  });
  expect(r.failures, r.failures.join('\n')).toEqual([]);
});

test('admin menja radnika na smeni (web) baš kad se prvi radnik prijavljuje (telefon)', async () => {
  const r = await raceAll({
    log: log('zamena'),
    setup: async () => {
      const ctx = await fresh();
      await db.resetGuard('E2E Cuvar Dva');
      return createShiftNow(ctx, { startMin: 0, endMin: 720 });
    },
    act: (sh) => ({
      a: () => base.api.put(`/shifts/${sh._id}`, { workerId: guard2._id, assign: true, force: true }),
      b: () => scanAs(g, base.workplace.uid),
    }),
    check: async (sh, res) => {
      const p = [];
      const s = await db.shift(sh._id);
      if (ok(res.a) && (val(res.b) || {}).result === 'clock_in') p.push('i zamena i prijava su prošle');
      if (s.status === 'active' && String(s.workerId) !== String(base.guard._id)) p.push('smena je aktivna sa prijavom radnika E2E Cuvar, a dodeljena je radniku E2E Cuvar Dva');
      if (rejectedNot409(res.a)) p.push(`web dobio grešku ${httpStatus(res.a)}`);
      return p;
    },
  });
  expect(r.failures, r.failures.join('\n')).toEqual([]);
});

test('admin briše smenu (web) baš kad se radnik prijavljuje (telefon)', async () => {
  const r = await raceAll({
    log: log('brisanje'),
    setup: async () => createShiftNow(await fresh(), { startMin: 0, endMin: 720 }),
    act: (sh) => ({ a: () => base.api.del(`/shifts/${sh._id}`), b: () => scanAs(g, base.workplace.uid) }),
    check: async (sh, res) => {
      const p = [];
      const s = await db.shift(sh._id);
      if (!s && (val(res.b) || {}).result === 'clock_in') p.push('radnik se prijavio na smenu koja je zatim obrisana (prijava i sati su izgubljeni)');
      if (s && ok(res.a)) p.push('brisanje je javilo uspeh, a smena i dalje postoji');
      if (rejectedNot409(res.a)) p.push(`web dobio grešku ${httpStatus(res.a)}`);
      return p;
    },
  });
  expect(r.failures, r.failures.join('\n')).toEqual([]);
});

test('koordinator preuzima alarm (web) baš kad ga radnikovo očitavanje rešava (telefon)', async () => {
  const r = await raceAll({
    log: log('preuzimanje'),
    setup: async () => {
      const sh = await activeWithDue(0, -6);
      await runEngine(base);
      const al = (await alarmsOf(sh._id, ['checkpoint1']))[0];
      if (!al) throw new Error('prvi alarm nije upaljen');
      return { ...sh, alarmId: al._id };
    },
    act: (sh) => ({ a: () => coord.post(`/alarms/${sh.alarmId}/ack`), b: () => scanAs(g, tagOf(sh.rounds[0]).uid) }),
    check: async (sh, res) => {
      const p = [];
      const s = await db.shift(sh._id);
      const al = (await alarmsOf(sh._id)).find((a) => String(a._id) === String(sh.alarmId));
      if (!s.rounds[0].scannedAt) p.push('tačka nije očitana');
      if (s.rounds[0].scannedAt && al.state !== 'resolved') p.push(`alarm je ostao "${al.state}" iako je tačka očitana (visi i na webu i kod radnika)`);
      if (rejectedNot409(res.a)) p.push(`web dobio grešku ${httpStatus(res.a)}`);
      return p;
    },
  });
  expect(r.failures, r.failures.join('\n')).toEqual([]);
});

test('admin rešava alarm (web) baš kad radnik očitava tačku (telefon)', async () => {
  const r = await raceAll({
    log: log('resavanje'),
    setup: async () => {
      const sh = await activeWithDue(0, -6);
      await runEngine(base);
      return { ...sh, alarmId: (await alarmsOf(sh._id, ['checkpoint1']))[0]._id };
    },
    act: (sh) => ({
      a: () => base.api.post(`/alarms/${sh.alarmId}/resolve`, { note: 'Javio se telefonom, ide ka tački' }),
      b: () => scanAs(g, tagOf(sh.rounds[0]).uid),
    }),
    check: async (sh, res) => {
      const p = [];
      const s = await db.shift(sh._id);
      const al = (await alarmsOf(sh._id)).find((a) => String(a._id) === String(sh.alarmId));
      if (!s.rounds[0].scannedAt) p.push('tačka nije očitana');
      if (al.state !== 'resolved') p.push(`alarm je "${al.state}"`);
      if (rejectedNot409(res.a)) p.push(`web dobio grešku ${httpStatus(res.a)}`);
      return p;
    },
  });
  expect(r.failures, r.failures.join('\n')).toEqual([]);
});

test('koordinator preuzima i admin rešava isti alarm u istoj sekundi (dva weba)', async () => {
  const r = await raceAll({
    log: log('dva-weba'),
    setup: async () => {
      const sh = await activeWithDue(0, -6);
      await runEngine(base);
      return { ...sh, alarmId: (await alarmsOf(sh._id, ['checkpoint1']))[0]._id };
    },
    act: (sh) => ({
      a: () => coord.post(`/alarms/${sh.alarmId}/ack`),
      b: () => base.api.post(`/alarms/${sh.alarmId}/resolve`, { note: 'Radnik je na drugoj tački, provereno' }),
    }),
    check: async (sh, res) => {
      const p = [];
      const al = (await alarmsOf(sh._id)).find((a) => String(a._id) === String(sh.alarmId));
      if (al.state !== 'resolved') p.push(`admin je rešio alarm, a on je ostao "${al.state}"`);
      if (rejectedNot409(res.a) || rejectedNot409(res.b)) p.push('web dobio grešku');
      return p;
    },
  });
  expect(r.failures, r.failures.join('\n')).toEqual([]);
});

test('radnik odlaže alarm (telefon) u istoj sekundi kad ističe rok za drugi alarm', async () => {
  const r = await raceAll({
    log: log('odlaganje'),
    setup: async () => {
      const sh = await activeWithDue(0, -16);
      await runEngine(base);
      await setShift(sh._id, { 'rounds.0.alarm1At': new Date(Date.now() - 10.2 * MIN) });
      return { ...sh, alarmId: (await alarmsOf(sh._id, ['checkpoint1']))[0]._id };
    },
    act: (sh) => ({ a: () => g.post(`/me/alarms/${sh.alarmId}/snooze`, { reason: 'Pregledam ulaz B' }), b: () => runEngine(base) }),
    check: async (sh, res) => {
      const p = [];
      const s = await db.shift(sh._id);
      const al = (await alarmsOf(sh._id)).find((a) => String(a._id) === String(sh.alarmId));
      const escalated = !!s.rounds[0].alarm2At;
      if (escalated && ok(res.a)) p.push('radniku je odlaganje prihvaćeno, a drugi alarm je ipak otišao administratoru');
      if (escalated && al.state === 'snoozed') p.push('alarm piše "odložen", a već je eskaliran administratoru');
      if (!escalated && !ok(res.a)) p.push(`odlaganje odbijeno (${httpStatus(res.a)}), a drugog alarma nema`);
      if (rejectedNot409(res.a)) p.push(`telefon dobio grešku ${httpStatus(res.a)}`);
      return p;
    },
  });
  expect(r.failures, r.failures.join('\n')).toEqual([]);
});

// ---------------------------------------------------------------- isto očitavanje dva puta

test('isto očitavanje stiže dva puta u istoj sekundi (ponovno slanje iz reda bez interneta)', async () => {
  const r = await raceAll({
    log: log('isti-clientId'),
    setup: async () => ({ ...(await activeWithDue(0, -1)), cid: `e2e-dup-${Date.now()}` }),
    act: (sh) => {
      const body = { clientId: sh.cid, offline: true, deviceAt: new Date(Date.now() - 2000).toISOString() };
      return { a: () => scanAs(g, tagOf(sh.rounds[0]).uid, body), b: () => scanAs(g, tagOf(sh.rounds[0]).uid, body) };
    },
    check: async (sh, res) => {
      const p = [];
      if (!ok(res.a) || !ok(res.b)) p.push('jedno slanje je dobilo grešku');
      const scans = await scansOf({ clientId: sh.cid, result: 'checkpoint' });
      if (scans.length !== 1) p.push(`očitavanje upisano ${scans.length} puta`);
      if (!(await db.shift(sh._id)).rounds[0].scannedAt) p.push('tačka nije očitana');
      return p;
    },
  });
  expect(r.failures, r.failures.join('\n')).toEqual([]);
});

test('isti tag očitan sa dva uređaja u istoj sekundi (telefon i drugi telefon istog radnika)', async () => {
  const r = await raceAll({
    log: log('dva-uredjaja'),
    setup: () => activeWithDue(0, -1),
    act: (sh) => ({ a: () => scanAs(g, tagOf(sh.rounds[0]).uid), b: () => scanAs(g, tagOf(sh.rounds[0]).uid) }),
    check: async (sh, res) => {
      const p = [];
      if (!ok(res.a) || !ok(res.b)) p.push('jedan uređaj je dobio grešku');
      const scans = await scansOf({ shiftId: oid(sh._id), tagId: oid(sh.rounds[0].tagId), result: 'checkpoint' });
      if (scans.length !== 1) p.push(`tačka upisana ${scans.length} puta`);
      return p;
    },
  });
  expect(r.failures, r.failures.join('\n')).toEqual([]);
});

test('nepoznat tag očitan dva puta u istoj sekundi: admin dobija tačno jedno obaveštenje', async () => {
  const r = await raceAll({
    log: log('nepoznat'),
    setup: async () => {
      await fresh();
      const hex = Array.from({ length: 6 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase());
      return { uid: `04:E2:${hex.join(':')}`.slice(0, 20) };
    },
    act: (st) => ({ a: () => scanAs(g, st.uid), b: () => scanAs(g, st.uid) }),
    check: async (st) => {
      const p = [];
      const list = await db.withDb((d) => d.collection('notifications').find({ type: 'security_unknown_tag', targetId: { $regex: `^${st.uid}` } }).toArray());
      const per = new Map();
      list.forEach((n) => per.set(String(n.recipientId), (per.get(String(n.recipientId)) || 0) + 1));
      if (!list.length) p.push('admin nije obavešten ni jednom');
      if ([...per.values()].some((n) => n > 1)) p.push('admin je obavešten dva puta');
      return p;
    },
  });
  expect(r.failures, r.failures.join('\n')).toEqual([]);
});

// ---------------------------------------------------------------- admin menja objekat dok radnik radi

test('admin povlači tag (web) baš kad ga radnik očitava (telefon)', async () => {
  const r = await raceAll({
    log: log('povlacenje'),
    setup: async () => { await restoreFacility(); return activeWithDue(0, -1); },
    act: (sh) => ({
      a: () => base.api.post(`/tags/${sh.rounds[0].tagId}/retire`, { reason: 'E2E oštećen' }),
      b: () => scanAs(g, tagOf(sh.rounds[0]).uid),
    }),
    check: async (sh, res) => {
      const p = [];
      if (!ok(res.a) || !ok(res.b)) p.push(`greška (web: ${httpStatus(res.a)}, telefon: ${httpStatus(res.b)})`);
      const s = await db.shift(sh._id);
      const result = (val(res.b) || {}).result;
      if (!['checkpoint', 'retired_tag'].includes(result)) p.push(`neočekivan rezultat "${result}"`);
      if (result === 'checkpoint' && !s.rounds.some((x) => x.scannedAt)) p.push('rezultat "očitano", a tačka nije upisana');
      return p;
    },
  });
  await restoreFacility();
  expect(r.failures, r.failures.join('\n')).toEqual([]);
});

test('admin povlači tag usred smene: tekuća smena ga više ne traži (nema lažnih alarma)', async () => {
  await restoreFacility();
  const sh = await activeWithDue(0, null);
  // tag koji se u planu pojavljuje samo jednom
  const counts = new Map();
  sh.rounds.forEach((x) => counts.set(String(x.tagId), (counts.get(String(x.tagId)) || 0) + 1));
  const idx = sh.rounds.findIndex((x) => counts.get(String(x.tagId)) === 1);
  const round = sh.rounds[idx];
  await base.api.post(`/tags/${round.tagId}/retire`, { reason: 'E2E prostorija zatvorena' });
  try {
    await runEngine({ ...base, api: base.api });
    await base.api.post('/_test/run-engine', { at: new Date(new Date(round.dueAt).getTime() + 7 * MIN).toISOString() });
    const open = (await alarmsOf(sh._id, ['checkpoint1', 'checkpoint2'])).filter((a) => a.tagName === round.tagName && isOpen(a));
    expect(open.map((a) => `${a.kind} ${a.tagName}`), 'alarm za tag koji je admin povukao (radnik ne može da ga očita)').toEqual([]);
  } finally {
    await restoreFacility();
  }
});

test('koordinator otkaže zadatak (web), radnik ga posle završi sa starim spiskom (telefon)', async () => {
  const sh = await activeWithDue(0, null);
  const task = await base.api.post('/tasks', { shiftId: sh._id, time: hhmm(new Date(Date.now() + 20 * MIN)), text: 'E2E Proveri rampu za dostavu' });
  await coord.del(`/tasks/${task._id}`);
  let err = null;
  try { await g.post(`/me/tasks/${task._id}/done`, { comment: 'Urađeno, rampa zatvorena' }); } catch (e) { err = e; }
  const t = await db.task(task._id);
  expect(t.status, 'otkazan zadatak je postao "urađen" (otkazivanje sa weba je izgubljeno)').toBe('cancelled');
  expect(err && err.status, 'telefon treba da dobije poruku da je zadatak otkazan').toBe(409);
});

test('radnik završava zadatak (telefon) u istoj sekundi kad ga koordinator otkazuje (web)', async () => {
  const r = await raceAll({
    log: log('zadatak'),
    setup: async () => {
      const sh = await activeWithDue(0, null);
      const task = await base.api.post('/tasks', { shiftId: sh._id, time: hhmm(new Date(Date.now() + 20 * MIN)), text: 'E2E Proveri rampu za dostavu' });
      return { ...sh, taskId: task._id };
    },
    act: (st) => ({ a: () => g.post(`/me/tasks/${st.taskId}/done`, { comment: 'Urađeno, rampa zatvorena' }), b: () => coord.del(`/tasks/${st.taskId}`) }),
    check: async (st, res) => {
      const p = [];
      const t = await db.task(st.taskId);
      if (ok(res.a) && ok(res.b)) p.push(`i završavanje i otkazivanje su prošli, zadatak je "${t.status}"`);
      if (rejectedNot409(res.a) || rejectedNot409(res.b)) p.push(`greška (telefon: ${httpStatus(res.a)}, web: ${httpStatus(res.b)})`);
      if (ok(res.a) && t.status !== 'done') p.push('radnik je završio zadatak, a on je otkazan (komentar je izgubljen)');
      return p;
    },
  });
  expect(r.failures, r.failures.join('\n')).toEqual([]);
});

test('radnik označi dva stalna zadatka u istoj sekundi (telefon i web)', async () => {
  const facility = (await base.api.get('/facilities')).find((f) => String(f._id) === String(base.facility._id));
  const [t1, t2] = facility.standingTasks || [];
  expect(t2, 'objekat treba da ima bar dva stalna zadatka').toBeTruthy();
  const r = await raceAll({
    log: log('stalni'),
    setup: () => activeWithDue(0, null),
    act: (sh) => ({
      a: () => g.post(`/me/shifts/${sh._id}/standing/${t1._id}`, { comment: 'Sve u redu' }),
      b: () => g.post(`/me/shifts/${sh._id}/standing/${t2._id}`, { comment: 'Sve u redu' }),
    }),
    check: async (sh, res) => {
      const p = [];
      if (!ok(res.a) || !ok(res.b)) p.push(`greška (telefon: ${httpStatus(res.a)}, web: ${httpStatus(res.b)})`);
      const done = ((await db.shift(sh._id)).standingDone || []).map((d) => String(d.taskId));
      if (!done.includes(String(t1._id)) || !done.includes(String(t2._id))) p.push(`upisan je samo ${done.length} od 2 zadatka`);
      return p;
    },
  });
  expect(r.failures, r.failures.join('\n')).toEqual([]);
});

test('dvostruki klik na "dodaj smenu" (web): nastaje samo jedna smena', async () => {
  // dve iste smene bi dale lažan MASTER alarm i "nije došao" u dosijeu za onu na koju se radnik ne prijavi
  const r = await raceAll({
    log: log('dupla-smena'),
    offsets: [0, 0, 1, 3, 6, 10, 20, 40],
    setup: async () => { await fresh(); return { date: addDays(belgrade().ymd, 3) }; },
    act: (st) => {
      const body = { facilityId: base.facility._id, workerId: base.guard._id, date: st.date, type: 'day', force: true };
      return { a: () => base.api.post('/shifts', body), b: () => base.api.post('/shifts', body) };
    },
    check: async (st, res) => {
      const p = [];
      const list = await db.withDb((d) => d.collection('securityshifts').find({ workerId: oid(base.guard._id), date: st.date, type: 'day' }).toArray());
      if (list.length !== 1) p.push(`nastalo je ${list.length} iste smene`);
      if (rejectedNot409(res.a) || rejectedNot409(res.b)) p.push('web dobio grešku');
      return p;
    },
  });
  expect(r.failures, r.failures.join('\n')).toEqual([]);
});

test('dva odlaganja istog alarma u istoj sekundi (telefon i web radnika): najviše jedno', async () => {
  const r = await raceAll({
    log: log('dva-odlaganja'),
    offsets: [0, 0, 1, 3, 6, 10, 20],
    setup: async () => {
      const sh = await activeWithDue(0, -6);
      await runEngine(base);
      return { ...sh, alarmId: (await alarmsOf(sh._id, ['checkpoint1']))[0]._id };
    },
    act: (sh) => ({
      a: () => g.post(`/me/alarms/${sh.alarmId}/snooze`, { reason: 'Pregledam ulaz B' }),
      b: () => g.post(`/me/alarms/${sh.alarmId}/snooze`, { reason: 'Čekam policiju' }),
    }),
    check: async (sh, res) => {
      const p = [];
      const s = await db.shift(sh._id);
      if ((s.rounds[0].snoozes || []).length > 1) p.push(`alarm odložen ${(s.rounds[0].snoozes || []).length} puta (dozvoljeno je jednom)`);
      if (rejectedNot409(res.a) || rejectedNot409(res.b)) p.push('greška pri odlaganju');
      return p;
    },
  });
  expect(r.failures, r.failures.join('\n')).toEqual([]);
});

test('ista beleška poslata dva puta u istoj sekundi (isti clientId): upisana jednom', async () => {
  const r = await raceAll({
    log: log('beleska'),
    offsets: [0, 0, 1, 3, 6, 10],
    setup: async () => ({ ...(await activeWithDue(0, null)), cid: `e2e-note-${Date.now()}` }),
    act: (sh) => {
      const body = { kind: 'observation', text: 'E2E Vrata garaže ostala otvorena', clientId: sh.cid };
      return { a: () => g.post(`/me/shifts/${sh._id}/notes`, body), b: () => g.post(`/me/shifts/${sh._id}/notes`, body) };
    },
    check: async (sh) => {
      const n = await db.withDb((d) => d.collection('securityobservations').countDocuments({ clientId: sh.cid }));
      return n === 1 ? [] : [`beleška upisana ${n} puta`];
    },
  });
  expect(r.failures, r.failures.join('\n')).toEqual([]);
});

// ---------------------------------------------------------------- loši ulazi i zaštita podataka

test('neispravno vreme sa telefona (deviceAt) ne ruši prijavu ni očitavanje', async () => {
  const ctx = await fresh();
  await createShiftNow(ctx, { startMin: -1, endMin: 719 });
  const inRes = await scanAs(g, base.workplace.uid, { offline: true, deviceAt: 'nije-datum' }).catch((e) => ({ error: e.status }));
  expect(inRes.result, `prijava sa neispravnim vremenom: ${JSON.stringify(inRes)}`).toBe('clock_in');
  const sh = await activeWithDue(0, -1);
  const cpRes = await scanAs(g, tagOf(sh.rounds[0]).uid, { offline: true, deviceAt: '2026-13-45T99:99' }).catch((e) => ({ error: e.status }));
  expect(cpRes.result, `očitavanje tačke sa neispravnim vremenom: ${JSON.stringify(cpRes)}`).toBe('checkpoint');
  const s = await db.shift(sh._id);
  const saved = await scansOf({ _id: s.rounds[0].scanId });
  expect(saved.length, 'tačka pokazuje na očitavanje koje nije sačuvano').toBe(1);
});

test('clientId kao upit ({"$ne": null}) ne vraća tuđe očitavanje', async () => {
  const sh = await activeWithDue(0, -1);
  await scanAs(g, tagOf(sh.rounds[0]).uid); // postoji bar jedno očitavanje u bazi
  let res;
  try { res = await g.post('/me/scans', { uid: base.workplace.uid, clientId: { $ne: null }, deviceAt: new Date().toISOString() }); } catch (e) { res = { status: e.status }; }
  expect(res.repeated, 'server je vratio postojeće očitavanje na osnovu upita u clientId').not.toBe(true);
});

test('koordinator ne vidi alarme objekta koji mu nije dodeljen (ni preko ?facility=)', async () => {
  const other = (await base.api.get('/facilities')).find((f) => String(f._id) !== String(base.facility._id));
  const ins = await db.withDb((d) => d.collection('securityalarms').insertOne({ kind: 'master', level: 'critical', title: 'E2E tuđi objekat', message: 'E2E', facilityId: oid(other._id), facilityName: other.name, state: 'open', firedAt: new Date(), snoozes: [], recipients: [], channels: [] }));
  try {
    // ispravno je i odbijanje (403) i prazan spisak; greška je samo ako tuđi alarm stigne do koordinatora
    let list = [];
    try { list = await coord.get(`/alarms?facility=${other._id}&state=all`); } catch (e) { expect(e.status, `neočekivana greška ${e.status}`).toBe(403); }
    expect(list.filter((a) => String(a._id) === String(ins.insertedId)).length, `koordinator objekta ${base.facility.name} vidi alarm objekta ${other.name}`).toBe(0);
  } finally {
    await db.withDb((d) => d.collection('securityalarms').deleteOne({ _id: ins.insertedId }));
  }
});

test('ručna prijava na smenu koja nije objavljena se odbija (radnik je ne vidi i ne može da očitava)', async () => {
  const ctx = await fresh();
  const date = addDays(belgrade().ymd, 0);
  const win = require('../helpers/api').currentWindow();
  const draft = await ctx.api.post('/shifts', { facilityId: ctx.facility._id, workerId: ctx.guard._id, date: win.date, type: win.type, force: true });
  let err = null;
  try { await coord.post(`/shifts/${draft._id}/manual`, { type: 'in', note: 'Radnik je na objektu' }); } catch (e) { err = e; }
  const s = await db.shift(draft._id);
  expect(s.status, `ručna prijava je aktivirala neobjavljenu smenu (${date}); radnik dobija "Nemaš smenu" na svako očitavanje, a alarmi idu`).toBe('planned');
  expect(err && err.status).toBe(409);
});

// ---------------------------------------------------------------- red bez interneta

test('starije očitavanje bez interneta ne nestaje kad posle njega stigne novije istog taga', async () => {
  const sh = await activeWithDue(0, -2);
  const uid = tagOf(sh.rounds[0]).uid;
  // na telefonu: očitano pre 3 min bez interneta (u redu), pa sada ponovo dok red još nije poslat
  const queued = { offline: true, deviceAt: new Date(Date.now() - 3 * MIN).toISOString(), clientId: `e2e-old-${Date.now()}` };
  await scanAs(g, uid);
  const late = await scanAs(g, uid, queued);
  expect(late.repeated, 'starije očitavanje iz reda je proglašeno ponovljenim zbog novijeg (izgubljeno je vreme kad je stvarno očitano)').not.toBe(true);
  expect((await scansOf({ clientId: queued.clientId })).length, 'starije očitavanje nije upisano').toBe(1);
});

// ---------------------------------------------------------------- plan obilaska sa istim tagom više puta

test('isti tag dva puta u planu: propuštena ranija tačka ne "pojede" očitavanje za tekuću', async () => {
  const sh = await activeWithDue(0, null);
  const firstOf = new Map();
  let pair = null;
  sh.rounds.forEach((x, i) => {
    const k = String(x.tagId);
    if (firstOf.has(k) && !pair) pair = [firstOf.get(k), i];
    else if (!firstOf.has(k)) firstOf.set(k, i);
  });
  expect(pair, 'plan objekta treba da ima tag koji se pojavljuje dva puta (Hotel Aurora: PP centrala)').toBeTruthy();
  const [i, j] = pair;
  const now = Date.now();
  // ranija tačka je propuštena pre 3 h (drugi alarm je otišao administratoru), kasnija je upravo na redu
  await setShift(sh._id, {
    [`rounds.${i}.dueAt`]: new Date(now - 180 * MIN), [`rounds.${i}.alarm1At`]: new Date(now - 175 * MIN), [`rounds.${i}.alarm2At`]: new Date(now - 165 * MIN),
    [`rounds.${j}.dueAt`]: new Date(now - 1 * MIN),
  });
  const res = await scanAs(g, tagOf(sh.rounds[j]).uid);
  const s = await db.shift(sh._id);
  expect(res.result).toBe('checkpoint');
  expect(res.roundIndex, `očitavanje je upisano propuštenoj tački od pre 3 h (indeks ${i}) umesto tekućoj (indeks ${j})`).toBe(j);
  expect(s.rounds[j].scannedAt, 'tekuća tačka nije očitana, pa će za 5 min upaliti alarm').toBeTruthy();
  expect(s.rounds[i].scannedAt).toBeFalsy();
});

test('zadatak za objekat dok su dva radnika u smeni: vide ga oba, a zatvara ga samo jedan (i kad oba pritisnu u istoj sekundi)', async () => {
  const ctx = await fresh();
  await db.resetGuard('E2E Cuvar Dva');
  const fid = oid(base.facility._id);
  await db.withDb((d) => d.collection('securityworkers').updateOne({ _id: oid(guard2._id) }, { $addToSet: { facilityIds: fid } }));
  try {
    await S.active(ctx, { firstMin: 40, stepMin: 30 });
    // drugi radnik na istom objektu u isto vreme (drugi post)
    const win = require('../helpers/api').currentWindow();
    await ctx.api.post('/shifts', { facilityId: ctx.facility._id, workerId: guard2._id, date: win.date, type: win.type, force: true });
    await ctx.api.post('/shifts/publish', { facilityId: ctx.facility._id, from: addDays(win.date, -1), to: addDays(win.date, 1) });
    const when = new Date(Date.now() + 30 * MIN);
    const task = await coord.post('/tasks', { facilityId: ctx.facility._id, date: belgrade(when).ymd, time: hhmm(when), text: 'E2E Zajednički zadatak za oba posta' });
    const g2 = await clientFor('E2E Cuvar Dva');
    const sees = async (c) => ((await c.get('/me/current')).shift.occasional || []).some((t) => String(t._id) === String(task._id));
    expect(await sees(g), 'E2E Cuvar vidi zadatak').toBe(true);
    expect(await sees(g2), 'E2E Cuvar Dva vidi zadatak').toBe(true);
    const [r1, r2] = await Promise.allSettled([
      g.post(`/me/tasks/${task._id}/done`, { comment: 'Ulaz proveren, zaključan' }),
      g2.post(`/me/tasks/${task._id}/done`, { comment: 'Proverio i ja, sve u redu' }),
    ]);
    expect([r1, r2].filter(ok).length, 'zadatak je zatvoren tačno jednom').toBe(1);
    expect([r1, r2].filter((r) => r.status === 'rejected').map((r) => r.reason.status), 'drugi dobija poruku da je već urađen').toEqual([409]);
  } finally {
    await db.withDb((d) => d.collection('securityworkers').updateOne({ _id: oid(guard2._id) }, { $pull: { facilityIds: fid } }));
    await db.resetGuard('E2E Cuvar Dva');
  }
});
