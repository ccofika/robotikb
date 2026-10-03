// Ručno: upali alarm za prvi checkpoint aktivne smene test radnika (tačka 8 min posle plana, pa mehanizam alarma)
//   node alarm-now.js [indeks tačke]
// Radi na standardnoj instanci (5300), koju emulator gleda van testova; E2E_TARGET=e2e za instancu za testove.
process.env.E2E_TARGET = process.env.E2E_TARGET || 'main';
const { setup, runEngine } = require('./helpers/api');
const { withDb } = require('./helpers/db');

(async () => {
  const idx = Number(process.argv[2] || 0);
  const ctx = await setup();
  const sh = await withDb((db) => db.collection('securityshifts').findOne({ workerId: ctx.guard._id ? new (require(require.resolve('mongodb', { paths: [require('./helpers/env').BACKEND_DIR] })).ObjectId)(ctx.guard._id) : null, status: 'active' }));
  if (!sh) throw new Error('nema aktivne smene (node scenario.js active)');
  await ctx.api.post('/_test/round-due', { shiftId: sh._id, index: idx, offsetMin: -8 });
  const r = await runEngine(ctx);
  console.log('[alarm] mehanizam:', JSON.stringify(r).slice(0, 300));
})().catch((e) => { console.error(e.message); process.exit(1); });
