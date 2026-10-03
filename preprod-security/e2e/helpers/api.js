// Tanak klijent za Security pre-prod backend: priprema stanja (smena, tagovi, zadaci) i provera posle koraka
// u aplikaciji. Test kuke (/api/security/_test) rade samo uz SECURITY_TEST_HOOKS=1 (env/backend.env).
const { API_URL, PASSWORD, ADMIN, GUARD, FACILITY } = require('./env');

// Posle dužeg Maestro koraka Node fetch ponekad uzme keep-alive vezu koju je server zatvorio (ECONNRESET)
const stale = (err) => {
  const code = (err && err.cause && err.cause.code) || (err && err.code);
  return err && err.message === 'fetch failed' && ['ECONNRESET', 'UND_ERR_SOCKET', 'EPIPE'].includes(code);
};

async function request(method, url, { token, body } = {}) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(`${API_URL}${url}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch (e) { data = text; }
      if (!res.ok) {
        const err = new Error(`[api] ${method} ${url} -> ${res.status}: ${text.slice(0, 300)}`);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    } catch (err) {
      if (i >= 3 || !stale(err)) throw err;
    }
  }
}

async function login(name, password = PASSWORD) {
  return (await request('POST', '/api/auth/login', { body: { name, password } })).token;
}

const client = (token) => ({
  get: (u) => request('GET', `/api/security${u}`, { token }),
  post: (u, body) => request('POST', `/api/security${u}`, { token, body: body || {} }),
  put: (u, body) => request('PUT', `/api/security${u}`, { token, body: body || {} }),
  del: (u) => request('DELETE', `/api/security${u}`, { token }),
});

// Vreme po Srbiji (Europe/Belgrade), smene su uvek 07-19 i 19-07
function belgrade(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, h: Number(p.hour), m: Number(p.minute) };
}
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
// Smena koja traje sada
function currentWindow(now = new Date()) {
  const b = belgrade(now);
  if (b.h >= 7 && b.h < 19) return { date: b.ymd, type: 'day' };
  if (b.h >= 19) return { date: b.ymd, type: 'night' };
  return { date: addDays(b.ymd, -1), type: 'night' };
}
const hhmm = (date) => { const b = belgrade(date); return `${String(b.h).padStart(2, '0')}:${String(b.m).padStart(2, '0')}`; };
const MIN = 60000;

async function setup() {
  const token = await login(ADMIN);
  const api = client(token);
  const facilities = await api.get('/facilities');
  const facility = facilities.find((f) => f.name === FACILITY);
  if (!facility) throw new Error(`[api] objekat "${FACILITY}" ne postoji (pokreni security.ps1 seed)`);
  const workers = await api.get('/workers?role=guard');
  const guard = workers.find((w) => w.name === GUARD);
  if (!guard) throw new Error(`[api] radnik "${GUARD}" ne postoji (pokreni security.ps1 seed)`);
  const tags = await api.get(`/tags?facility=${facility._id}&status=active`);
  const workplace = tags.find((t) => t.category === 'workplace');
  const checkpoints = tags.filter((t) => t.category === 'checkpoint');
  return { token, api, facility, guard, tags, workplace, checkpoints };
}

// Objavljena smena za test radnika u smeni koja traje sada. startMin / endMin (minuti od sada) pomeraju
// početak i kraj preko test kuke: startMin -20 = počela pre 20 min; bez njih važi raspored (07-19, 19-07).
async function createShiftNow(ctx, { startMin = null, endMin = null } = {}) {
  const { api, facility, guard } = ctx;
  const win = currentWindow();
  const shift = await api.post('/shifts', { facilityId: facility._id, workerId: guard._id, date: win.date, type: win.type, force: true });
  await api.post('/shifts/publish', { facilityId: facility._id, from: addDays(win.date, -1), to: addDays(win.date, 1) });
  if (startMin !== null || endMin !== null) await moveShift(ctx, shift._id, { startMin, endMin });
  return api.get(`/shifts/${shift._id}`);
}

async function moveShift(ctx, shiftId, { startMin = null, endMin = null }) {
  const sh = await ctx.api.get(`/shifts/${shiftId}`);
  const now = Date.now();
  const start = startMin !== null ? now + startMin * MIN : new Date(sh.plannedStart).getTime();
  const end = endMin !== null ? now + endMin * MIN : new Date(sh.plannedEnd).getTime();
  await ctx.api.post('/_test/shift-times', { shiftId, startOffsetMin: (start - now) / MIN, durationMin: Math.round((end - start) / MIN) });
  return ctx.api.get(`/shifts/${shiftId}`);
}

// Tačke obilaska u budućnost (plan dolazi iz rasporeda objekta, pa su neke posle prijave već u prošlosti)
async function spreadRounds(ctx, shiftId, firstMin = 25, stepMin = 30) {
  const sh = await ctx.api.get(`/shifts/${shiftId}`);
  for (let i = 0; i < (sh.rounds || []).length; i++) await ctx.api.post('/_test/round-due', { shiftId, index: i, offsetMin: firstMin + i * stepMin });
  return ctx.api.get(`/shifts/${shiftId}`);
}

async function guardApi(name = GUARD) {
  return client(await login(name));
}

// Očitavanje kao iz aplikacije (za pripremu stanja; testovi koji proveravaju očitavanje idu kroz aplikaciju)
async function scanAs(g, uid, extra = {}) {
  return g.post('/me/scans', { uid, source: 'simulated', deviceAt: new Date().toISOString(), clientId: `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...extra });
}

const runEngine = (ctx) => ctx.api.post('/_test/run-engine', {});

module.exports = { request, login, client, setup, createShiftNow, moveShift, spreadRounds, guardApi, scanAs, runEngine, currentWindow, belgrade, addDays, hhmm, MIN };
