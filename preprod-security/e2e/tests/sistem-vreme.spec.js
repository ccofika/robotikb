// Vremenski osetljive granice celog sistema, sa virtuelnim satom servera (i emulatora / pregledača gde treba):
// noć promene sata (13 h i 11 h), kraj meseca i Nova godina u satnici, granice alarma tačno u sekundi,
// primopredaja dva radnika u 07:00, brzi zadatak sa weba pre ponoći i očitavanje bez interneta posle odjave.
// Smene su uvek dnevna 07-19 i noćna 19-07 (po zidnom satu u Srbiji).
const path = require('path');
const { test, expect } = require('@playwright/test');
const api = require('../helpers/api');
const db = require('../helpers/db');
const clock = require('../helpers/clock');
const S = require('../helpers/scenarios');
const { runFlow } = require('../helpers/maestro');
const { webLogin } = require('../helpers/web');
const { GUARD, PASSWORD, WEB_URL, BACKEND_DIR } = require('../helpers/env');

const T = require(path.join(BACKEND_DIR, 'services', 'security', 'time'));
const { ObjectId } = require(require.resolve('mongodb', { paths: [BACKEND_DIR] }));
const oid = (x) => new ObjectId(String(x));

test.describe.configure({ mode: 'default', timeout: 12 * 60 * 1000 });

const MIN = api.MIN;
const at = (ymd, hhmm, sec = 0) => new Date(T.localToInstant(ymd, hhmm).getTime() + sec * 1000);
const iso = (d) => new Date(d).toISOString();
const rx = (v) => String(v).replace(/[^\x20-\x7e]/g, '.');
const flow = (file, vars = {}) => runFlow(file, Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, rx(v)])));

let ctx; let g; let g2; let guard2;

// Skok servera u trenutak (tokeni se izdaju po satu servera, pa se posle skoka uzimaju novi)
async function jump(when) {
  await clock.setServer(new Date(when));
  ctx = await api.setup();
  g = await api.guardApi();
  g2 = await api.guardApi('E2E Cuvar Dva');
}
const engineAt = (when) => ctx.api.post('/_test/run-engine', { at: iso(when) });

