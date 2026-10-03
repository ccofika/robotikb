// Gotova stanja za testove i ručni pregled (test radnik E2E Cuvar, Hotel Aurora). Svako kreće od čistog stanja.
const { setup, createShiftNow, moveShift, spreadRounds, guardApi, scanAs, hhmm, MIN } = require('./api');
const { resetGuard, clearAlarms } = require('./db');

async function fresh() {
  const ctx = await setup();
  ctx.cleaned = await resetGuard();
  return ctx;
}

// Smena počinje za inMin minuta (prijava je otvorena do 60 min pre početka)
const plannedSoon = (ctx, inMin = 25) => createShiftNow(ctx, { startMin: inMin, endMin: inMin + 720 });

// Smena je počela pre lateMin minuta, radnik nije prijavljen
const plannedLate = (ctx, lateMin = 20) => createShiftNow(ctx, { startMin: -lateMin, endMin: 720 - lateMin });

// Radnik je prijavljen na vreme (smena iz rasporeda, pa ceo plan obilaska), tačke su pomerene u budućnost,
// kraj smene je za endMin minuta. Prijava ide kao očitavanje bez interneta sa vremenom početka smene.
// keepEnd: ostaje pravi kraj iz rasporeda (07-19 / 19-07) ako do njega ima mesta za ceo obilazak, inače endMin.
async function active(ctx, { firstMin = 20, stepMin = 30, endMin = 600, keepEnd = false } = {}) {
  const sh = await createShiftNow(ctx);
  const g = await guardApi();
  const at = new Date(new Date(sh.plannedStart).getTime() - 3 * MIN);
  const r = await scanAs(g, ctx.workplace.uid, { offline: true, deviceAt: (at < new Date() ? at : new Date()).toISOString() });
  if (r.result !== 'clock_in') throw new Error(`[scenario] prijava preko API-ja: ${r.result} ${r.message || ''}`);
  const cur = await ctx.api.get(`/shifts/${sh._id}`);
  const lastDueMin = firstMin + Math.max(0, (cur.rounds || []).length - 1) * stepMin;
  if (!keepEnd || (new Date(cur.plannedEnd).getTime() - Date.now()) / MIN < lastDueMin + 30) await moveShift(ctx, sh._id, { endMin });
  await spreadRounds(ctx, sh._id, firstMin, stepMin);
  await clearAlarms(sh._id);
  return ctx.api.get(`/shifts/${sh._id}`);
}

// Povremeni zadatak u smeni (inMin minuta od sada)
const addTask = (ctx, shiftId, text, inMin = 45) => ctx.api.post('/tasks', { shiftId, time: hhmm(new Date(Date.now() + inMin * MIN)), text });

module.exports = { fresh, plannedSoon, plannedLate, active, addTask };
