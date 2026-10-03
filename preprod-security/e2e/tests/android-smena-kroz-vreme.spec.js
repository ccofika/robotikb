// Cela smena kroz vreme na emulatoru (Maestro) i serveru. Virtuelni sat na serveru (preprod-security/scripts/test-clock.js)
// i na emulatoru (adb root + date) ide kroz smenu korak po korak; posle svakog skoka radi mehanizam alarma (kao cron),
// aplikacija se ponovo otvori, pa se proveravaju ekran, baza i mejlovi. Smene su uvek dnevna 07-19 i noćna 19-07,
// prave se preko istog API-ja kao kod koordinatora (radnik E2E Cuvar, Hotel Aurora, plan obilaska objekta).
//   A  dnevna smena (dan D), uredna: prerana prijava, checkpoint pre prijave, prijava, prerano očitavanje, zamenjen i
//      povučen tag, pomeren sat telefona, brz obilazak, tačka na vreme, u toleranciji, posle tolerancije (alarm),
//      odlaganje alarma, drugi alarm (admin), propuštena tačka, odjava, izveštaj mejlom, očitavanje posle odjave
//   B  noćna smena (D+1 19-07): kašnjenje, MASTER alarm (i mejl), prijava sa ekrana alarma, kraj smene bez odjave
//      (alarm i izveštaj "bez odjave"), kasna odjava
//   C  dnevna smena (D+3): radnik ne dolazi; kašnjenje, MASTER, propuštena smena
// D je 21 dan unapred (van seed rasporeda, pa mehanizam alarma ne vidi tuđe smene). Virtuelni sat važi samo za kod
// aplikacije; MongoDB drajver, cron i tokeni rade po pravom vremenu. Posle testa sat se vraća, a baza se ponovo puni (seed).
const { test, expect } = require('@playwright/test');
const path = require('path');
const { execFileSync } = require('child_process');
const { runFlow } = require('../helpers/maestro');
const { setup } = require('../helpers/api');
const db = require('../helpers/db');
const clock = require('../helpers/clock');
const mail = require('../helpers/mailpit');
const { GUARD, PASSWORD, BACKEND_DIR } = require('../helpers/env');

const T = require(path.join(BACKEND_DIR, 'services', 'security', 'time'));

// cela smena je 20 i više koraka na emulatoru
test.describe.configure({ mode: 'serial', timeout: 30 * 60 * 1000 });

const MIN = 60000;
const D = T.addDaysYmd(T.todayYmd(), 21);
const D1 = T.addDaysYmd(D, 1);
const D2 = T.addDaysYmd(D, 2);
const D3 = T.addDaysYmd(D, 3);
const at = (ymd, hhmm, plusMin = 0) => new Date(new Date(T.localToInstant(ymd, hhmm)).getTime() + plusMin * MIN);
const plus = (date, min) => new Date(new Date(date).getTime() + min * MIN);
// Maestro -e na Windows-u: slova sa kvačicom kao "." (regex), ostalo ostaje isto
const rx = (v) => String(v).replace(/[^\x20-\x7e]/g, '.');
const flow = (file, vars = {}) => runFlow(file, Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, rx(v)])));
const ANY = '.*';

let ctx; // admin pristup, tagovi, radnik; ponovo posle svakog skoka sata (token mora da važi u virtuelnom vremenu)
const S = {};
const fresh = async () => (ctx = await setup());
const engine = async () => { await fresh(); return ctx.api.post('/_test/run-engine', {}); };
const lastScan = async () => (await db.lastScans(GUARD, 1))[0];
const alarmsOf = async (shiftId, kind) => (await db.alarms(shiftId)).filter((a) => !kind || a.kind === kind);

