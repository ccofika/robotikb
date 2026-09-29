// Snimci svih Security stranica za pregled (1440 x 900, prikaz ekrana, ne cela strana) + nekoliko na telefonu
const path = require('path');
const fs = require('fs');
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require(process.env.PLAYWRIGHT_DIR || 'D:/MANGEMENT-APP-MAIN/preprod/e2e/node_modules/playwright'); } })();
const OUT = path.join(__dirname, 'snimci');
const WEB = 'http://localhost:3300';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: path.join(__dirname, 'auth.json') });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  const shot = async (name) => { await page.mouse.move(2, 2); await page.waitForTimeout(900); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log('snimak', name); };
  const go = async (p, sel) => { await page.goto(`${WEB}${p}`); await page.waitForSelector(sel, { timeout: 20000 }); await page.waitForTimeout(1600); };

  await go('/security/objekti', '[data-testid="facility-card"]');
  await page.locator('[data-testid="facility-card"]', { hasText: 'Hotel Aurora' }).first().click();
  await page.waitForSelector('[data-testid="facility-ready"]');
  const fac = new URL(page.url()).pathname.split('/').pop();

  await go('/security', '[data-testid="patrol-board"]'); await shot('01-uzivo');
  await go(`/security/raspored?objekat=${fac}`, '[data-testid="sched-grid"]'); await shot('02-raspored');
  await page.locator('[data-testid="shift-chip"]').first().click();
  await page.waitForSelector('[data-testid="shift-line"]'); await page.waitForTimeout(700); await shot('03-smena');
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await go('/security/objekti', '[data-testid="facility-card"]'); await shot('04-objekti');
  await go(`/security/objekti/${fac}`, '[data-testid="facility-ready"]'); await shot('05-objekat');
  await go(`/security/objekti/${fac}?tab=obilazak`, '[data-testid="round-tab"]'); await shot('06-obilazak');
  await go(`/security/objekti/${fac}?tab=tagovi`, '[data-testid="tags-tab"]'); await shot('07-tagovi');
  await go('/security/radnici', '[data-testid="worker-row"]'); await shot('08-radnici');
  await page.locator('[data-testid="worker-row"]', { hasText: 'Marko Petrović' }).first().click();
  await page.waitForSelector('[data-testid="worker-drawer-name"]'); await page.waitForTimeout(600); await shot('09-dosije');
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await go('/security/alarmi', '[data-testid="alarm-list"], .sx-alclear'); await shot('10-alarmi');
  await go('/security/alarmi?tab=pravila', '[data-testid="rules"]'); await shot('11-pravila');
  await go('/security/izvestaji', '[data-testid="report-row"]'); await shot('12-izvestaji');
  await page.locator('[data-testid="report-row"]').nth(2).click();
  await page.waitForSelector('[data-testid="report-doc"]'); await page.waitForTimeout(600); await shot('13-dnevnik-rada');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  await go('/security/satnica', '[data-testid="pay-table"]'); await shot('14-satnica');

  // telefon
  await page.setViewportSize({ width: 390, height: 844 });
  await go('/security', '[data-testid="patrol-board"]'); await shot('15-telefon-uzivo');
  await go(`/security/raspored?objekat=${fac}`, '[data-testid="sched-agenda"]'); await shot('16-telefon-raspored');
  await go(`/security/objekti/${fac}`, '[data-testid="facility-ready"]'); await shot('17-telefon-objekat');
  await ctx.close();

  // web za radnika (radnik na smeni; ime iz GUARD, podrazumevano Marko Petrović)
  const g = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const gp = await g.newPage();
  await gp.goto(`${WEB}/login`);
  await gp.getByPlaceholder('Unesite korisničko ime').fill(process.env.GUARD || 'Marko Petrović');
  await gp.getByPlaceholder('Unesite lozinku').fill('Preprod123!');
  await gp.getByRole('button', { name: 'Prijavi se' }).click();
  await gp.waitForURL((u) => !/login/.test(u.toString()), { timeout: 30000 });
  await gp.goto(`${WEB}/security`);
  await gp.waitForSelector('[data-testid="guard-web"]', { timeout: 20000 });
  await gp.waitForTimeout(1800);
  await gp.screenshot({ path: path.join(OUT, '18-radnik-web.png') });
  console.log('snimak 18-radnik-web');
  console.log('greške:', errors.length ? errors : 'nema');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
