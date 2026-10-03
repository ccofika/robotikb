// Web za radnika (rezerva za Android aplikaciju, http://localhost:3300/security): radnik vidi istu smenu kao u
// aplikaciji i može da označi zadatak. Tag se na webu očitava samo u Chrome-u na Android telefonu (Web NFC).
const { test, expect } = require('@playwright/test');
const S = require('../helpers/scenarios');
const db = require('../helpers/db');
const { webLogin } = require('../helpers/web');
const { GUARD } = require('../helpers/env');

test.describe.configure({ mode: 'serial' });

test('radnik na webu: smena u toku, obilazak i stalni zadatak', async ({ page }) => {
  const ctx = await S.fresh();
  const sh = await S.active(ctx);
  await webLogin(page, GUARD);
  await page.goto('/security');
  await expect(page.getByTestId('guard-web')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('guard-shift')).toContainText(ctx.facility.name);
  await expect(page.getByTestId('guard-shift-state')).toContainText('U smeni si od');
  await expect(page.getByTestId('guard-round')).toHaveCount(sh.rounds.length);
  await page.getByTestId('guard-standing').filter({ hasText: 'Obilazak po planu' }).click();
  await expect.poll(async () => ((await db.shift(sh._id)).standingDone || []).map((d) => d.text)).toContain('Obilazak po planu');
});

test('radnik na webu: raspored', async ({ page }) => {
  const ctx = await S.fresh();
  await S.plannedSoon(ctx, 30);
  await webLogin(page, GUARD);
  await page.goto('/security');
  await page.getByTestId('gw-tab-schedule').click();
  await expect(page.getByTestId('guard-schedule-row').first()).toContainText(ctx.facility.name);
});