// Red taga u listi simulatora: isti redosled kao server (radno mesto, pa checkpointi po nazivu)
function simIndex(tagId) {
  const list = [...ctx.tags].sort((a, b) => (a.category !== b.category ? (a.category === 'workplace' ? -1 : 1) : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const i = list.findIndex((t) => String(t._id) === String(tagId));
  if (i < 0) throw new Error(`tag ${tagId} nije u listi simulatora`);
  return String(i);
}

test.beforeAll(async () => {
  await clock.reset();
  await db.resetGuard();
  // aktivne smene iz seed-a se zatvaraju: mehanizam alarma bi za njih u virtuelnom vremenu pravio alarme i izveštaje
  await db.withDb((d) => d.collection('securityshifts').updateMany({ status: 'active' }, { $set: { status: 'done', 'report.sentAt': new Date(), 'report.attempts': 3 } }));
  await fresh();
  const mk = async (date, type) => (await ctx.api.post('/shifts', { facilityId: ctx.facility._id, workerId: ctx.guard._id, date, type, force: true }))._id;
  S.A = await mk(D, 'day');
  S.B = await mk(D1, 'night');
  S.C = await mk(D3, 'day');
  await ctx.api.post('/shifts/publish', { facilityId: ctx.facility._id, from: D, to: D3 });
});

test.afterAll(async () => {
  await clock.reset();
  execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'seed.js'), '--reset'], { stdio: 'inherit' });
});

