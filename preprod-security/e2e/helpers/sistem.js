// Pomoćnici za testove celog sistema: radnik (telefon), admin/koordinator (web) i mehanizam alarma rade
// u ISTOM trenutku. Trka zavisi od toga koji upit u bazu stigne prvi, pa se svaki slučaj ponavlja sa malim
// pomacima između dve radnje (u oba redosleda) i posle svakog pokušaja proverava da je stanje dosledno.
const { login, client } = require('./api');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pomaci u ms: B kreće toliko posle A (negativno = A posle B)
const OFFSETS = [0, 0, 1, 3, 6, 10, 15, 25, 40, 60, -1, -3, -6, -10, -15, -25, -40, -60];

// Cron na serveru pokreće mehanizam alarma u :00 svake minute (pravo vreme). Trka se ne pokreće blizu toga,
// da cron ne bi upao između (tada bi test kuka vratila "busy" ili bi alarm upalio cron, a ne test).
async function awayFromCron() {
  for (;;) {
    const s = new Date().getSeconds();
    if (s >= 4 && s <= 52) return;
    await sleep(400);
  }
}

// Dve radnje "u istom trenutku": b kreće offsetMs posle a. Vraća { a, b } kao Promise.allSettled rezultate.
async function together(a, b, offsetMs = 0) {
  const pa = (async () => { if (offsetMs < 0) await sleep(-offsetMs); return a(); })();
  const pb = (async () => { if (offsetMs > 0) await sleep(offsetMs); return b(); })();
  const [ra, rb] = await Promise.allSettled([pa, pb]);
  return { a: ra, b: rb };
}

const ok = (r) => r.status === 'fulfilled';
const val = (r) => (r.status === 'fulfilled' ? r.value : null);
const httpStatus = (r) => (r.status === 'rejected' ? (r.reason && r.reason.status) || 'mreža' : 200);
// Opis ishoda jedne radnje za poruku o grešci
const show = (r) => (r.status === 'fulfilled'
  ? `ok${r.value && r.value.result ? ` (${r.value.result})` : ''}`
  : `greška ${httpStatus(r)}: ${String((r.reason && r.reason.message) || r.reason).slice(0, 160)}`);

// Ponovi trku za svaki pomak. setup() pravi sveže stanje, act(st) vraća { a, b } funkcije,
// check(st, res, offset) vraća spisak problema (prazan = stanje je dosledno).
async function raceAll({ offsets = OFFSETS, setup, act, check, settleMs = 400, log = () => {} }) {
  const failures = [];
  let runs = 0;
  for (const off of offsets) {
    await awayFromCron();
    const st = await setup();
    const { a, b } = act(st);
    const res = await together(a, b, off);
    await sleep(settleMs);
    const problems = await check(st, res, off);
    runs++;
    log(`pomak ${off} ms: a=${show(res.a)} b=${show(res.b)}${problems.length ? ` -> ${problems.join('; ')}` : ''}`);
    if (problems.length) failures.push(`pomak ${off} ms (a=${show(res.a)}, b=${show(res.b)}): ${problems.join('; ')}`);
  }
  return { runs, failures };
}

async function clientFor(name) {
  return client(await login(name));
}

module.exports = { sleep, OFFSETS, awayFromCron, together, raceAll, ok, val, httpStatus, show, clientFor };
