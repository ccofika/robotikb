// Brisanje tehničara (Montaža): posle brisanja sve ostaje kako je bilo. Instalirana oprema ostaje kod korisnika
// sa imenom tehničara koji ju je postavio, zadužena oprema, materijal i osnovna oprema ostaju na njemu, nalozi
// i dalje pokazuju njegovo ime; tehničar nestaje iz spiskova i ne može da se prijavi.
// Test podaci počinju sa TEST / test-brisanje i brišu se na početku i kraju.
// Pokretanje (posle "security.sh start e2e"): E2E_SKIP_ANDROID=1 npx playwright test --project=montaza
const { test, expect } = require('@playwright/test');
const { request, login } = require('../helpers/api');
const { withDb } = require('../helpers/db');
const { webLogin } = require('../helpers/web');
const { ADMIN, BACKEND_DIR } = require('../helpers/env');

const { ObjectId } = require(require.resolve('mongodb', { paths: [BACKEND_DIR] }));

const TECH = 'TEST Brisanje Tehnicar';
const PASS = 'TestBrisanje123!';
const TIS = 'TEST-990001';
const SERIAL = (s) => `test-brisanje-${s}`;
const EQ_FIELDS = ['status', 'location', 'assignedTo', 'assignedToUser', 'assignedAt', 'assignedBy', 'assignedByName', 'installedAt', 'awaitingConfirmation', 'confirmationStatus'];

async function cleanup() {
  await withDb(async (db) => {
    const t = await db.collection('technicians').findOne({ name: TECH });
    await db.collection('equipment').deleteMany({ serialNumber: /^test-brisanje-/ });
    await db.collection('workorders').deleteMany({ tisId: TIS });
    await db.collection('workorderevidences').deleteMany({ tisId: TIS });
    await db.collection('users').deleteMany({ tisId: TIS });
    await db.collection('materials').deleteMany({ type: /^TEST brisanje/ });
    await db.collection('basicequipments').deleteMany({ type: /^TEST brisanje/ });
    if (t) {
      await db.collection('technicians').deleteMany({ name: TECH });
      await db.collection('logs').deleteMany({ performedBy: t._id });
      await db.collection('adminactivitylogs').deleteMany({ entityId: t._id });
    }
  });
}

const snapshot = (techId) => withDb(async (db) => ({
  tech: await db.collection('technicians').findOne({ _id: new ObjectId(techId) }),
  equipment: await db.collection('equipment').find({ serialNumber: /^test-brisanje-/ }).sort({ serialNumber: 1 }).toArray(),
}));
const pickEq = (e) => Object.fromEntries(EQ_FIELDS.map((f) => [f, e[f] == null ? null : String(e[f])]));

test.describe.configure({ mode: 'serial' });
test.beforeAll(cleanup);
test.afterAll(cleanup);

