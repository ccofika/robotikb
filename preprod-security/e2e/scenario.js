// Ručna priprema stanja za pregled aplikacije radnika (E2E Cuvar, Hotel Aurora):
//   node scenario.js soon     smena počinje za 25 min (prijava otvorena)
//   node scenario.js late     smena je počela pre 20 min, radnik nije prijavljen
//   node scenario.js active   radnik je prijavljen, obilazak u budućnosti, jedan povremeni zadatak
//                             (prava smena 07-19 ili 19-07; kraj se pomera samo ako do njega nema mesta za obilazak)
//   node scenario.js none     bez smene
// Posle pripreme otvori aplikaciju ponovo (ili povuci ekran nadole) da se stanje osveži.
const { fresh, plannedSoon, plannedLate, active, addTask } = require('./helpers/scenarios');

(async () => {
  const mode = process.argv[2] || 'active';
  const ctx = await fresh();
  console.log('[scenario] obrisano:', JSON.stringify(ctx.cleaned));
  if (mode === 'none') return;
  let sh;
  if (mode === 'soon') sh = await plannedSoon(ctx);
  else if (mode === 'late') sh = await plannedLate(ctx);
  else {
    sh = await active(ctx, { firstMin: 12, stepMin: 35, keepEnd: true });
    await addTask(ctx, sh._id, 'E2E Doček dostave na rampi, upiši broj kamiona', 50);
  }
  console.log(`[scenario] ${mode}: smena ${sh._id} ${sh.status}, ${new Date(sh.plannedStart).toISOString()} - ${new Date(sh.plannedEnd).toISOString()}, tačaka ${(sh.rounds || []).length}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
