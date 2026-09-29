// Provera rasporeda i hovera za SVE Security stranice (po veštini, 08-provera-e2e):
// - 6 širina: vodoravno prelivanje, elementi van ekrana, tekst odsečen bez tri tačke (Range teksta)
// - hover (1440, miš): svako svojstvo koje se menja na hover mora imati izlaz >= 180 ms (boja teksta >= 100 ms)
// Upotreba: node audit-all.js [--only=raspored,objekti] [--widths=360,1440] [--nohover]
const path = require('path');
const fs = require('fs');
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require(process.env.PLAYWRIGHT_DIR || 'D:/MANGEMENT-APP-MAIN/preprod/e2e/node_modules/playwright'); } })();
const WEB = 'http://localhost:3300';
const args = process.argv.slice(2);
const flag = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}`)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : v; };
const WIDTHS = String(flag('widths', '360,390,768,1024,1440,1920')).split(',').map(Number);
const ONLY = flag('only', '') ? String(flag('only')).split(',') : null;
const AUTH = path.join(__dirname, 'auth.json');

const PAGES = [
  { key: 'live', path: '/security', wait: '[data-testid="patrol-board"]' },
  { key: 'raspored', path: '/security/raspored', wait: '[data-testid="sched-grid"], [data-testid="sched-agenda"]' },
  { key: 'objekti', path: '/security/objekti', wait: '[data-testid="facility-card"]' },
  { key: 'objekat', path: null, wait: '[data-testid="facility-ready"]' },
  { key: 'objekat-tagovi', path: null, tab: 'tagovi', wait: '[data-testid="tags-tab"]' },
  { key: 'objekat-obilazak', path: null, tab: 'obilazak', wait: '[data-testid="round-tab"]' },
  { key: 'objekat-zadaci', path: null, tab: 'zadaci', wait: '[data-testid="tasks-tab"]' },
  { key: 'objekat-radnici', path: null, tab: 'radnici', wait: '[data-testid="facility-guards"]' },
  { key: 'objekat-izvestaj', path: null, tab: 'izvestaj', wait: '[data-testid="report-emails-panel"]' },
  { key: 'radnici', path: '/security/radnici', wait: '[data-testid="worker-row"]' },
  { key: 'alarmi', path: '/security/alarmi', wait: '[data-testid="alarm-list"], .sx-alclear' },
  { key: 'pravila', path: '/security/alarmi?tab=pravila', wait: '[data-testid="rules"]' },
  { key: 'izvestaji', path: '/security/izvestaji', wait: '[data-testid="report-row"], .sx-empty-block' },
  { key: 'satnica', path: '/security/satnica', wait: '[data-testid="pay-table"], .sx-empty-block' }
];

const layoutProbe = () => {
  const out = { overflow: document.documentElement.scrollWidth - window.innerWidth, offenders: [], clipped: [] };
  const vw = window.innerWidth;
  const inScroller = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1) return true; if (/(hidden|clip)/.test(cs.overflowX) && p !== document.body) { const r = p.getBoundingClientRect(); if (r.right <= vw + 1 && r.left >= -1) return true; } } return false; };
  const root = document.querySelector('.sx-main') || document.querySelector('.sx-guard');
  root.querySelectorAll('*').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return;
    if ((r.right > vw + 1 || r.left < -1) && !inScroller(el) && !el.closest('.sx-fill') && !el.closest('.sx-split') && !el.closest('.sx-toolbar.is-sticky')) out.offenders.push(`${el.tagName}.${String(el.className).slice(0, 40)} ${Math.round(r.left)}..${Math.round(r.right)}`);
  });
  root.querySelectorAll('*').forEach((el) => {
    if (!el.childNodes.length || [...el.childNodes].every((n) => n.nodeType !== 3 || !n.textContent.trim())) return;
    const cs = getComputedStyle(el);
    if (cs.textOverflow === 'ellipsis' || el.closest('.sx-split') || el.closest('.sx-sr') || el.closest('[aria-hidden="true"]') || cs.webkitLineClamp !== 'none') return;
    const box = el.getBoundingClientRect();
    if (!box.width) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    const t = range.getBoundingClientRect();
    if (/(hidden|clip)/.test(cs.overflowX) && t.right > box.right + 1) out.clipped.push(`${el.tagName}.${String(el.className).slice(0, 30)} "${el.textContent.trim().slice(0, 30)}"`);
  });
  out.offenders = [...new Set(out.offenders)].slice(0, 10);
  out.clipped = [...new Set(out.clipped)].slice(0, 10);
  return out;
};

async function hoverAudit(page) {
  const sigs = await page.evaluate(() => {
    const sel = '.sx-main a[href], .sx-main button, .sx-main [role="button"], .sx-main tr.is-click, .sx-main .sx-item.is-click, .sx-main .sx-facrow, .sx-main .sx-wk__cell, .sx-main .sx-row, .sx-main .sx-node, .sx-main .sx-ev, .sx-main .sx-kpi, .sx-main input, .sx-main select, .sx-rail a, .sx-rail button';
    const seen = new Set();
    const pick = [];
    document.querySelectorAll(sel).forEach((el, i) => {
      const sig = `${el.tagName}.${[...el.classList].filter((c) => !/^is-/.test(c)).sort().join('.')}`;
      if (seen.has(sig)) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < 0) return;
      seen.add(sig);
      el.setAttribute('data-audit', String(i));
      pick.push({ id: String(i), sig });
    });
    return pick;
  });
  const PROPS = ['color', 'backgroundColor', 'borderColor', 'boxShadow', 'transform', 'opacity', 'backgroundImage'];
  const problems = [];
  let checked = 0;
  for (const s of sigs) {
    const loc = page.locator(`[data-audit="${s.id}"]`);
    try {
      await loc.scrollIntoViewIfNeeded({ timeout: 1500 });
      await page.mouse.move(2, 2);
      await page.waitForTimeout(480);
      const before = await loc.evaluate((el, P) => { const cs = getComputedStyle(el); const o = {}; P.forEach((p) => { o[p] = cs[p]; }); return o; }, PROPS);
      const box = await loc.boundingBox();
      if (!box || box.width < 2) continue;
      await page.mouse.move(box.x + Math.min(box.width / 2, 40), box.y + box.height / 2);
      await page.waitForTimeout(480);
      const after = await loc.evaluate((el, P) => { const cs = getComputedStyle(el); const o = {}; P.forEach((p) => { o[p] = cs[p]; }); return o; }, PROPS);
      await page.mouse.move(2, 2);
      const base = await loc.evaluate((el) => { const cs = getComputedStyle(el); return { prop: cs.transitionProperty, dur: cs.transitionDuration }; });
      checked++;
      const changed = PROPS.filter((p) => before[p] !== after[p]);
      if (!changed.length) continue;
      const durs = base.dur.split(',').map((d) => parseFloat(d) * (d.includes('ms') ? 1 : 1000));
      const props = base.prop.split(',').map((p) => p.trim());
      const durFor = (p) => { const css = p.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`); let i = props.indexOf(css); if (i === -1) i = props.indexOf('all'); if (i === -1 && css.startsWith('border')) i = props.indexOf('border-color'); return i === -1 ? 0 : durs[i % durs.length]; };
      changed.forEach((p) => { const d = durFor(p); const min = p === 'color' ? 100 : 180; if (d < min) problems.push(`NAGLO ${s.sig} ${p} izlaz ${Math.round(d)} ms`); });
    } catch (e) { /* element nestao */ }
  }
  return { checked, problems };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: AUTH });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  // ID objekta za detalj (Hotel Aurora)
  await page.goto(`${WEB}/security/objekti`);
  await page.waitForSelector('[data-testid="facility-card"]');
  await page.locator('[data-testid="facility-card"]', { hasText: 'Hotel Aurora' }).first().click();
  await page.waitForSelector('[data-testid="facility-ready"]');
  const facPath = new URL(page.url()).pathname;
  const report = [];
  let bad = 0;
  for (const pg of PAGES) {
    if (ONLY && !ONLY.includes(pg.key)) continue;
    const p = pg.path || `${facPath}${pg.tab ? `?tab=${pg.tab}` : ''}`;
    const lines = [];
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: w < 700 ? 844 : 900 });
      await page.goto(`${WEB}${p}`);
      try { await page.waitForSelector(pg.wait, { timeout: 15000 }); } catch (e) { lines.push(`PAD ${w}: stranica se nije učitala`); bad++; continue; }
      await page.waitForTimeout(1400);
      const r = await page.evaluate(layoutProbe);
      const isBad = r.overflow > 0 || r.offenders.length || r.clipped.length;
      if (isBad) { bad++; lines.push(`PAD ${w}px: prelivanje ${r.overflow}, van ekrana ${r.offenders.length}, odsečeno ${r.clipped.length}\n       ${[...r.offenders, ...r.clipped].join('\n       ')}`); }
    }
    let hov = '';
    if (!flag('nohover', false)) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${WEB}${p}`);
      await page.waitForSelector(pg.wait, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1400);
      const h = await hoverAudit(page);
      if (h.problems.length) { bad++; hov = ` | hover PAD ${h.problems.length}/${h.checked}\n       ${[...new Set(h.problems)].slice(0, 12).join('\n       ')}`; } else hov = ` | hover ${h.checked} OK`;
    }
    report.push(`${lines.length ? 'PAD' : 'OK '} ${pg.key}: ${WIDTHS.length} širina${lines.length ? `\n    ${lines.join('\n    ')}` : ''}${hov}`);
    console.log(report[report.length - 1]);
  }
  console.log(`\nukupno problema: ${bad}`);
  console.log('greške u konzoli / API:', errors.length ? [...new Set(errors)].slice(0, 10) : 'nema');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