test('brisanje tehničara ne dira opremu, materijal ni istoriju', async ({ page }) => {
  const admin = await login(ADMIN);
  const A = (method, url, body) => request(method, url, { token: admin, body });

  // --- tehničar sa instaliranom, zaduženom i nepotvrđenom opremom, materijalom i osnovnom opremom ---
  const tech = await A('POST', '/api/technicians', { name: TECH, password: PASS });
  const tid = tech._id;
  for (const s of ['inst-1', 'inst-2', 'ruke-1', 'ceka-1']) {
    await A('POST', '/api/equipment', { category: 'TEST Modem', description: `TEST oprema ${s}`, serialNumber: SERIAL(s) });
  }
  await A('POST', `/api/technicians/${tid}/equipment`, { serialNumbers: ['inst-1', 'inst-2', 'ruke-1'].map(SERIAL) });
  const techToken = await login(TECH, PASS);
  const T = (method, url, body) => request(method, url, { token: techToken, body });
  const pending = await T('GET', `/api/technicians/${tid}/equipment/pending`);
  for (const e of pending) await T('POST', `/api/technicians/${tid}/equipment/confirm`, { equipmentId: e._id || e.id });
  await A('POST', `/api/technicians/${tid}/equipment`, { serialNumbers: [SERIAL('ceka-1')] });

  const wo = await A('POST', '/api/workorders', {
    date: new Date().toISOString().slice(0, 10), time: '10:00', municipality: 'TEST Opstina', address: 'TEST adresa 1',
    type: 'TEST instalacija', technology: 'HFC', technicianId: tid, tisId: TIS, userName: 'TEST Korisnik',
  });
  const woId = (wo.workOrder || wo)._id;
  const eqDocs = await withDb((db) => db.collection('equipment').find({ serialNumber: { $in: [SERIAL('inst-1'), SERIAL('inst-2')] } }).toArray());
  for (const e of eqDocs) await T('POST', '/api/user-equipment', { userId: TIS, equipmentId: String(e._id), workOrderId: woId, technicianId: tid });

  const mat = await A('POST', '/api/materials', { type: 'TEST brisanje kabl', quantity: 50 });
  await A('POST', `/api/technicians/${tid}/materials`, { materialId: mat._id, quantity: 7 });
  const be = await A('POST', '/api/basic-equipment', { type: 'TEST brisanje merdevine', quantity: 3 });
  await A('POST', `/api/technicians/${tid}/basic-equipment`, { basicEquipmentId: be._id, quantity: 1 });

  const before = await snapshot(tid);
  const st = Object.fromEntries(before.equipment.map((e) => [e.serialNumber, `${e.status}|${e.location}`]));
  expect(st).toEqual({
    [SERIAL('ceka-1')]: `pending_confirmation|tehnicar-${tid}`,
    [SERIAL('inst-1')]: `installed|user-${TIS}`,
    [SERIAL('inst-2')]: `installed|user-${TIS}`,
    [SERIAL('ruke-1')]: `assigned|tehnicar-${tid}`,
  });
  const countBefore = (await A('GET', '/api/technicians?statsOnly=true')).total;

  // --- brisanje kroz web, kao admin ---
  await webLogin(page);
  await page.goto('/technicians');
  await page.getByPlaceholder(/Pretra/i).first().fill(TECH);
  const techRow = () => page.locator('tr', { hasText: TECH }).filter({ has: page.getByTitle('Obriši tehničara') });
  const row = techRow();
  await expect(row).toHaveCount(1);
  page.once('dialog', (d) => d.accept());
  await row.getByTitle('Obriši tehničara').click();
  await expect(page.getByText('Tehničar je uspešno obrisan!')).toBeVisible();
  await page.reload();
  await page.getByPlaceholder(/Pretra/i).first().fill(TECH);
  await expect(page.getByText(`Nema rezultata za "${TECH}"`)).toBeVisible();
  await expect(techRow()).toHaveCount(0);

  // --- sve je ostalo isto ---
  const after = await snapshot(tid);
  expect(after.equipment.map(pickEq)).toEqual(before.equipment.map(pickEq));
  expect(after.tech).toBeTruthy();
  expect(after.tech.deletedAt).toBeTruthy();
  expect(after.tech.isActive).toBe(false);
  expect(JSON.stringify(after.tech.materials)).toBe(JSON.stringify(before.tech.materials));
  expect(JSON.stringify(after.tech.basicEquipment)).toBe(JSON.stringify(before.tech.basicEquipment));

  // nalog i dalje pokazuje ime tehničara (web)
  await page.goto(`/work-orders/${woId}`);
  await expect(page.getByText(TECH).first()).toBeVisible({ timeout: 30000 });

  // padajući meni za novi nalog ga nema
  await page.goto('/work-orders/add');
  await expect(page.locator('select').first()).toBeVisible({ timeout: 30000 });
  expect(await page.locator('option', { hasText: TECH }).count()).toBe(0);

  // --- spiskovi, prijava, zaduženje i ponovno pravljenje ---
  // lista za web ga i dalje vraća (imena na starim nalozima), sa oznakom brisanja
  const list = await A('GET', '/api/technicians');
  expect(list.find((t) => t.name === TECH)?.deletedAt).toBeTruthy();
  expect((await A('GET', '/api/technicians?statsOnly=true')).total).toBe(countBefore - 1);
  expect((await A('GET', '/api/equipment/locations')).map((l) => l.label)).toContain(`Tehničar: ${TECH} (obrisan)`);
  const superadmin = await login('E2E Superadmin');
  expect((await request('GET', '/api/finances/technicians', { token: superadmin })).map((t) => t.name)).not.toContain(TECH);
  await expect(A('POST', `/api/technicians/${tid}/materials`, { materialId: mat._id, quantity: 1 })).rejects.toMatchObject({ status: 404 });
  await expect(A('POST', '/api/workorders', { date: new Date().toISOString().slice(0, 10), municipality: 'TEST Opstina', address: 'TEST adresa 2', type: 'TEST', technology: 'HFC', technicianId: tid, tisId: TIS })).rejects.toMatchObject({ status: 400 });
  expect((await A('GET', `/api/technicians/${tid}`)).name).toBe(TECH);
  await expect(login(TECH, PASS)).rejects.toMatchObject({ status: 401 });
  await expect(T('GET', `/api/technicians/${tid}/equipment`)).rejects.toMatchObject({ status: 401 });
  await expect(request('POST', '/api/auth/refresh-token', { token: techToken })).rejects.toMatchObject({ status: 401 });
  await expect(A('DELETE', `/api/technicians/${tid}`)).rejects.toMatchObject({ status: 404 });
  await expect(A('POST', '/api/technicians', { name: TECH, password: PASS })).rejects.toMatchObject({ status: 400 });
});
