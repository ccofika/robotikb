// Ceo sistem kroz prave ekrane: admin i koordinator na webu (Playwright), radnik na telefonu (Maestro na
// emulatoru), u istom toku. Promena na jednoj strani mora da stigne na drugu bez osvežavanja stranice
// (web: Uživo na 10 s, alarmi na 15 s, radnik na webu na 20 s) i bez ponovnog pokretanja aplikacije (20 s),
// kao kad su oba ekrana otvorena u isto vreme. Na kraju: dva korisnika na webu nad istim podacima.
const { test, expect } = require('@playwright/test');
const { runFlow } = require('../helpers/maestro');
const S = require('../helpers/scenarios');
const api = require('../helpers/api');
const db = require('../helpers/db');
const mail = require('../helpers/mailpit');
const { webLogin } = require('../helpers/web');
const { GUARD, PASSWORD, ADMIN, WEB_URL, BACKEND_DIR } = require('../helpers/env');

const { ObjectId } = require(require.resolve('mongodb', { paths: [BACKEND_DIR] }));
const oid = (x) => new ObjectId(String(x));

// Testovi su nezavisni (svaki pravi svoje stanje), pa greška u jednom ne zaustavlja ostale
test.describe.configure({ mode: 'default', timeout: 12 * 60 * 1000 });

const COORD = 'E2E Koordinator';
const DAY_SHORT = ['ned', 'pon', 'uto', 'sre', 'čet', 'pet', 'sub'];
const MIN = api.MIN;
// Maestro na Windows-u ne prenosi slova sa kvačicama kroz -e: zamenjuju se sa "." (regex bilo koji znak)
const rx = (v) => String(v).replace(/[^\x20-\x7e]/g, '.');
const flow = (file, vars = {}) => runFlow(file, Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, rx(v)])));
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let base;
let guard2;
let planSnapshot;
const contexts = [];

