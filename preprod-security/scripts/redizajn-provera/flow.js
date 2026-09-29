// Provera toka rada po stranicama (pre-prod Security, web 3300): node flow.js <scenario[,scenario]> [--w=1440]
// Svaki korak se broji; greške u konzoli i neuspeli API pozivi se prijavljuju na kraju.
const path = require('path');
const fs = require('fs');
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require(process.env.PLAYWRIGHT_DIR || 'D:/MANGEMENT-APP-MAIN/preprod/e2e/node_modules/playwright'); } })();
const OUT = path.join(__dirname, 'shots');
const AUTH = path.join(__dirname, 'auth.json');
const WEB = 'http://localhost:3300';
const args = process.argv.slice(2);
const flag = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}`)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : v; };
const names = (args[0] || 'schedule').split(',');
const W = Number(flag('w', 1440));

let passed = 0; const failed = [];
async function step(name, fn) {
  try { await fn(); passed++; console.log(`  OK  ${name}`); }
  catch (e) { failed.push(`${name}: ${String(e.message || e).split('\n')[0].slice(0, 220)}`); console.log(`  PAD ${name}: ${String(e.message || e).split('\n')[0].slice(0, 220)}`); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

const S = {};

S.schedule = async (page) => {
  await page.goto(`${WEB}/security/raspored`);
  await page.waitForSelector('[data-testid="page-schedule"]');
  await step('raspored: mreža ili dani se vide', async () => { await page.waitForSelector('[data-testid="sched-grid"], [data-testid="sched-agenda"]', { timeout: 15000 }); });
  await step('raspored: izbor objekta Hotel Aurora', async () => {
    const pill = page.locator('[data-testid="sched-facility"]', { hasText: 'Hotel Aurora' });
    if (await pill.count()) await pill.first().click(); else await page.selectOption('[data-testid="sched-facility-select"]', { label: 'Hotel Aurora' });
    await page.waitForTimeout(900);
    expect(/objekat=/.test(page.url()), 'URL nema objekat');
  });
  await step('raspored: klik na prazno polje otvara izbor smene', async () => {
    if (!(await page.locator('[data-testid="sched-grid"]').count())) {
      await page.locator('[data-testid="agenda-add"], [data-testid="cov-gap"]').first().click();
      await page.waitForSelector('[data-testid="composer"]');
      expect(await page.locator('[data-testid="gap-worker"]').count() > 0, 'nema radnika u izboru (telefon)');
      await page.screenshot({ path: path.join(OUT, 'flow-sched-cell-phone.png') });
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-testid="composer"]', { state: 'detached', timeout: 3000 });
      await page.locator('[data-testid="agenda-add"], [data-testid="cov-gap"]').first().click();
      await page.waitForSelector('[data-testid="composer"]');
      return;
    }
    const cell = page.locator('[data-testid="sched-cell"].is-empty').first();
    await cell.click();
    await page.waitForSelector('[data-testid="composer"]');
    expect(await page.locator('[data-testid="add-day"]').isVisible(), 'nema dugmeta Dnevna');
    await page.screenshot({ path: path.join(OUT, 'flow-sched-cell.png') });
  });
  await step('raspored: Escape zatvara izbor', async () => {
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid="composer"]', { state: 'detached', timeout: 3000 });
  });
  await step('raspored: sledeća nedelja i nazad', async () => {
    const before = await page.textContent('[data-testid="week-label"]');
    await page.click('[data-testid="week-next"]');
    await page.waitForTimeout(500);
    const after = await page.textContent('[data-testid="week-label"]');
    expect(before !== after, 'nedelja se nije promenila');
    await page.click('[data-testid="week-today"]');
    await page.waitForTimeout(400);
    expect((await page.textContent('[data-testid="week-label"]')) === before, 'Ova nedelja ne vraća');
  });
  await step('raspored: nepokrivena smena nudi radnike', async () => {
    const gap = page.locator('[data-testid="cov-gap"]').first();
    if (!(await gap.count())) { console.log('      (nema praznih smena ove nedelje)'); return; }
    await gap.click();
    await page.waitForSelector('[data-testid="composer"]');
    expect(await page.locator('[data-testid="gap-worker"]').count() > 0, 'nema radnika u izboru');
    await page.screenshot({ path: path.join(OUT, 'flow-sched-gap.png') });
    await page.keyboard.press('Escape');
  });
  await step('raspored: Popuni ciklusom (dijalog sa pregledom)', async () => {
    await page.click('[data-testid="fill-cycle"]');
    await page.waitForSelector('[data-testid="cycle-modal"]');
    expect(await page.locator('.sx-cycle__row').count() >= 2, 'nema pregleda ciklusa');
    await page.screenshot({ path: path.join(OUT, 'flow-sched-cycle.png') });
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid="cycle-modal"]', { state: 'detached', timeout: 3000 });
  });
  await step('raspored: kalendar u ciklusu, Escape zatvara prvo kalendar', async () => {
    await page.click('[data-testid="fill-cycle"]');
    await page.waitForSelector('[data-testid="cycle-modal"]');
    await page.click('[data-testid="cycle-modal"] .sx-dt__btn');
    await page.waitForSelector('.sx-cal');
    await page.screenshot({ path: path.join(OUT, 'flow-sched-cal.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(await page.locator('[data-testid="cycle-modal"]').isVisible(), 'Escape je zatvorio i dijalog');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid="cycle-modal"]', { state: 'detached', timeout: 3000 });
  });
  await step('raspored: po radniku', async () => {
    await page.click('[data-testid="view-worker"]');
    await page.waitForSelector('[data-testid="sched-worker"]');
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, 'flow-sched-worker.png') });
    await page.click('[data-testid="view-facility"]');
  });
  await step('raspored: klik na smenu otvara detalje smene', async () => {
    await page.waitForSelector('[data-testid="shift-chip"]', { timeout: 6000 }).catch(() => {});
    const chip = page.locator('[data-testid="shift-chip"]').first();
    if (!(await chip.count())) { console.log('      (nema smena)'); return; }
    await chip.click();
    await page.waitForSelector('[data-testid="shift-drawer"]', { timeout: 8000 });
    await page.waitForSelector('[data-testid="shift-line"]', { timeout: 8000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, 'flow-sched-shift.png') });
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid="shift-drawer"]', { state: 'detached', timeout: 3000 });
    expect(!/smena=/.test(page.url()), 'URL i dalje ima smena=');
  });
};

const shot = (page, name, full) => page.screenshot({ path: path.join(OUT, `flow-${name}.png`), fullPage: !!full });

S.facilities = async (page) => {
  await page.goto(`${WEB}/security/objekti`);
  await page.waitForSelector('[data-testid="page-facilities"]');
  await step('objekti: lista se vidi', async () => { await page.waitForSelector('[data-testid="facility-card"]', { timeout: 15000 }); });
  await step('objekti: pretraga filtrira', async () => {
    const before = await page.locator('[data-testid="facility-card"]').count();
    await page.fill('[data-testid="fac-search"]', 'aurora');
    await page.waitForTimeout(300);
    const after = await page.locator('[data-testid="facility-card"]').count();
    expect(after >= 1 && after < before, `pretraga: ${before} -> ${after}`);
    await page.fill('[data-testid="fac-search"]', '');
  });
  await step('objekti: Novi objekat otvara formu, Escape zatvara', async () => {
    await page.click('[data-testid="add-facility"]');
    await page.waitForSelector('[data-testid="facility-modal"]');
    await shot(page, 'fac-new');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid="facility-modal"]', { state: 'detached', timeout: 3000 });
  });
  await step('objekti: čarobnjak za tag, koraci 1-3', async () => {
    await page.click('[data-testid="add-tag-global"]');
    await page.waitForSelector('[data-testid="tag-wizard"]');
    await page.click('[data-testid="cat-workplace"]');
    await page.click('[data-testid="wiz-next"]');
    await page.fill('[data-testid="wiz-name"]', 'Probni tag');
    await page.click('[data-testid="wiz-next"]');
    await page.waitForSelector('[data-testid="tag-uid"]');
    await page.fill('[data-testid="tag-uid"]', '04:AA:BB:CC:DD:EE:01');
    await page.waitForTimeout(700);
    await shot(page, 'fac-wizard');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid="tag-wizard"]', { state: 'detached', timeout: 3000 });
  });
  await step('objekti: klik na red otvara detalj', async () => {
    await page.locator('[data-testid="facility-card"]', { hasText: 'Hotel Aurora' }).first().click();
    await page.waitForSelector('[data-testid="page-facility"]');
    await page.waitForSelector('[data-testid="facility-ready"]');
    await page.waitForTimeout(900);
    await shot(page, 'fac-detail', true);
  });
  for (const t of ['tagovi', 'obilazak', 'zadaci', 'radnici', 'izvestaj']) {
    await step(`objekat: tab ${t}`, async () => {
      await page.click(`[data-testid="tab-${t}"]`);
      await page.waitForTimeout(700);
      expect(page.url().includes(`tab=${t}`), 'tab nije u URL-u');
      await shot(page, `fac-tab-${t}`, true);
    });
  }
  await step('objekat: fioka taga i istorija', async () => {
    await page.click('[data-testid="tab-tagovi"]');
    await page.waitForTimeout(400);
    await page.locator('[data-testid="tag-row"]').first().click();
    await page.waitForSelector('[data-testid="tag-drawer"]');
    await page.waitForSelector('[data-testid="tag-history"]');
    await page.waitForTimeout(700);
    await shot(page, 'fac-tagsheet');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid="tag-drawer"]', { state: 'detached', timeout: 3000 });
  });
  await step('objekat: napravi krug (dijalog sa pregledom)', async () => {
    await page.click('[data-testid="tab-obilazak"]');
    await page.waitForSelector('[data-testid="gen-day"]');
    await page.click('[data-testid="gen-day"]');
    await page.waitForSelector('[data-testid="round-gen"]');
    await page.waitForTimeout(600);
    await shot(page, 'fac-gen');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid="round-gen"]', { state: 'detached', timeout: 3000 });
  });
  await step('objekat: izmena plana pokazuje traku za čuvanje, Poništi je skida', async () => {
    await page.click('[data-testid="plan-add-day"]');
    await page.waitForSelector('[data-testid="plan-savebar"]');
    await shot(page, 'fac-savebar');
    await page.click('[data-testid="plan-savebar"] >> text=Poništi');
    await page.waitForSelector('[data-testid="plan-savebar"]', { state: 'detached', timeout: 3000 });
  });
  await step('objekat: tačka sa puta pripreme vodi u tab', async () => {
    await page.locator('[data-testid="facility-ready"] .sx-ready__node').nth(3).click();
    await page.waitForTimeout(400);
    expect(page.url().includes('tab=radnici'), 'nije otvoren tab radnici');
  });
  await step('objekat: dosije radnika iz taba Radnici', async () => {
    await page.locator('[data-testid="person-guard"] >> text=Dosije').first().click();
    await page.waitForSelector('[data-testid="worker-drawer"]', { timeout: 8000 });
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });
};

S.workers = async (page) => {
  await page.goto(`${WEB}/security/radnici`);
  await page.waitForSelector('[data-testid="page-workers"]');
  await step('radnici: tabela se vidi', async () => { await page.waitForSelector('[data-testid="worker-row"]', { timeout: 15000 }); await shot(page, 'workers', true); });
  await step('radnici: brojka "Na smeni" filtrira i vraća', async () => {
    const all = await page.locator('[data-testid="worker-row"]').count();
    await page.click('[data-testid="kpi-on"]');
    await page.waitForTimeout(300);
    const on = await page.locator('[data-testid="worker-row"]').count();
    expect(on <= all, 'filter nije smanjio listu');
    await page.click('[data-testid="kpi-on"]');
    await page.waitForTimeout(300);
    expect((await page.locator('[data-testid="worker-row"]').count()) === all, 'filter se nije skinuo');
  });
  await step('radnici: pretraga po imenu', async () => {
    await page.fill('[data-testid="worker-search"]', 'lazar');
    await page.waitForTimeout(300);
    expect((await page.locator('[data-testid="worker-row"]').count()) >= 1, 'nema rezultata');
    await page.fill('[data-testid="worker-search"]', '');
  });
  await step('radnici: dosije se otvara', async () => {
    await page.locator('[data-testid="worker-row"]').first().click();
    await page.waitForSelector('[data-testid="worker-drawer"]');
    await page.waitForSelector('[data-testid="worker-drawer-name"]');
    await page.waitForTimeout(700);
    await shot(page, 'worker-dossier');
  });
  for (const t of ['podaci', 'licence', 'smene', 'nalog']) {
    await step(`dosije: tab ${t}`, async () => { await page.click(`[data-testid="wd-tab-${t}"]`); await page.waitForTimeout(500); await shot(page, `worker-${t}`); });
  }
  await step('dosije: licenca u dijalogu, Escape zatvara samo dijalog', async () => {
    await page.click('[data-testid="wd-tab-licence"]');
    await page.click('[data-testid="license-add"]');
    await page.waitForSelector('[data-testid="license-modal"]');
    await shot(page, 'worker-license');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid="license-modal"]', { state: 'detached', timeout: 3000 });
    expect(await page.locator('[data-testid="worker-drawer"]').isVisible(), 'Escape je zatvorio i dosije');
  });
  await step('dosije: izmena podataka pokazuje traku za čuvanje', async () => {
    await page.click('[data-testid="wd-tab-podaci"]');
    await page.fill('[data-testid="wd-phone"]', '060 000 0000');
    await page.waitForSelector('[data-testid="wd-save"]');
    await page.click('text=Poništi');
    await page.waitForTimeout(300);
    expect(!(await page.locator('[data-testid="wd-save"]').count()), 'traka nije nestala');
  });
  await step('dosije: Escape zatvara fioku i čisti URL', async () => {
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid="worker-drawer"]', { state: 'detached', timeout: 3000 });
    expect(!/radnik=/.test(page.url()), 'URL i dalje ima radnik=');
  });
  await step('radnici: Novi radnik (dijalog), Escape', async () => {
    await page.click('[data-testid="add-worker"]');
    await page.waitForSelector('[data-testid="worker-modal"]');
    await page.fill('[data-testid="worker-name"]', 'Probni Radnik');
    await shot(page, 'worker-new');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid="worker-modal"]', { state: 'detached', timeout: 3000 });
  });
};

S.alarms = async (page) => {
  await page.goto(`${WEB}/security/alarmi`);
  await page.waitForSelector('[data-testid="page-alarms"]');
  await step('alarmi: dnevnik se vidi', async () => { await page.waitForSelector('[data-testid="alarm-list"], .sx-alclear', { timeout: 15000 }); await page.waitForTimeout(600); await shot(page, 'alarms'); });
  await step('alarmi: svi, i rešeni', async () => { await page.click('[data-testid="alarms-all"]'); await page.waitForTimeout(900); expect(await page.locator('[data-testid="alarm-row"]').count() > 0, 'nema alarma'); });
  await step('alarmi: Reši otvara dijalog sa predlozima, Escape', async () => {
    const btn = page.locator('[data-testid="alarm-resolve"]').first();
    if (!(await btn.count())) { console.log('      (nema alarma za rešavanje)'); return; }
    await btn.click();
    await page.waitForSelector('[data-testid="resolve-dialog"]');
    await shot(page, 'alarms-resolve');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid="resolve-dialog"]', { state: 'detached', timeout: 3000 });
  });
  await step('alarmi: pravila (lestvica) i traka za čuvanje', async () => {
    await page.click('[data-testid="tab-rules"]');
    await page.waitForSelector('[data-testid="rules"]');
    await page.waitForTimeout(600);
    await shot(page, 'alarms-rules', true);
    await page.fill('[data-testid="rule-late"]', '16');
    await page.waitForSelector('[data-testid="rules-savebar"]');
    await page.click('[data-testid="rules-savebar"] >> text=Poništi');
    await page.waitForSelector('[data-testid="rules-savebar"]', { state: 'detached', timeout: 3000 });
  });
};

S.reports = async (page) => {
  await page.goto(`${WEB}/security/izvestaji`);
  await page.waitForSelector('[data-testid="page-reports"]');
  await step('izveštaji: tabela se vidi', async () => { await page.waitForSelector('[data-testid="report-row"]', { timeout: 15000 }); await page.waitForTimeout(500); await shot(page, 'reports'); });
  await step('izveštaji: filter Juče i nazad 7 dana', async () => {
    await page.click('text=Juče');
    await page.waitForTimeout(900);
    await page.click('text=7 dana');
    await page.waitForTimeout(900);
  });
  await step('izveštaji: izveštaj (dnevnik, mejl, kontrola)', async () => {
    await page.locator('[data-testid="report-row"]').first().click();
    await page.waitForSelector('[data-testid="report-doc"]', { timeout: 10000 });
    await page.waitForTimeout(500);
    await shot(page, 'report-doc');
    await page.click('[data-testid="rep-view-mail"]');
    await page.waitForSelector('[data-testid="report-emails"]');
    await shot(page, 'report-mail');
    await page.click('[data-testid="rep-view-review"]');
    await page.waitForSelector('[data-testid="review-note"]');
    await shot(page, 'report-review');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid="report-modal"]', { state: 'detached', timeout: 3000 });
  });
};

S.pay = async (page) => {
  await page.goto(`${WEB}/security/satnica`);
  await page.waitForSelector('[data-testid="page-pay"]');
  await step('satnica: obračun se vidi', async () => { await page.waitForSelector('[data-testid="pay-table"], .sx-empty-block', { timeout: 15000 }); await page.waitForTimeout(500); await shot(page, 'pay', true); });
  await step('satnica: prethodni mesec i nazad', async () => {
    const m = await page.textContent('[data-testid="month-label"]');
    await page.click('[data-testid="month-prev"]');
    await page.waitForTimeout(700);
    expect((await page.textContent('[data-testid="month-label"]')) !== m, 'mesec se nije promenio');
    await page.click('text=Ovaj mesec');
    await page.waitForTimeout(700);
  });
  await step('satnica: izmena pravila pokazuje Sačuvaj', async () => {
    await page.fill('[data-testid="pay-night"]', '31');
    await page.waitForSelector('[data-testid="pay-rules-save"]');
    await page.click('[data-testid="pay-rules"] >> text=Poništi');
    await page.waitForTimeout(300);
    expect(!(await page.locator('[data-testid="pay-rules-save"]').count()), 'dugme nije nestalo');
  });
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: W < 700 ? 844 : 900 }, storageState: fs.existsSync(AUTH) ? AUTH : undefined });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  for (const n of names) {
    console.log(`[${n}] ${W}px`);
    if (!S[n]) { console.log('  nema scenarija'); continue; }
    await S[n](page);
  }
  console.log(`\nkoraka: ${passed} OK, ${failed.length} PAD`);
  if (failed.length) console.log(failed.map((f) => `  - ${f}`).join('\n'));
  console.log('greške u konzoli / API:', errors.length ? errors.slice(0, 12) : 'nema');
  await browser.close();
  process.exit(failed.length || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
