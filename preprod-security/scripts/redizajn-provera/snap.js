// Snimci Security stranica (pre-prod, web 3300): node snap.js <putanja[,putanja]> [širine] [--full] [--wait=ms] [--name=prefiks]
// Primer: node snap.js /security,/security/raspored 1440,390 --full
// Prijava se čuva u auth.json (localStorage), pa sledeći pozivi ne prolaze kroz formu.
const path = require('path');
const fs = require('fs');
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require(process.env.PLAYWRIGHT_DIR || 'D:/MANGEMENT-APP-MAIN/preprod/e2e/node_modules/playwright'); } })();
const OUT = path.join(__dirname, 'shots');
const WEB = 'http://localhost:3300';
const args = process.argv.slice(2);
const flag = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}`)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : v; };
const paths = (args[0] || '/security').split(',');
const widths = (args[1] && !args[1].startsWith('--') ? args[1] : '1440').split(',').map(Number);
const full = !!flag('full', false);
const wait = Number(flag('wait', 2200));
const prefix = flag('name', '');
const user = flag('user', 'E2E Admin');
const AUTH = path.join(__dirname, user === 'E2E Admin' ? 'auth.json' : `auth-${user.replace(/\s+/g, '_')}.json`);

async function login(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${WEB}/login`);
  await page.getByPlaceholder('Unesite korisničko ime').fill(user);
  await page.getByPlaceholder('Unesite lozinku').fill('Preprod123!');
  await page.getByRole('button', { name: 'Prijavi se' }).click();
  await page.waitForURL((u) => !/login/.test(u.toString()), { timeout: 30000 });
  await ctx.storageState({ path: AUTH });
  await ctx.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11'] });
  if (!fs.existsSync(AUTH) || flag('relogin', false)) await login(browser);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: AUTH });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  for (const p of paths) {
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: w < 700 ? 844 : 900 });
      await page.goto(`${WEB}${p}`);
      if (/login/.test(page.url())) { await login(browser); console.log('prijava obnovljena, ponovi'); process.exit(2); }
      await page.waitForSelector('[data-testid="security-root"], [data-testid="guard-web"]', { timeout: 30000 });
      await page.waitForTimeout(wait);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const name = `${prefix}${p.replace(/^\/security\/?/, '').replace(/[/?=&]+/g, '_') || 'live'}-${w}.png`;
      await page.screenshot({ path: path.join(OUT, name), fullPage: full });
      console.log(`${name}: prelivanje ${overflow}px`);
    }
  }
  console.log('greške:', errors.length ? errors : 'nema');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
