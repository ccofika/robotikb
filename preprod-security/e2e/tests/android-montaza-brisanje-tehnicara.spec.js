// Tehničar (Montaža) obrisan dok je prijavljen na telefonu: aplikacija ga odjavljuje sa porukom
// "Nalog je obrisan", a ponovna prijava ne prolazi. Test nalog TEST Brisanje Android se briše na početku i kraju.
const { test, expect } = require('@playwright/test');
const path = require('path');
const { request, login } = require('../helpers/api');
const { withDb } = require('../helpers/db');
const { runFlow } = require('../helpers/maestro');
const { ADMIN, OUT_DIR } = require('../helpers/env');

const TECH = 'TEST Brisanje Android';
const PASS = 'TestAndroid123!';
const cleanup = () => withDb((db) => db.collection('technicians').deleteMany({ name: TECH }));

test.beforeAll(cleanup);
test.afterAll(cleanup);

test('obrisan tehničar se odjavljuje sa telefona sa razlogom', async () => {
  const admin = await login(ADMIN);
  const tech = await request('POST', '/api/technicians', { token: admin, body: { name: TECH, password: PASS } });
  runFlow('m-tech-login.yaml', { TECH_NAME: TECH, TECH_PASSWORD: PASS });

  await request('DELETE', `/api/technicians/${tech._id}`, { token: admin });
  runFlow('m-tech-deleted.yaml', { SHOT: 'montaza-obrisan-tehnicar' }, { shotsDir: path.join(OUT_DIR, 'shots') });
  await expect(login(TECH, PASS)).rejects.toMatchObject({ status: 401 });
});
