// Android aplikacija radnika obezbeđenja na emulatoru robotik_sec (Maestro). Svaki test priprema stanje preko
// API-ja i baze (test radnik E2E Cuvar, Hotel Aurora), prolazi korake u aplikaciji i proverava šta je server upisao.
// NFC: emulator nema NFC, pa tag ide kroz simulaciju istim putem kao pravi (nfc.js, simulateTag).
const { test, expect } = require('@playwright/test');
const { runFlow, adb } = require('../helpers/maestro');
const S = require('../helpers/scenarios');
const { runEngine, MIN } = require('../helpers/api');
const db = require('../helpers/db');
const { webLogin } = require('../helpers/web');
const { GUARD, PASSWORD, API_PORT } = require('../helpers/env');

test.describe.configure({ mode: 'serial' });

// Red taga u listi simulatora: isti redosled kao server (radno mesto, pa checkpointi po nazivu)
function simIndex(ctx, tagId) {
  const list = [...ctx.tags].sort((a, b) => (a.category !== b.category ? (a.category === 'workplace' ? -1 : 1) : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const i = list.findIndex((t) => String(t._id) === String(tagId));
  if (i < 0) throw new Error(`tag ${tagId} nije u listi simulatora`);
  return String(i);
}
test.beforeAll(async () => {
  await S.fresh();
  runFlow('guard-login.yaml', { GUARD_NAME: GUARD, GUARD_PASSWORD: PASSWORD });
});

test('bez smene: kartica, raspored i profil', async () => {
  await S.fresh();
  runFlow('g01-no-shift.yaml');
});

test('prijava na smenu očitavanjem taga radnog mesta (i na tabli Uživo na webu)', async ({ page }) => {
  const ctx = await S.fresh();
  const sh = await S.plannedSoon(ctx, 25);
  runFlow('g02-clock-in.yaml');
  const after = await db.shift(sh._id);
  expect(after.status).toBe('active');
  expect(after.clockIn.source).toBe('simulated');
  expect(after.lateMin).toBe(0);
  expect(String(after.clockIn.tagId)).toBe(String(ctx.workplace._id));
  // web: admin vidi radnika na tabli obilazaka
  await webLogin(page);
  await page.goto('/security');
  await expect(page.getByTestId('patrol-board')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('live-shift').filter({ hasText: GUARD })).toBeVisible();
});

test('kašnjenje: alarm preko celog ekrana, prijava sa ekrana alarma', async () => {
  const ctx = await S.fresh();
  const sh = await S.plannedLate(ctx, 20);
  await runEngine(ctx);
  const before = await db.alarms(sh._id);
  expect(before.map((a) => a.kind)).toContain('late');
  runFlow('g03-late-alarm.yaml');
  const after = await db.shift(sh._id);
  expect(after.status).toBe('active');
  expect(after.lateMin).toBeGreaterThanOrEqual(19);
  const alarms = await db.alarms(sh._id);
  expect(alarms.find((a) => a.kind === 'late').state).toBe('resolved');
});

test('obilazak: očitana tačka plana i ponovni dodir istog taga', async () => {
  const ctx = await S.fresh();
  const sh = await S.active(ctx, { firstMin: 3, stepMin: 30 });
  const r0 = sh.rounds[0];
  runFlow('g04-checkpoint.yaml', { SIM_INDEX: simIndex(ctx, r0.tagId) });
  const after = await db.shift(sh._id);
  expect(after.rounds[0].scannedAt).toBeTruthy();
  expect(after.rounds[0].lateMin).toBe(0);
  const scans = (await db.lastScans(GUARD, 10)).filter((s) => String(s.tagId) === String(r0.tagId));
  expect(scans.filter((s) => s.result === 'checkpoint')).toHaveLength(1);
  expect(scans.every((s) => s.source === 'simulated')).toBe(true);
});

test('nepoznat tag (i na webu među nepoznatim tagovima) i ručno upisan broj taga', async ({ page }) => {
  const ctx = await S.fresh();
  const sh = await S.active(ctx, { firstMin: 10, stepMin: 30 });
  const r1 = sh.rounds[1];
  const uid = ctx.tags.find((t) => String(t._id) === String(r1.tagId)).uid;
  runFlow('g05-unknown-and-manual.yaml', { TAG_UID: uid });
  const scans = await db.lastScans(GUARD, 10);
  const unknown = scans.find((s) => s.result === 'unknown_tag');
  expect(unknown).toBeTruthy();
  expect(unknown.uid).toMatch(/^04(:[0-9A-F]{2}){6}$/);
  const unknownList = await ctx.api.get('/tags/unknown');
  expect(JSON.stringify(unknownList)).toContain(unknown.uid);
  const after = await db.shift(sh._id);
  expect(after.rounds[1].scannedAt).toBeTruthy();
  // web: tag se pojavljuje na strani Objekti, u delu "Nepoznati tagovi" (admin ga odatle registruje)
  await webLogin(page);
  await page.goto('/security/objekti');
  await expect(page.getByTestId('unknown-tags')).toContainText(unknown.uid, { timeout: 30000 });
});

// Isto što radnik i admin rade sa pravom karticom koju sistem ne zna (npr. kartica za prevoz umesto NTAG215)
test('nepoznata kartica: admin je registruje na webu, posle toga radi kao radno mesto', async ({ page }) => {
  const UID = '04:E2:E0:00:13:37:01';
  const ctx = await S.fresh();
  await db.withDb(async (d) => { await d.collection('nfctags').deleteMany({ uid: UID }); await d.collection('securityscans').deleteMany({ uid: UID }); });
  try {
    const sh = await S.plannedSoon(ctx, 20);
    runFlow('sim-uid-scan.yaml', { TAG_UID: UID, RESULT: 'Nepoznat tag' });
    await webLogin(page);
    await page.goto('/security/objekti');
    const row = page.getByTestId('unknown-row').filter({ hasText: UID });
    await expect(row).toBeVisible({ timeout: 30000 });
    await row.getByTestId('register-unknown').click();
    await page.getByTestId('cat-workplace').click();
    await page.getByTestId('wiz-next').click();
    await page.getByTestId('wiz-name').fill('E2E Kartica za prevoz');
    await page.getByTestId('wiz-next').click();
    await page.getByTestId('wiz-save').click();
    await expect(page.getByTestId('wiz-done')).toBeVisible();
    const tag = await db.withDb((d) => d.collection('nfctags').findOne({ uid: UID }));
    expect(tag).toMatchObject({ category: 'workplace', name: 'E2E Kartica za prevoz', status: 'active' });
    expect(String(tag.facilityId)).toBe(String(ctx.facility._id));
    runFlow('sim-uid-scan.yaml', { TAG_UID: UID, RESULT: 'Prijavljen na smenu' });
    const after = await db.shift(sh._id);
    expect(after.status).toBe('active');
    expect(after.clockIn.uid).toBe(UID);
  } finally {
    await db.withDb((d) => d.collection('nfctags').deleteMany({ uid: UID }));
  }
});

test('zadaci: stalni bez i sa komentarom, povremeni sa komentarom', async () => {
  const ctx = await S.fresh();
  const sh = await S.active(ctx);
  const task = await S.addTask(ctx, sh._id, 'E2E Doček dostave na rampi, upiši broj kamiona', 40);
  runFlow('g06-tasks.yaml');
  const after = await db.shift(sh._id);
  const done = Object.fromEntries((after.standingDone || []).map((d) => [d.text, d.comment]));
  expect(Object.keys(done)).toEqual(expect.arrayContaining(['Obilazak po planu', 'Provera PP centrale na početku smene']));
  expect(done['Provera PP centrale na početku smene']).toBe('Centrala bez greske');
  const t = await db.task(task._id);
  expect(t.status).toBe('done');
  expect(t.comment).toBe('Dostava primljena, kamion BG123');
});

test('upis u dnevnik: zapažanje, primena ovlašćenja i primopredaja', async () => {
  const ctx = await S.fresh();
  const sh = await S.active(ctx);
  runFlow('g07-notes-handover.yaml');
  const notes = await db.notes(sh._id);
  expect(notes.map((n) => n.kind)).toEqual(['observation', 'authority']);
  expect(notes[0].text).toBe('Otvoren prozor na drugom spratu, zatvoren');
  expect(notes[1]).toMatchObject({ power: 'Provera identiteta', subject: 'Nepoznato lice na ulazu', text: 'Provera licne karte, lice udaljeno sa objekta' });
  const after = await db.shift(sh._id);
  expect(after.handover).toMatchObject({ condition: 'damaged', note: 'Lampa ne radi' });
  expect(after.handover.items).toEqual(expect.arrayContaining(['Ključevi', 'Radio stanica']));
  // izveštaj o primeni ovlašćenja ide koordinatorima i administratorima kao web obaveštenje
  const notif = await db.recentNotifications('security_report');
  expect(notif.length).toBeGreaterThan(0);
  expect(notif[0].message).toContain('Provera identiteta');
});

test('alarm za checkpoint: odlaganje uz razlog, pa očitavanje', async () => {
  const ctx = await S.fresh();
  const sh = await S.active(ctx, { firstMin: 30, stepMin: 30 });
  await ctx.api.post('/_test/round-due', { shiftId: sh._id, index: 0, offsetMin: -8 });
  await runEngine(ctx);
  expect((await db.alarms(sh._id)).map((a) => a.kind)).toContain('checkpoint1');
  runFlow('g08-alarm-snooze.yaml', { SIM_INDEX: simIndex(ctx, sh.rounds[0].tagId) });
  const after = await db.shift(sh._id);
  expect(after.rounds[0].snoozes[0].reason).toBe('Intervencija u toku: stizem za 5 minuta');
  expect(after.rounds[0].scannedAt).toBeTruthy();
  expect(after.rounds[0].lateMin).toBeGreaterThanOrEqual(8);
  const cp = (await db.alarms(sh._id)).find((a) => a.kind === 'checkpoint1');
  expect(cp.state).toBe('resolved');
});

test('rana odjava: prvo "Ostajem", pa potvrda', async () => {
  const ctx = await S.fresh();
  const sh = await S.active(ctx, { endMin: 300 });
  runFlow('g09-early-clock-out.yaml');
  const after = await db.shift(sh._id);
  expect(after.status).toBe('done');
  expect(after.clockOut.early).toBe(true);
  expect(after.earlyLeaveMin).toBeGreaterThan(250);
  expect(await db.dossier(GUARD, 'early_leave')).toHaveLength(1);
});

test('odjava na kraju smene bez pitanja', async () => {
  const ctx = await S.fresh();
  const sh = await S.active(ctx, { endMin: 20 });
  runFlow('g10-clock-out.yaml');
  const after = await db.shift(sh._id);
  expect(after.status).toBe('done');
  expect(after.clockOut.early).toBe(false);
});

test('bez interneta: očitavanje se čuva sa tačnim vremenom i šalje kad se veza vrati', async () => {
  const ctx = await S.fresh();
  const sh = await S.active(ctx, { firstMin: 5, stepMin: 30 });
  const idx = simIndex(ctx, sh.rounds[0].tagId);
  runFlow('g11a-online.yaml');
  adb('reverse', '--remove', 'tcp:5300');
  let scannedAt;
  try {
    scannedAt = new Date();
    runFlow('g11b-offline-scan.yaml', { SIM_INDEX: idx });
    // nijedno očitavanje nije stiglo do servera dok veze nema
    expect((await db.shift(sh._id)).rounds[0].scannedAt).toBeFalsy();
  } finally {
    adb('reverse', 'tcp:5300', `tcp:${API_PORT}`);
  }
  runFlow('g11c-back-online.yaml');
  const scans = (await db.lastScans(GUARD, 5)).filter((s) => s.result === 'checkpoint');
  expect(scans[0].offline).toBe(true);
  expect(new Date(scans[0].at).getTime()).toBeLessThan(new Date(scans[0].receivedAt).getTime());
  expect(new Date(scans[0].at).getTime()).toBeGreaterThanOrEqual(scannedAt.getTime() - 5000);
  expect((await db.shift(sh._id)).rounds[0].scannedAt).toBeTruthy();
});

test('odjava iz aplikacije uz potvrdu', async () => {
  await S.fresh();
  runFlow('g12-logout.yaml');
});
