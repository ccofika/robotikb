// Interakcije na Uživo strani: dijalozi, pretraga, obaveštenja, šina, hover akcije, meni na telefonu.
// Ne menja podatke (samo otvara i zatvara), osim ako je zadat argument --ack (preuzme drugi alarm).
const path = require('path');
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require(process.env.PLAYWRIGHT_DIR || 'D:/MANGEMENT-APP-MAIN/preprod/e2e/node_modules/playwright'); } })();
const OUT = path.join(__dirname, 'shots');
const WEB = 'http://localhost:3300';
const ACK = process.argv.includes('--ack');

async function login(page) {
  await page.goto(`${WEB}/login`);
  await page.getByPlaceholder('Unesite korisničko ime').fill('E2E Admin');
  await page.getByPlaceholder('Unesite lozinku').fill('Preprod123!');
  await page.getByRole('button', { name: 'Prijavi se' }).click();
  await page.waitForURL((u) => !/login/.test(u.toString()), { timeout: 30000 });
}

(async () => {
  const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11'] });
  const results = [];
  const ok = (name, cond, extra = '') => { results.push(`${cond ? 'OK  ' : 'PAD '} ${name}${extra ? `  (${extra})` : ''}`); };
  const errors = [];

  // ---------- desktop 1440 ----------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await login(page);
  await page.goto(`${WEB}/security`);
  await page.waitForSelector('[data-testid="patrol-board"]');
  await page.waitForTimeout(1800);

  // Reši alarm: dijalog, brzi odgovor, Escape zatvara (samo ako ima alarma)
  const hasAlarm = (await page.locator('[data-testid="alarm-resolve"]').count()) > 0;
  if (!hasAlarm) results.push('--   Reši alarm: preskočeno, trenutno nema alarma (smena tek počela)');
  if (hasAlarm) {
  await page.locator('[data-testid="alarm-resolve"]').first().click();
  await page.waitForSelector('[data-testid="resolve-dialog"]');
  await page.waitForTimeout(500);
  await page.locator('.sx-suggest button').first().click();
  const val = await page.locator('[data-testid="confirm-input"]').inputValue();
  ok('Reši alarm: brzi odgovor upisuje tekst', val.length > 10, val);
  const okEnabled = await page.locator('[data-testid="confirm-ok"]').isEnabled();
  ok('Reši alarm: dugme aktivno posle teksta', okEnabled);
  await page.screenshot({ path: path.join(OUT, 'i-resolve.png') });
  const bodyLocked = await page.evaluate(() => document.body.style.overflow);
  ok('Dijalog zaključava skrol', bodyLocked === 'hidden', bodyLocked);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok('Escape zatvara dijalog', (await page.locator('[data-testid="resolve-dialog"]').count()) === 0);
  ok('Skrol otključan posle zatvaranja', (await page.evaluate(() => document.body.style.overflow)) !== 'hidden');
  }

  // Novi zadatak
  await page.locator('[data-testid="new-task"]').first().click();
  await page.waitForSelector('[data-testid="quick-task"]');
  await page.waitForTimeout(500);
  await page.locator('[data-testid="task-text"]').fill('Proveri da li su vrata magacina zaključana');
  await page.locator('[data-testid="task-time"]').fill('2330');
  await page.locator('[data-testid="task-text"]').click();
  const tval = await page.locator('[data-testid="task-time"]').inputValue();
  ok('Novi zadatak: vreme 2330 postaje 23:30', tval === '23:30', tval);
  await page.screenshot({ path: path.join(OUT, 'i-task.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok('Novi zadatak: Escape zatvara', (await page.locator('[data-testid="quick-task"]').count()) === 0);

  // Pretraga Ctrl+K
  await page.keyboard.press('Control+k');
  await page.waitForSelector('[data-testid="palette"]');
  await page.locator('[data-testid="palette-input"]').fill('orbit');
  await page.waitForTimeout(400);
  const items = await page.locator('.sx-cmd__item').allInnerTexts();
  ok('Pretraga nalazi objekat bez obzira na velika slova', items.some((t) => /TC Orbit/.test(t)), items.slice(0, 3).join(' | '));
  await page.screenshot({ path: path.join(OUT, 'i-palette.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  ok('Pretraga: Escape zatvara', (await page.locator('[data-testid="palette"]').count()) === 0);

  // Obaveštenja
  await page.locator('[data-testid="bell"]').click();
  await page.waitForSelector('[data-testid="notifications"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'i-bell.png') });
  await page.mouse.click(900, 300);
  await page.waitForTimeout(400);
  ok('Obaveštenja: klik van zatvara panel', (await page.locator('[data-testid="notifications"]').count()) === 0);

  // Hover na red table: akcije se pojave
  const row = page.locator('[data-testid="live-shift"]').nth(2);
  await row.scrollIntoViewIfNeeded();
  await row.hover({ position: { x: 400, y: 30 } });
  await page.waitForTimeout(500);
  const op = await row.locator('.sx-row__actions').evaluate((el) => getComputedStyle(el).opacity);
  ok('Hover na red table otkriva akcije', Number(op) > 0.9, `opacity ${op}`);
  await page.screenshot({ path: path.join(OUT, 'i-rowhover.png') });

  // Oblačić na tački obilaska
  const node = row.locator('.sx-node').first();
  await node.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const nb = await node.boundingBox();
  await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
  await page.waitForTimeout(800);
  const tip = await page.locator('.sx-tip.is-on').count();
  ok('Oblačić na tački obilaska', tip === 1, tip ? await page.locator('.sx-tip').innerText() : 'nema');

  // Klik na red otvara detalje smene (stari list, za sada)
  await row.click({ position: { x: 500, y: 20 } });
  await page.waitForTimeout(800);
  ok('Klik na red otvara smenu (?smena=)', /smena=/.test(page.url()), page.url().replace(WEB, ''));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // Skupljena šina
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.sx-rail__collapse').click();
  await page.waitForTimeout(700);
  const railW = await page.locator('.sx-rail').evaluate((el) => el.getBoundingClientRect().width);
  ok('Šina se skuplja na 76 px', Math.round(railW) === 76, `${Math.round(railW)} px`);
  await page.screenshot({ path: path.join(OUT, 'i-collapsed.png') });
  await page.locator('.sx-rail__markbtn').click();
  await page.waitForTimeout(700);
  ok('Klik na znak širi šinu', Math.round(await page.locator('.sx-rail').evaluate((el) => el.getBoundingClientRect().width)) === 248);

  if (ACK) {
    await page.locator('[data-testid="alarm-ack"]').nth(1).click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, 'i-ack.png') });
  }
  await ctx.close();

  // ---------- telefon 390 (dodir) ----------
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const m = await mctx.newPage();
  m.on('pageerror', (e) => errors.push('PAGEERROR(m) ' + e.message));
  await login(m);
  await m.goto(`${WEB}/security`);
  await m.waitForSelector('[data-testid="patrol-board"]');
  await m.waitForTimeout(1500);
  await m.screenshot({ path: path.join(OUT, 'i-mobile-top.png') });
  await m.locator('[data-testid="menu-button"]').tap();
  await m.waitForTimeout(900);
  ok('Telefon: meni se otvara', (await m.locator('[data-testid="mobile-menu"]').count()) === 1);
  await m.screenshot({ path: path.join(OUT, 'i-mobile-menu.png') });
  await m.locator('[data-testid="menu-close"]').tap();
  await m.waitForTimeout(700);
  ok('Telefon: meni se zatvara', (await m.locator('[data-testid="mobile-menu"]').count()) === 0);
  const btnH = await m.locator('.sx-main .sx-btn').first().evaluate((el) => el.getBoundingClientRect().height);
  ok('Telefon: dugmad >= 40 px', btnH >= 40, `${btnH} px`);
  await m.locator('[data-testid="patrol-board"]').scrollIntoViewIfNeeded();
  await m.waitForTimeout(500);
  await m.screenshot({ path: path.join(OUT, 'i-mobile-board.png') });
  await mctx.close();

  await browser.close();
  console.log(results.join('\n'));
  console.log('greške u konzoli:', errors.length ? errors : 'nema');
})().catch((e) => { console.error(e); process.exit(1); });