// Red taga u listi simulatora: isti redosled kao server (radno mesto, pa checkpointi po nazivu)
function simIndex(ctx, tagId) {
  const list = [...ctx.tags].sort((a, b) => (a.category !== b.category ? (a.category === 'workplace' ? -1 : 1) : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const i = list.findIndex((t) => String(t._id) === String(tagId));
  if (i < 0) throw new Error(`tag ${tagId} nije u listi simulatora`);
  return String(i);
}
const tagOf = (round) => base.tags.find((t) => String(t._id) === String(round.tagId));

function weekStartYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return api.addDays(ymd, dow === 0 ? -6 : 1 - dow);
}

// Svaki korisnik u svom pregledaču (posebni kolačići i token), zona Srbije, bez animacija
async function webAs(browser, name, path = '/security') {
  const context = await browser.newContext({ baseURL: WEB_URL, timezoneId: 'Europe/Belgrade', reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  contexts.push(context);
  const page = await context.newPage();
  await webLogin(page, name);
  await page.goto(path);
  return page;
}
const toast = (page) => page.getByTestId('toast');

async function restoreFacility() {
  await db.withDb(async (d) => {
    await d.collection('securityfacilities').updateOne({ _id: oid(base.facility._id) }, { $set: { roundPlan: planSnapshot } });
    for (const t of base.tags) await d.collection('nfctags').updateOne({ _id: oid(t._id) }, { $set: { status: 'active', uid: t.uid }, $pull: { previousUids: { uid: t.uid } } });
  });
}

test.beforeAll(async () => {
  base = await S.fresh();
  guard2 = (await base.api.get('/workers?role=guard')).find((w) => w.name === 'E2E Cuvar Dva');
  planSnapshot = (await db.withDb((d) => d.collection('securityfacilities').findOne({ _id: oid(base.facility._id) }))).roundPlan;
  runFlow('guard-login.yaml', { GUARD_NAME: GUARD, GUARD_PASSWORD: PASSWORD });
});

test.afterEach(async () => {
  while (contexts.length) await contexts.pop().close().catch(() => {});
});

test.afterAll(async () => {
  await restoreFacility();
  await db.resetGuard('E2E Cuvar Dva');
  await db.withDb((d) => d.collection('securityworkers').updateOne({ _id: oid(guard2._id) }, { $pull: { facilityIds: oid(base.facility._id) } }));
});

test('raspored: admin dodaje i objavljuje smenu na webu, radnik je vidi u aplikaciji', async ({ browser }) => {
  const ctx = await S.fresh();
  const date = api.addDays(api.belgrade().ymd, 2);
  const page = await webAs(browser, ADMIN, `/security/raspored?objekat=${ctx.facility._id}&nedelja=${weekStartYmd(date)}`);
  await page.locator(`[data-testid="sched-cell"][data-date="${date}"][data-worker="${ctx.guard._id}"]`).click();
  await page.getByTestId('add-night').click();
  await expect(toast(page)).toContainText('Noćna smena dodata');
  await page.getByTestId('publish').click();
  await page.getByTestId('confirm-ok').click();
  await expect(toast(page)).toContainText('Raspored je objavljen');
  const [, mm, dd] = date.split('-');
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  flow('s-schedule.yaml', { ROW: `.*${esc(`${DAY_SHORT[dow]} ${dd}.${mm}. · Noćna 19-07`)}.*`, SHOT: 'sistem-raspored' });
});

test('prijava na telefonu se pojavi na otvorenoj tabli Uživo, bez osvežavanja stranice', async ({ browser }) => {
  const ctx = await S.fresh();
  await S.plannedLate(ctx, 5);
  const page = await webAs(browser, COORD);
  const row = page.getByTestId('live-shift').filter({ hasText: GUARD });
  await expect(row).toContainText('nije prijavljen', { timeout: 25000 });
  flow('t-scan.yaml', { SIM_INDEX: simIndex(ctx, ctx.workplace._id), RESULT: 'Prijavljen na smenu', MSG: '.*', SHOT: 'sistem-prijava' });
  await expect(row).toContainText(/od \d\d:\d\d, kasnio 5 min/, { timeout: 25000 });
});

test('zadatak: koordinator ga šalje sa weba, radnik ga zatvara na telefonu, komentar stiže na web', async ({ browser }) => {
  const ctx = await S.fresh();
  const sh = await S.active(ctx, { firstMin: 40, stepMin: 30 });
  const page = await webAs(browser, COORD);
  await page.getByTestId('new-task').first().click();
  const dlg = page.getByTestId('quick-task');
  await dlg.getByTestId('task-time').fill(api.hhmm(new Date(Date.now() + 30 * MIN)));
  await dlg.getByTestId('task-text').fill('E2E Proveri zadnji ulaz i rampu');
  await dlg.getByTestId('task-send').click();
  await expect(toast(page)).toContainText('Zadatak je poslat');
  flow('s-task-done.yaml', { TEXT: 'E2E Proveri zadnji ulaz i rampu', COMMENT: 'Ulaz zakljucan rampa spustena', SHOT: 'sistem-zadatak' });
  await page.goto(`/security?smena=${sh._id}`);
  await expect(page.getByTestId('shift-drawer')).toContainText('Ulaz zakljucan rampa spustena', { timeout: 20000 });
});

test('alarm: koordinator ga preuzima pa rešava na webu, radniku se ekran alarma menja pa zatvara', async ({ browser }) => {
  const ctx = await S.fresh();
  const sh = await S.active(ctx, { firstMin: 40, stepMin: 30 });
  await ctx.api.post('/_test/round-due', { shiftId: sh._id, index: 0, offsetMin: -6 });
  await api.runEngine(ctx);
  flow('t-alarm.yaml', { TITLE: 'Checkpoint nije očitan', ACTION: 'stay', SHOT: 'sistem-alarm' });
  const page = await webAs(browser, COORD);
  const card = page.getByTestId('live-alarm').filter({ hasText: /E2E Cuvar(?! Dva)/ });
  await card.getByTestId('alarm-ack').click();
  await expect(toast(page)).toContainText('Alarm preuzet');
  // telefon, bez ponovnog pokretanja: isti ekran alarma dobija poruku da je koordinator preuzeo alarm
  flow('s-see.yaml', { TEXT: '.*Koordinator je preuzeo alarm.*', SHOT: 'sistem-alarm-preuzet' });
  await card.getByTestId('alarm-resolve').click();
  const dlg = page.getByTestId('resolve-dialog');
  await dlg.getByTestId('confirm-input').fill('Radnik javio telefonom, ide ka tački');
  await dlg.getByTestId('confirm-ok').click();
  await expect(toast(page)).toContainText('Alarm rešen');
  flow('s-gone.yaml', { ID: 'alarm-overlay', SHOT: 'sistem-alarm-zatvoren' });
});

test('MASTER alarm: web ga prikazuje, a nestaje čim se radnik prijavi sa ekrana alarma', async ({ browser }) => {
  const ctx = await S.fresh();
  await S.plannedLate(ctx, 31);
  const since = Date.now();
  await api.runEngine(ctx);
  await mail.waitForSubject(['MASTER ALARM', ctx.facility.name, GUARD], { since });
  const page = await webAs(browser, ADMIN, '/security/alarmi');
  const master = page.locator('[data-testid="alarm-row"][data-kind="master"]').filter({ hasText: GUARD });
  await expect(master).toBeVisible({ timeout: 25000 });
  flow('t-alarm-scan.yaml', { TITLE: '.*', SIM_INDEX: simIndex(ctx, ctx.workplace._id), RESULT: 'Prijavljen na smenu', MSG: '.*', SHOT: 'sistem-master' });
  await expect(master).toHaveCount(0, { timeout: 30000 });
});

test('povučen tag: admin ga povlači na webu, radnik očita fizički tag koji je i dalje na zidu', async ({ browser }) => {
  await restoreFacility();
  const ctx = await S.fresh();
  const sh = await S.active(ctx, { firstMin: 40, stepMin: 30 });
  const tag = tagOf(sh.rounds[0]);
  const page = await webAs(browser, ADMIN, `/security/objekti/${ctx.facility._id}?tab=tagovi`);
  await page.locator(`[data-testid="tag-row"][data-uid="${tag.uid}"]`).click();
  await page.getByTestId('tag-drawer').getByTestId('drawer-retire').click();
  await page.getByTestId('confirm-input').fill('E2E skinut sa zida');
  await page.getByTestId('confirm-ok').click();
  await expect(toast(page)).toBeVisible();
  flow('sim-uid-scan.yaml', { TAG_UID: tag.uid, RESULT: 'Tag nije u upotrebi' });
  const last = (await db.lastScans(GUARD, 1))[0];
  expect(last.result).toBe('retired_tag');
  await restoreFacility();
});

test('zamena taga: admin menja oštećen tag novim na webu, stari čip javlja zamenu, novi se računa', async ({ browser }) => {
  await restoreFacility();
  const ctx = await S.fresh();
  const sh = await S.active(ctx, { firstMin: 40, stepMin: 30 });
  await ctx.api.post('/_test/round-due', { shiftId: sh._id, index: 0, offsetMin: -1 });
  const tag = tagOf(sh.rounds[0]);
  const fresh = `04:E2:${Array.from({ length: 5 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase()).join(':')}`;
  const page = await webAs(browser, ADMIN, `/security/objekti/${ctx.facility._id}?tab=tagovi`);
  await page.locator(`[data-testid="tag-row"][data-uid="${tag.uid}"]`).getByTestId('tag-replace').click();
  await page.getByTestId('tag-uid').fill(fresh);
  await expect(page.getByTestId('uid-free')).toBeVisible({ timeout: 10000 });
  await page.getByTestId('wiz-save').click();
  await expect(page.getByTestId('wiz-done')).toBeVisible({ timeout: 15000 });
  try {
    flow('sim-uid-scan.yaml', { TAG_UID: tag.uid, RESULT: 'Tag je zamenjen' });
    flow('sim-uid-scan.yaml', { TAG_UID: fresh, RESULT: 'Checkpoint očitan' });
    expect((await db.shift(sh._id)).rounds[0].scannedAt, 'novi čip nije upisao tačku').toBeTruthy();
  } finally {
    await db.withDb((d) => d.collection('nfctags').updateOne({ _id: oid(tag._id) }, { $set: { uid: tag.uid }, $pull: { previousUids: { uid: tag.uid } } }));
  }
});

test('zamena radnika: admin daje smenu drugom radniku na webu, prvi radnik je više nema u aplikaciji', async ({ browser }) => {
  const ctx = await S.fresh();
  await db.resetGuard('E2E Cuvar Dva');
  const sh = await S.plannedSoon(ctx, 25);
  flow('t-status.yaml', { PILL: 'prijava otvorena', TITLE: '.*', HINT: '.*', SHOT: 'sistem-zamena-pre' });
  const page = await webAs(browser, ADMIN, `/security?smena=${sh._id}`);
  const drawer = page.getByTestId('shift-drawer');
  await drawer.getByTestId('swap-select').selectOption(String(guard2._id));
  await drawer.getByTestId('swap-go').click();
  const force = drawer.getByTestId('swap-force');
  await force.waitFor({ state: 'visible', timeout: 8000 }).then(() => force.click()).catch(() => {});
  await expect(toast(page)).toBeVisible();
  expect(String((await db.shift(sh._id)).workerId)).toBe(String(guard2._id));
  flow('t-text.yaml', { TEXT: 'Nemaš smenu sada', SHOT: 'sistem-zamena-posle' });
  // radnik bez smene nema spisak tagova u simulatoru: fizički tag radnog mesta je i dalje na zidu (upis broja taga)
  flow('sim-uid-scan.yaml', { TAG_UID: ctx.workplace.uid, RESULT: 'Nemaš smenu ovde' });
});

test('ručna odjava: koordinator odjavljuje radnika na webu, telefon prikazuje završenu smenu', async ({ browser }) => {
  const ctx = await S.fresh();
  const sh = await S.active(ctx, { firstMin: 40, stepMin: 30 });
  flow('start.yaml');
  const since = Date.now();
  const page = await webAs(browser, COORD, `/security?smena=${sh._id}`);
  await page.getByTestId('shift-drawer').getByTestId('manual-out').click();
  await page.getByTestId('punch-note').fill('Radnik javio da odlazi zbog bolesti');
  await page.getByTestId('punch-save').click();
  await expect(toast(page)).toContainText('Odjava je upisana');
  // telefon, bez ponovnog pokretanja
  flow('s-see.yaml', { TEXT: 'završena', SHOT: 'sistem-rucna-odjava' });
  flow('t-scan.yaml', { SIM_INDEX: simIndex(ctx, sh.rounds[0].tagId), RESULT: 'Smena je završena', MSG: '.*', SHOT: 'sistem-posle-odjave' });
  await mail.waitForSubject(['Dnevnik rada', ctx.facility.name], { since });
});

test('radnik na webu i na telefonu u isto vreme: stalni zadatak se vidi na obe strane', async ({ browser }) => {
  const ctx = await S.fresh();
  await S.active(ctx, { firstMin: 40, stepMin: 30 });
  const standing = (ctx.facility.standingTasks || []);
  const plain = standing.find((t) => !t.requireComment);
  expect(plain, 'objekat treba da ima stalni zadatak bez obaveznog komentara').toBeTruthy();
  flow('start.yaml');
  const page = await webAs(browser, GUARD);
  const task = page.getByTestId('guard-standing').filter({ hasText: plain.text });
  await task.click();
  await expect(task).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
  // telefon, bez ponovnog pokretanja: brojač zadataka u panelu
  flow('s-standing-done.yaml', { TEXT: plain.text, SHOT: 'sistem-stalni-telefon' });
  // radnik skida oznaku na telefonu, web radnika to vidi sam (osvežava se na 20 s)
  flow('s-tap.yaml', { TEXT: plain.text, SHOT: 'sistem-stalni-skinut' });
  await expect(task).toHaveAttribute('aria-pressed', 'false', { timeout: 40000 });
});

test('admin isključi nalog radnika usred smene: aplikacija ga odjavljuje', async ({ browser }) => {
  const ctx = await S.fresh();
  await S.active(ctx, { firstMin: 40, stepMin: 30 });
  flow('start.yaml');
  const page = await webAs(browser, ADMIN, `/security/radnici?radnik=${ctx.guard._id}`);
  const drawer = page.getByTestId('worker-drawer');
  await drawer.getByTestId('wd-tab-nalog').click();
  await drawer.getByTestId('wd-active').click();
  await page.getByTestId('confirm-ok').click();
  await expect(toast(page)).toBeVisible();
  try {
    flow('s-logged-out.yaml', { REASON: '.*Nalog je deaktiviran.*', SHOT: 'sistem-iskljucen' });
  } finally {
    await ctx.api.put(`/workers/${ctx.guard._id}/active`, { isActive: true });
    runFlow('guard-login.yaml', { GUARD_NAME: GUARD, GUARD_PASSWORD: PASSWORD });
  }
});

test('admin menja toleranciju za tačku na webu: mehanizam alarma je primenjuje odmah', async ({ browser }) => {
  const ctx = await S.fresh();
  const before = (await ctx.api.get('/facilities')).find((f) => String(f._id) === String(ctx.facility._id)).rules || {};
  const page = await webAs(browser, ADMIN, `/security/objekti/${ctx.facility._id}?tab=pregled`);
  await page.getByTestId('fac-rule-tol').fill('2');
  await page.getByTestId('fac-rules-save').click();
  await expect(toast(page)).toBeVisible();
  try {
    const sh = await S.active(ctx, { firstMin: 40, stepMin: 30 });
    await ctx.api.post('/_test/round-due', { shiftId: sh._id, index: 0, offsetMin: -3 });
    await api.runEngine(ctx);
    const al = await db.alarms(sh._id);
    expect(al.filter((a) => a.kind === 'checkpoint1' && a.roundIndex === 0).length, 'sa tolerancijom 2 min alarm mora da krene 3 min posle plana').toBe(1);
  } finally {
    await ctx.api.put(`/facilities/${ctx.facility._id}`, { rules: { checkpointTolMin: before.checkpointTolMin ?? null, snoozeMin: before.snoozeMin ?? null } });
  }
});

// ---------------------------------------------------------------- dva korisnika na webu nad istim podacima

test('dva admina: "Dodeli i dodaj" u rasporedu ne skida radnika koga je drugi admin upravo dodao', async ({ browser }) => {
  const ctx = await S.fresh();
  await db.resetGuard('E2E Cuvar Dva');
  const date = api.addDays(api.belgrade().ymd, 20); // van rasporeda iz seed-a (±14 dana), bez preklapanja
  const page = await webAs(browser, ADMIN, `/security/raspored?objekat=${ctx.facility._id}&nedelja=${weekStartYmd(date)}`);
  await expect(page.locator('[data-testid="sched-cell"]').first()).toBeVisible();
  const fid = oid(ctx.facility._id);
  const all = await ctx.api.get('/workers?role=guard');
  const onFacility = (w) => (w.facilityIds || []).some((f) => String(f._id || f) === String(ctx.facility._id));
  const team = all.filter(onFacility);
  // radnik koji je na otvorenoj strani prvog admina, a drugi admin ga upravo premešta sa objekta
  const moved = team.find((w) => w.name !== GUARD);
  expect(moved, 'objekat treba da ima još jednog radnika osim test radnika').toBeTruthy();
  await ctx.api.put(`/facilities/${ctx.facility._id}/people`, { role: 'guard', workerIds: [...team.filter((w) => w._id !== moved._id).map((w) => w._id), guard2._id] });
  let created = null;
  try {
    // prvi admin (stari spisak) dodaje smenu premeštenom radniku: server javlja da nije na objektu -> "Dodeli i dodaj"
    await page.locator(`[data-testid="sched-cell"][data-date="${date}"][data-worker="${moved._id}"]`).click();
    await page.getByTestId('add-day').click();
    await page.getByTestId('assign-add').click();
    const force = page.getByTestId('force-add');
    await force.waitFor({ state: 'visible', timeout: 4000 }).then(() => force.click()).catch(() => {});
    await expect(toast(page)).toContainText('smena dodata');
    created = (await db.withDb((d) => d.collection('securityshifts').find({ workerId: oid(moved._id), facilityId: fid, date }).toArray()))[0];
    const dva = await db.withDb((d) => d.collection('securityworkers').findOne({ _id: oid(guard2._id) }));
    expect(dva.facilityIds.map(String), 'radnik koga je drugi admin upravo dodao objektu je skinut sa objekta').toContain(String(ctx.facility._id));
  } finally {
    await db.withDb(async (d) => {
      await d.collection('securityworkers').updateOne({ _id: oid(guard2._id) }, { $pull: { facilityIds: fid } });
      await d.collection('securityworkers').updateMany({ _id: { $in: team.map((w) => oid(w._id)) } }, { $addToSet: { facilityIds: fid } });
      if (created) await d.collection('securityshifts').deleteOne({ _id: created._id });
    });
  }
});

test('dva admina: čuvanje podataka objekta ne briše mejl adrese koje je drugi admin upravo dodao', async ({ browser }) => {
  const ctx = await S.fresh();
  const fac = (await ctx.api.get('/facilities')).find((f) => String(f._id) === String(ctx.facility._id));
  const emails = fac.reportEmails || [];
  const page = await webAs(browser, ADMIN, `/security/objekti/${ctx.facility._id}?tab=pregled`);
  await expect(page.getByTestId('facility-form')).toBeVisible();
  // drugi admin dodaje adresu dok je prvom forma otvorena
  await ctx.api.put(`/facilities/${ctx.facility._id}/report-emails`, { emails: [...emails, 'e2e.novi@preprod.local'] });
  try {
    const name = page.getByTestId('facility-form').locator('input').first();
    await name.fill(`${fac.name} `);
    await name.fill(fac.name);
    await page.getByTestId('facility-form').locator('textarea').first().fill(`E2E uputstvo ${Date.now()}`);
    await page.getByTestId('fac-save').click();
    await expect(toast(page)).toBeVisible();
    const after = (await ctx.api.get('/facilities')).find((f) => String(f._id) === String(ctx.facility._id)).reportEmails || [];
    expect(after, 'adresa koju je drugi admin dodao je obrisana čuvanjem forme').toContain('e2e.novi@preprod.local');
  } finally {
    await ctx.api.put(`/facilities/${ctx.facility._id}/report-emails`, { emails });
    await ctx.api.put(`/facilities/${ctx.facility._id}`, { instructions: fac.instructions || '' }).catch(() => {});
  }
});