test('A dnevna smena kroz vreme: od prerane prijave do izveštaja', async () => {
  // 80 min pre smene: prijava još nije otvorena (moguća je 60 min pre početka)
  await clock.travel(at(D, '05:40'));
  flow('guard-login.yaml', { GUARD_NAME: GUARD, GUARD_PASSWORD: PASSWORD });
  flow('t-status.yaml', { PILL: 'uskoro', TITLE: 'Smena počinje za 1 h .*', HINT: 'Prijava je moguća od 06:00', SHOT: 'a01-80-min-pre' });
  await fresh();
  const WP = simIndex(ctx.workplace._id);
  flow('t-scan.yaml', { SIM_INDEX: WP, RESULT: 'Nemaš smenu ovde', MSG: ANY, SHOT: 'a02-prerana-prijava' });
  expect((await lastScan()).result).toBe('no_shift');

  // 50 min pre smene: prijava otvorena; checkpoint pre prijave se ne računa
  await clock.travel(at(D, '06:10'));
  flow('t-status.yaml', { PILL: 'prijava otvorena', TITLE: 'Smena počinje za .* min.', HINT: 'Prisloni telefon na tag radnog mesta', SHOT: 'a03-prijava-otvorena' });
  await fresh();
  flow('t-scan.yaml', { SIM_INDEX: simIndex(ctx.checkpoints[0]._id), RESULT: 'Prvo se prijavi', MSG: ANY, SHOT: 'a04-checkpoint-pre-prijave' });
  expect((await lastScan()).result).toBe('no_clock_in');
  flow('t-scan.yaml', { SIM_INDEX: WP, RESULT: 'Prijavljen na smenu', MSG: 'Prijavljen na smenu u 06:1.', SHOT: 'a05-prijava' });
  let sh = await db.shift(S.A);
  expect(sh.status).toBe('active');
  expect(sh.lateMin).toBe(0);
  const R = sh.rounds;
  expect(R.length).toBeGreaterThanOrEqual(6);

  // tagovi čije su sve tačke plana daleko (više od 60 min): očitavanje je "van plana"
  const earliest = (tagId) => Math.min(...R.filter((r) => String(r.tagId) === String(tagId)).map((r) => new Date(r.dueAt).getTime()));
  const far = ctx.checkpoints.filter((t) => earliest(t._id) > at(D, '07:40').getTime());
  expect(far.length).toBeGreaterThanOrEqual(3);
  flow('t-scan.yaml', { SIM_INDEX: simIndex(far[0]._id), RESULT: 'Očitano van plana', MSG: ANY, SHOT: 'a06-prerano-ocitavanje' });
  expect((await lastScan()).result).toBe('extra');

  // zamenjen tag (stari čip) i povučen tag, pa vraćen u upotrebu
  const oldUid = far[0].uid;
  const newUid = '04:E2:E0:00:99:00:01';
  await fresh();
  await db.withDb((d) => d.collection('nfctags').deleteMany({ uid: newUid }));
  await ctx.api.post(`/tags/${far[0]._id}/replace`, { uid: newUid, reason: 'E2E zamena oštećenog taga' });
  flow('sim-uid-scan.yaml', { TAG_UID: oldUid, RESULT: 'Tag je zamenjen' });
  expect((await lastScan()).result).toBe('replaced_tag');
  await fresh();
  await ctx.api.post(`/tags/${far[0]._id}/retire`, { reason: 'E2E' });
  flow('sim-uid-scan.yaml', { TAG_UID: newUid, RESULT: 'Tag nije u upotrebi' });
  expect((await lastScan()).result).toBe('retired_tag');
  await fresh();
  await ctx.api.post(`/tags/${far[0]._id}/reactivate`, {});

  // sat telefona 10 min napred: važi vreme servera, a očitavanje dobija oznaku "sat"
  await clock.travel(at(D, '06:25'), { deviceSkewMin: 10 });
  await fresh();
  flow('t-scan.yaml', { SIM_INDEX: simIndex(far[1]._id), RESULT: 'Očitano van plana', MSG: ANY, SHOT: 'a07-sat-telefona' });
  expect((await lastScan()).flags).toContain('clock');

  // dva različita checkpointa za manje od 15 s: oznaka "brz obilazak" (tag možda skinut sa zida)
  await clock.travel(at(D, '06:30'));
  flow('t-scan-two.yaml', { SIM_A: simIndex(far[1]._id), SIM_B: simIndex(far[2]._id) });
  const fast = await lastScan();
  expect(String(fast.tagId)).toBe(String(far[2]._id));
  expect(fast.flags).toContain('fast');

  // tačka 1: 2 min posle plana (u toleranciji)
  await clock.travel(plus(R[0].dueAt, 2));
  flow('t-scan.yaml', { SIM_INDEX: simIndex(R[0].tagId), RESULT: 'Checkpoint očitan', MSG: '.* o.itan u .*', SHOT: 'a08-tacka-na-vreme' });
  sh = await db.shift(S.A);
  expect(sh.rounds[0].scannedAt).toBeTruthy();
  expect(sh.rounds[0].lateMin).toBeLessThanOrEqual(3);

  // tačka 2: 3 min posle plana, pred kraj tolerancije (5 min), bez alarma
  await clock.travel(plus(R[1].dueAt, 3));
  flow('t-scan.yaml', { SIM_INDEX: simIndex(R[1].tagId), RESULT: 'Checkpoint očitan', MSG: '.* o.itan u .*', SHOT: 'a09-u-toleranciji' });
  sh = await db.shift(S.A);
  expect(sh.rounds[1].lateMin).toBeLessThanOrEqual(5);
  expect(sh.rounds[1].alarm1At).toBeFalsy();

  // tačka 3: 7 min posle plana, prvi alarm radniku, očitavanje sa ekrana alarma (kasno, ide u dosije)
  await clock.travel(plus(R[2].dueAt, 7));
  await engine();
  expect((await alarmsOf(S.A, 'checkpoint1')).some((a) => a.roundIndex === 2)).toBe(true);
  flow('t-alarm-scan.yaml', { TITLE: 'Checkpoint nije očitan', SIM_INDEX: simIndex(R[2].tagId), RESULT: 'Checkpoint očitan', MSG: '.* posle plana .*', SHOT: 'a10-alarm-tacka' });
  sh = await db.shift(S.A);
  expect(sh.rounds[2].lateMin).toBeGreaterThanOrEqual(7);
  expect((await alarmsOf(S.A, 'checkpoint1')).find((a) => a.roundIndex === 2).state).toBe('resolved');
  expect((await db.dossier(GUARD, 'cp_late')).length).toBeGreaterThanOrEqual(1);

  // tačka 4: prvi alarm, radnik odloži alarm uz razlog (10 min); drugi alarm ne stiže dok traje odlaganje
  await clock.travel(plus(R[3].dueAt, 6));
  await engine();
  flow('t-alarm-snooze.yaml', { TITLE: 'Checkpoint nije očitan', REASON: 'Kontrola ulaza', SHOT: 'a11-odlaganje' });
  sh = await db.shift(S.A);
  expect(sh.rounds[3].snoozes[0].reason).toBe('Kontrola ulaza');
  await clock.travel(plus(R[3].dueAt, 12));
  await engine();
  expect((await db.shift(S.A)).rounds[3].alarm2At).toBeFalsy();
  flow('t-scan.yaml', { SIM_INDEX: simIndex(R[3].tagId), RESULT: 'Checkpoint očitan', MSG: '.* posle plana .*', SHOT: 'a12-posle-odlaganja' });
  sh = await db.shift(S.A);
  expect(sh.rounds[3].scannedAt).toBeTruthy();
  expect(sh.rounds[3].alarm2At).toBeFalsy();

  // tačka 5: prvi alarm, pa drugi alarm posle 10 min (ide administratoru), pa kasno očitavanje
  await clock.travel(plus(R[4].dueAt, 6));
  await engine();
  await clock.travel(plus(R[4].dueAt, 17));
  await engine();
  expect((await alarmsOf(S.A, 'checkpoint2')).some((a) => a.roundIndex === 4)).toBe(true);
  flow('t-alarm.yaml', { TITLE: 'Drugi alarm', ACTION: 'hide', SHOT: 'a13-drugi-alarm' });
  flow('t-text.yaml', { TEXT: 'nije očitano, javljeno administratoru', SHOT: 'a14-javljeno-adminu' });
  flow('t-scan.yaml', { SIM_INDEX: simIndex(R[4].tagId), RESULT: 'Checkpoint očitan', MSG: '.* posle plana .*', SHOT: 'a15-kasno-ocitano' });
  sh = await db.shift(S.A);
  expect(sh.rounds[4].alarm2At).toBeTruthy();
  expect(sh.rounds[4].scannedAt).toBeTruthy();
  expect((await alarmsOf(S.A, 'checkpoint2')).find((a) => a.roundIndex === 4).level).toBe('critical');

  // tačka 6: niko je ne očita (prvi i drugi alarm, ostaje propuštena)
  await clock.travel(plus(R[5].dueAt, 6));
  await engine();
  await clock.travel(plus(R[5].dueAt, 17));
  await engine();
  sh = await db.shift(S.A);
  expect(sh.rounds[5].alarm2At).toBeTruthy();
  expect(sh.rounds[5].scannedAt).toBeFalsy();

  // odjava u poslednjih 30 min smene: bez pitanja; izveštaj (Dnevnik rada) ide mejlom
  const last = R[R.length - 1];
  const out = new Date(Math.max(plus(sh.plannedEnd, -15).getTime(), plus(last.dueAt, 18).getTime()));
  await clock.travel(out);
  const sentFrom = Date.now();
  flow('t-scan.yaml', { SIM_INDEX: WP, RESULT: 'Odjavljen sa smene', MSG: 'Odjavljen sa smene u .*', SHOT: 'a16-odjava' });
  sh = await db.shift(S.A);
  expect(sh.status).toBe('done');
  expect(sh.clockOut.early).toBe(false);
  await mail.waitForSubject(['Dnevnik rada', ctx.facility.name, T.fmtDateSr(D)], { since: sentFrom - 5000 });

  // posle odjave: očitavanje se ne računa, kartica pokazuje završenu smenu
  await fresh();
  flow('t-scan.yaml', { SIM_INDEX: simIndex(far[2]._id), RESULT: 'Smena je završena', MSG: ANY, SHOT: 'a17-posle-odjave' });
  expect((await lastScan()).result).toBe('shift_done');
  flow('t-status.yaml', { PILL: 'završena', TITLE: 'Smena je završena u .*', HINT: ANY, SHOT: 'a18-zavrsena' });
});