async function makeShift(worker, date, type) {
  const sh = await ctx.api.post('/shifts', { facilityId: ctx.facility._id, workerId: worker._id, date, type, force: true });
  await ctx.api.post('/shifts/publish', { facilityId: ctx.facility._id, from: date, to: date });
  return sh;
}
async function alarmsOf(shiftId, kind) {
  return db.withDb((d) => d.collection('securityalarms').find({ shiftId: oid(shiftId), ...(kind ? { kind } : {}) }).toArray());
}
async function timesheetRow(month, name = GUARD) {
  const ts = await ctx.api.get(`/timesheets?month=${month}`);
  return (ts.rows || []).find((r) => r.name === name) || null;
}
async function webAt(browser, name, when, path = '/security') {
  const context = await browser.newContext({ baseURL: WEB_URL, timezoneId: 'Europe/Belgrade', reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  if (when) await page.clock.setFixedTime(new Date(when));
  await webLogin(page, name);
  await page.goto(path);
  return { page, close: () => context.close() };
}

test.beforeAll(async () => {
  ctx = await api.setup();
  guard2 = (await ctx.api.get('/workers?role=guard')).find((w) => w.name === 'E2E Cuvar Dva');
  await db.withDb((d) => d.collection('securityworkers').updateOne({ _id: oid(guard2._id) }, { $addToSet: { facilityIds: oid(ctx.facility._id) } }));
});

test.afterEach(async () => {
  await clock.reset();
});

test.afterAll(async () => {
  await clock.reset();
  await db.resetGuard();
  await db.resetGuard('E2E Cuvar Dva');
  await db.withDb((d) => d.collection('securityworkers').updateOne({ _id: oid(guard2._id) }, { $pull: { facilityIds: oid(ctx.facility._id) } }));
});

test('noć vraćanja sata (24/25.10.2026): smena traje 13 h, telefon, web, alarmi i satnica računaju tačno', async ({ browser }) => {
  await db.resetGuard();
  await jump(at('2026-10-24', '12:00'));
  const sh = await makeShift(ctx.guard, '2026-10-24', 'night');
  const s0 = await db.shift(sh._id);
  expect(iso(s0.plannedStart), 'početak 19:00 po letnjem vremenu').toBe('2026-10-24T17:00:00.000Z');
  expect(iso(s0.plannedEnd), 'kraj 07:00 po zimskom vremenu').toBe('2026-10-25T06:00:00.000Z');
  expect((s0.plannedEnd - s0.plannedStart) / 3600000).toBe(13);

  await jump(at('2026-10-24', '18:58'));
  expect((await api.scanAs(g, ctx.workplace.uid)).result).toBe('clock_in');
  const due = (await db.shift(sh._id)).rounds.map((r) => iso(r.dueAt));
  expect(due, '01:00 je još po letnjem vremenu').toContain('2026-10-24T23:00:00.000Z');
  expect(due, '03:00 je posle vraćanja sata').toContain('2026-10-25T02:00:00.000Z');
  expect(due, '06:30 po zimskom vremenu').toContain('2026-10-25T05:30:00.000Z');

  // 00:30 (pre vraćanja sata): do 07:00 ima još 7 h 30 min stvarnog vremena (po zidnom satu bi bilo 6 h 30 min)
  const midnight = '2026-10-24T22:30:00.000Z';
  await clock.travel(new Date(midnight));
  ctx = await api.setup(); g = await api.guardApi();
  runFlow('guard-login.yaml', { GUARD_NAME: GUARD, GUARD_PASSWORD: PASSWORD });
  flow('t-text.yaml', { TEXT: '.*do 07:00 · još 7 h (29|30) min.*', SHOT: 'vreme-dst-telefon' });
  const web = await webAt(browser, 'E2E Admin', midnight);
  try {
    await expect(web.page.locator('.sx-rail__shift-left'), 'meni na webu: preostalo vreme noćne smene (stvarno, ne po zidnom satu)').toHaveText(/još 7 h (29|30) min/);
  } finally { await web.close(); }
  // 02:30 drugi put (sat je u 03:00 vraćen na 02:00)
  const night = '2026-10-25T01:30:00.000Z';
  await clock.setServer(new Date(night));
  ctx = await api.setup(); g = await api.guardApi();

  // tačka u 03:00 (posle vraćanja sata) nije na redu u 02:30, a jeste u 03:06
  await engineAt(night);
  const krov = (await db.shift(sh._id)).rounds.findIndex((r) => iso(r.dueAt) === '2026-10-25T02:00:00.000Z');
  expect((await alarmsOf(sh._id, 'checkpoint1')).filter((a) => a.roundIndex === krov).length, 'alarm za 03:00 već u 02:30').toBe(0);
  await engineAt('2026-10-25T02:06:00.000Z');
  expect((await alarmsOf(sh._id, 'checkpoint1')).filter((a) => a.roundIndex === krov).length, 'alarm za 03:00 u 03:06').toBe(1);

  await jump('2026-10-25T06:00:30.000Z');
  expect((await api.scanAs(g, ctx.workplace.uid)).result).toBe('clock_out');
  const row = await timesheetRow('2026-10');
  expect(row.paidMin, 'plaćeno 13 h').toBe(780);
  expect(row.nightMin, 'noćni rad 22-06 je te noći 9 h').toBe(540);
});

test('noć pomeranja sata unapred (27/28.3.2027): smena traje 11 h i plaća se 11 h', async () => {
  await db.resetGuard();
  await jump(at('2027-03-27', '12:00'));
  const sh = await makeShift(ctx.guard, '2027-03-27', 'night');
  const s0 = await db.shift(sh._id);
  expect((s0.plannedEnd - s0.plannedStart) / 3600000).toBe(11);
  await jump(at('2027-03-27', '18:59'));
  expect((await api.scanAs(g, ctx.workplace.uid)).result).toBe('clock_in');
  const due = (await db.shift(sh._id)).rounds.map((r) => iso(r.dueAt));
  expect(due, '03:00 po letnjem vremenu (01:00 UTC)').toContain('2027-03-28T01:00:00.000Z');
  await jump(at('2027-03-28', '07:00', 20));
  expect((await api.scanAs(g, ctx.workplace.uid)).result).toBe('clock_out');
  const row = await timesheetRow('2027-03');
  expect(row.paidMin, 'plaćeno 11 h').toBe(660);
  expect(row.nightMin, 'noćni rad 22-06 je te noći 7 h').toBe(420);
});

test('noćna smena preko kraja meseca (31.10. na 1.11.) ide u satnicu oktobra, ne novembra', async () => {
  await db.resetGuard();
  await jump(at('2026-10-31', '12:00'));
  await makeShift(ctx.guard, '2026-10-31', 'night');
  await jump(at('2026-10-31', '18:59'));
  expect((await api.scanAs(g, ctx.workplace.uid)).result).toBe('clock_in');
  await jump(at('2026-11-01', '07:00', 20));
  expect((await api.scanAs(g, ctx.workplace.uid)).result).toBe('clock_out');
  expect((await timesheetRow('2026-10')).paidMin, 'oktobar: cela smena').toBe(720);
  const nov = await timesheetRow('2026-11');
  expect(nov ? nov.paidMin : 0, 'novembar: smena se ne računa dva puta').toBe(0);
});

test('noćna smena za Novu godinu: od ponoći do 07:00 je praznik (7 h)', async () => {
  await db.resetGuard();
  await jump(at('2026-12-31', '12:00'));
  await makeShift(ctx.guard, '2026-12-31', 'night');
  await jump(at('2026-12-31', '18:59'));
  expect((await api.scanAs(g, ctx.workplace.uid)).result).toBe('clock_in');
  await jump(at('2027-01-01', '07:00', 20));
  expect((await api.scanAs(g, ctx.workplace.uid)).result).toBe('clock_out');
  const row = await timesheetRow('2026-12');
  expect(row.paidMin).toBe(720);
  expect(row.holidayMin, '1.1. od 00:00 do 07:00').toBe(420);
  expect(row.nightMin, 'noćni rad 22-06').toBe(480);
});

test('granice u sekundi: kašnjenje tačno 15:00, MASTER tačno 30:00, propuštena smena tačno u 19:00', async () => {
  await db.resetGuard();
  const D = api.addDays(api.belgrade().ymd, 25);
  await jump(at(D, '06:50'));
  const sh = await makeShift(ctx.guard, D, 'day');
  await engineAt(at(D, '07:14', 59));
  expect((await alarmsOf(sh._id, 'late')).length, '14:59 posle početka: još nema alarma').toBe(0);
  await engineAt(at(D, '07:15'));
  expect((await alarmsOf(sh._id, 'late')).length, '15:00 posle početka: alarm radniku').toBe(1);
  await engineAt(at(D, '07:29', 59));
  expect((await alarmsOf(sh._id, 'master')).length, '29:59: još nema MASTER alarma').toBe(0);
  await engineAt(at(D, '07:30'));
  expect((await alarmsOf(sh._id, 'master')).length, '30:00: MASTER alarm').toBe(1);
  await engineAt(at(D, '18:59', 59));
  expect((await db.shift(sh._id)).status, '18:59:59: smena još nije propuštena').toBe('planned');
  await engineAt(at(D, '19:00'));
  expect((await db.shift(sh._id)).status, '19:00: smena je propuštena').toBe('missed');
});

test('granice u sekundi: prijava od 60 min pre početka, tolerancija tačke 5:00, "nema odjave" tačno 30:00 posle kraja', async () => {
  await db.resetGuard();
  const D = api.addDays(api.belgrade().ymd, 26);
  await jump(at(D, '05:50'));
  const sh = await makeShift(ctx.guard, D, 'day');
  await jump(at(D, '05:59', 58));
  expect((await api.scanAs(g, ctx.workplace.uid)).result, '60 min i 2 s pre početka: prijava još nije otvorena').toBe('no_shift');
  await jump(at(D, '06:00', 1));
  expect((await api.scanAs(g, ctx.workplace.uid)).result, 'tačno 60 min pre početka: prijava radi').toBe('clock_in');
  const r0 = (await db.shift(sh._id)).rounds[0];
  await engineAt(new Date(new Date(r0.dueAt).getTime() + 5 * MIN - 1000));
  expect((await alarmsOf(sh._id, 'checkpoint1')).filter((a) => a.roundIndex === 0).length, '4:59 posle plana: u toleranciji').toBe(0);
  await engineAt(new Date(new Date(r0.dueAt).getTime() + 5 * MIN));
  expect((await alarmsOf(sh._id, 'checkpoint1')).filter((a) => a.roundIndex === 0).length, '5:00 posle plana: prvi alarm').toBe(1);
  await engineAt(at(D, '19:29', 59));
  expect((await alarmsOf(sh._id, 'no_clock_out')).length, '29:59 posle kraja: još nema alarma').toBe(0);
  await engineAt(at(D, '19:30'));
  expect((await alarmsOf(sh._id, 'no_clock_out')).length, '30:00 posle kraja: alarm "nema odjave"').toBe(1);
});

test('primopredaja u 07:00: noćni i dnevni radnik na istom objektu u istim minutima', async () => {
  await db.resetGuard();
  await db.resetGuard('E2E Cuvar Dva');
  const D = api.addDays(api.belgrade().ymd, 27);
  const D1 = api.addDays(D, 1);
  await jump(at(D, '12:00'));
  const nightSh = await makeShift(guard2, D, 'night');
  const daySh = await makeShift(ctx.guard, D1, 'day');
  await jump(at(D, '18:55'));
  expect((await api.scanAs(g2, ctx.workplace.uid)).result, 'noćni radnik se prijavljuje').toBe('clock_in');
  await jump(at(D1, '06:55'));
  expect((await api.scanAs(g, ctx.workplace.uid)).result, 'dnevni radnik se prijavljuje pre 07:00').toBe('clock_in');
  const n1 = await db.shift(nightSh._id);
  expect(n1.status, 'noćni radnik je i dalje u smeni').toBe('active');
  expect(n1.receivedBy && n1.receivedBy.name, 'noćna smena beleži ko je primio smenu').toBe(GUARD);
  // noćni radnik očitava poslednju tačku (06:30) u 06:58: ide u NJEGOVU smenu
  const ppNight = n1.rounds.findIndex((r) => T.instantToLocal(r.dueAt).hhmm === '06:30');
  const ppTag = ctx.tags.find((t) => String(t._id) === String(n1.rounds[ppNight].tagId));
  await jump(at(D1, '06:58'));
  const nScan = await api.scanAs(g2, ppTag.uid);
  expect(nScan.result).toBe('checkpoint');
  expect(String(nScan.shiftId), 'očitavanje noćnog radnika ide u noćnu smenu').toBe(String(nightSh._id));
  // dnevni radnik isti tag u 07:01: ide u dnevnu smenu, ne "krade" tačku noćne smene
  await jump(at(D1, '07:01'));
  const dScan = await api.scanAs(g, ppTag.uid);
  expect(String(dScan.shiftId), 'očitavanje dnevnog radnika ide u dnevnu smenu').toBe(String(daySh._id));
  // noćni radnik se odjavljuje u 07:03 (posle početka sledeće smene): uredno, bez "rane odjave"
  await jump(at(D1, '07:03'));
  const out = await api.scanAs(g2, ctx.workplace.uid);
  expect(out.result).toBe('clock_out');
  const n2 = await db.shift(nightSh._id);
  expect(n2.clockOut.early).toBe(false);
  expect((await db.shift(daySh._id)).status, 'dnevna smena teče dalje').toBe('active');
});

test('brzi zadatak sa weba u 23:10: "za 1 h" je sutra posle ponoći, ne današnji 00:10 koji je prošao', async ({ browser }) => {
  await db.resetGuard();
  const today = api.belgrade().ymd;
  const tomorrow = api.addDays(today, 1);
  const web = await webAt(browser, 'E2E Koordinator', at(today, '23:10'));
  try {
    const { page } = web;
    await page.getByTestId('new-task').first().click();
    const dlg = page.getByTestId('quick-task');
    await expect(dlg.getByTestId('task-day-1'), 'podrazumevano vreme posle ponoći: dan je "Sutra"').toHaveAttribute('aria-checked', 'true');
    await expect(dlg.getByTestId('task-time')).toHaveValue('00:30');
    await dlg.getByRole('button', { name: 'za 1 h' }).click();
    await expect(dlg.getByTestId('task-day-1')).toHaveAttribute('aria-checked', 'true');
    await expect(dlg.getByTestId('task-time')).toHaveValue('00:10');
    await dlg.getByTestId('task-text').fill('E2E Proveri zadnji ulaz posle ponoći');
    await dlg.getByTestId('task-send').click();
    await expect(page.getByTestId('toast')).toContainText('Zadatak je poslat');
  } finally { await web.close(); }
  const task = await db.withDb((d) => d.collection('securitytasks').findOne({ text: 'E2E Proveri zadnji ulaz posle ponoći' }, { sort: { _id: -1 } }));
  expect(T.instantToLocal(task.dueAt).ymd, 'zadatak je za sutra').toBe(tomorrow);
  expect(T.instantToLocal(task.dueAt).hhmm).toBe('00:10');
});

test('očitavanje bez interneta pre odjave, poslato posle odjave, računa se u smenu', async () => {
  const c = await S.fresh();
  ctx = c; g = await api.guardApi();
  const sh = await S.active(c, { firstMin: 40, stepMin: 30 });
  await c.api.post('/_test/round-due', { shiftId: sh._id, index: 0, offsetMin: -3 });
  const s = await db.shift(sh._id);
  const tag = c.tags.find((t) => String(t._id) === String(s.rounds[0].tagId));
  // na telefonu: tačka očitana pre 1 min bez interneta (čeka u redu), radnik se zatim odjavi kad veza proradi
  const queued = { offline: true, deviceAt: new Date(Date.now() - MIN).toISOString(), clientId: `e2e-late-${Date.now()}` };
  expect((await api.scanAs(g, c.workplace.uid, { confirmEarly: true })).result).toBe('clock_out');
  const res = await api.scanAs(g, tag.uid, queued);
  expect(res.result, 'tačka iz reda posle odjave').toBe('checkpoint');
  const after = await db.shift(sh._id);
  expect(after.rounds[0].scannedAt, 'tačka je upisana u smenu').toBeTruthy();
  expect(new Date(after.rounds[0].scannedAt).getTime()).toBe(new Date(queued.deviceAt).getTime());
});

test('ugovor ističe: upozorenje na 30 dana, pa i na 7 dana (svaki prag po jednom)', async () => {
  ctx = await api.setup();
  const settings = await db.withDb((d) => d.collection('securitysettings').findOne({ key: 'global' }));
  const worker = await db.withDb((d) => d.collection('securityworkers').findOne({ _id: oid(guard2._id) }));
  const untilYmd = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
  const until = new Date(untilYmd + 'T00:00:00.000Z'); // isti oblik kao kad datum dođe sa weba
  await db.withDb((d) => d.collection('securityworkers').updateOne({ _id: worker._id }, { $set: { 'contract.until': until, alertsSent: [] } }));
  await ctx.api.put('/settings', { expiry: { contractDays: [30, 7] } });
  const daily = (daysBefore) => ctx.api.post('/_test/run-daily', { at: iso(until.getTime() - daysBefore * 86400000) });
  const count = async () => db.withDb((d) => d.collection('securityalarms').countDocuments({ kind: 'contract', workerId: worker._id }));
  try {
    await daily(35);
    expect(await count(), '35 dana pre isteka: još ništa').toBe(0);
    await daily(25);
    expect(await count(), '25 dana pre isteka: upozorenje za prag od 30 dana').toBe(1);
    await daily(20);
    expect(await count(), 'isti prag se ne ponavlja').toBe(1);
    // admin menja samo telefon (forma šalje i isti datum isteka): upozorenje ne sme da stigne ponovo
    await ctx.api.put(`/workers/${worker._id}`, { phone: '060 000 1099', contract: { from: null, until: untilYmd } });
    await daily(19);
    expect(await count(), 'posle promene telefona isto upozorenje ne stiže ponovo').toBe(1);
    await daily(5);
    expect(await count(), '5 dana pre isteka: upozorenje za prag od 7 dana (ranije nikad nije išlo)').toBe(2);
  } finally {
    await ctx.api.put('/settings', { expiry: { contractDays: (settings && settings.expiry && settings.expiry.contractDays) || [30] } });
    await db.withDb(async (d) => {
      await d.collection('securityworkers').updateOne({ _id: worker._id }, { $set: { contract: worker.contract || {}, alertsSent: worker.alertsSent || [], phone: worker.phone || '' } });
      await d.collection('securityalarms').deleteMany({ kind: 'contract', workerId: worker._id });
      await d.collection('securitydossiers').deleteMany({ kind: 'contract', workerId: worker._id });
    });
  }
});

test('tolerancija tačke: 4:59 posle plana je na vreme, 5:30 je kasno (kao i alarm koji je upalio u 5:00)', async () => {
  const c = await S.fresh();
  ctx = c; g = await api.guardApi();
  const sh = await S.active(c, { firstMin: 40, stepMin: 30 });
  await c.api.post('/_test/round-due', { shiftId: sh._id, index: 0, offsetMin: -(4 + 59 / 60) });
  await c.api.post('/_test/round-due', { shiftId: sh._id, index: 1, offsetMin: -5.5 });
  const s = await db.shift(sh._id);
  const tagAt = (i) => c.tags.find((t) => String(t._id) === String(s.rounds[i].tagId));
  const r0 = await api.scanAs(g, tagAt(0).uid);
  expect(r0.late, '4:59 posle plana je u toleranciji').toBeFalsy();
  const r1 = await api.scanAs(g, tagAt(1).uid);
  expect(r1.late, '5:30 posle plana je kasno (alarm za tu tačku pali u 5:00)').toBe(true);
  expect(r1.lateMin, 'kašnjenje se zaokružuje naviše: 6 min').toBe(6);
});