test('B noćna smena kroz vreme: kašnjenje, MASTER alarm, bez odjave', async () => {
  // 16 min posle početka: alarm radniku "Kasniš na smenu"
  await clock.travel(at(D1, '19:16'));
  flow('guard-login.yaml', { GUARD_NAME: GUARD, GUARD_PASSWORD: PASSWORD });
  await engine();
  expect(await alarmsOf(S.B, 'late')).toHaveLength(1);
  flow('t-alarm.yaml', { TITLE: 'Kasniš na smenu', ACTION: 'hide', SHOT: 'b01-kasnis' });
  expect((await alarmsOf(S.B, 'late'))[0].level).toBe('warn');

  // 31 min: MASTER ALARM (kritičan) koordinatoru i adminu, i mejlom; radnik se prijavljuje sa ekrana alarma
  const masterFrom = Date.now();
  await clock.travel(at(D1, '19:31'));
  await engine();
  expect(await alarmsOf(S.B, 'master')).toHaveLength(1);
  await mail.waitForSubject(['MASTER ALARM', ctx.facility.name, GUARD], { since: masterFrom - 5000 });
  await fresh();
  flow('t-alarm-scan.yaml', { TITLE: 'MASTER ALARM', SIM_INDEX: simIndex(ctx.workplace._id), RESULT: 'Prijavljen na smenu', MSG: 'Prijavljen u 19:3., kašnjenje 3. min', SHOT: 'b02-master-prijava' });
  let sh = await db.shift(S.B);
  expect(sh.status).toBe('active');
  expect(sh.lateMin).toBeGreaterThanOrEqual(31);
  const alarms = await alarmsOf(S.B);
  expect(alarms.find((a) => a.kind === 'master').level).toBe('critical');
  expect(alarms.filter((a) => ['late', 'master'].includes(a.kind)).every((a) => a.state === 'resolved')).toBe(true);
  expect((await db.dossier(GUARD, 'late')).length).toBeGreaterThanOrEqual(1);

  // noć prolazi uredno (prečica: tačke obilaska upisane kao očitane), da bi se videlo šta je posle kraja smene
  await db.withDb(async (d) => {
    const doc = await d.collection('securityshifts').findOne({ _id: sh._id });
    const rounds = doc.rounds.map((r) => ({ ...r, scannedAt: new Date(new Date(r.dueAt).getTime() + MIN), lateMin: 1 }));
    await d.collection('securityshifts').updateOne({ _id: sh._id }, { $set: { rounds } });
  });

  // 5 min posle kraja smene: još je u smeni, kartica traži odjavu
  await clock.travel(at(D2, '07:05'));
  flow('t-status.yaml', { PILL: 'u smeni', TITLE: 'U smeni si od 19:3.*', HINT: 'Za odjavu prisloni telefon na tag radnog mesta', SHOT: 'b03-posle-kraja' });

  // 31 min posle kraja: alarm "Odjava nije očitana", izveštaj ide sa oznakom "bez odjave"; radnik se odjavljuje
  const reportFrom = Date.now();
  await clock.travel(at(D2, '07:31'));
  await engine();
  expect(await alarmsOf(S.B, 'no_clock_out')).toHaveLength(1);
  await mail.waitForSubject(['Dnevnik rada', 'bez odjave', T.fmtDateSr(D1)], { since: reportFrom - 5000 });
  await fresh();
  flow('t-alarm-scan.yaml', { TITLE: 'Odjava nije očitana', SIM_INDEX: simIndex(ctx.workplace._id), RESULT: 'Odjavljen sa smene', MSG: 'Odjavljen sa smene u 07:3.', SHOT: 'b04-kasna-odjava' });
  sh = await db.shift(S.B);
  expect(sh.status).toBe('done');
  expect(sh.clockOut.early).toBe(false);
  expect(sh.report.noClockOut).toBe(true);
  expect((await alarmsOf(S.B, 'no_clock_out'))[0].state).toBe('resolved');
});

test('C dnevna smena kroz vreme: radnik ne dolazi, smena je propuštena', async () => {
  await clock.travel(at(D3, '07:16'));
  flow('guard-login.yaml', { GUARD_NAME: GUARD, GUARD_PASSWORD: PASSWORD });
  await engine();
  expect(await alarmsOf(S.C, 'late')).toHaveLength(1);
  await clock.travel(at(D3, '07:31'));
  await engine();
  expect(await alarmsOf(S.C, 'master')).toHaveLength(1);
  await clock.travel(at(D3, '19:01'));
  await engine();
  flow('t-status.yaml', { PILL: 'propuštena', TITLE: 'Smena je propuštena. Javi koordinatoru.', HINT: ANY, SHOT: 'c01-propustena' });
  const sh = await db.shift(S.C);
  expect(sh.status).toBe('missed');
  const missed = await db.dossier(GUARD, 'missed');
  expect(missed.length).toBe(1);
  expect(missed[0].level).toBe('critical');
});
