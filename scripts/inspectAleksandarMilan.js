/**
 * READ-ONLY inspection for the Aleksandar Gagic -> po_statusu (Milan Pešić prices) change.
 * Dumps: technician docs, FinancialSettings.technicianPrices entries for both,
 * Aleksandar's FinancialTransactions since 2026-06-01, and name-variant counts.
 *
 * Run: node scripts/inspectAleksandarMilan.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Technician = require('../models/Technician');
const FinancialSettings = require('../models/FinancialSettings');
const FinancialTransaction = require('../models/FinancialTransaction');
const WorkOrderEvidence = require('../models/WorkOrderEvidence');

const FROM_DATE = new Date('2026-06-01T00:00:00.000+02:00'); // June 1 Serbia local

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected (READ-ONLY).\n');

  const all = await Technician.find({}).select('_id name paymentType monthlySalary isActive').lean();

  const aleks = all.filter(t => /gagi/i.test(t.name || ''));
  const milanPesic = all.filter(t => /pe[sš]i/i.test(t.name || ''));
  const otherAleks = all.filter(t => /aleksandar/i.test(t.name || '') && !/gagi/i.test(t.name || ''));

  console.log('=== Technicians matching /gagi/i ===');
  aleks.forEach(t => console.log(`  [${t._id}] name=${JSON.stringify(t.name)} paymentType=${t.paymentType} monthlySalary=${t.monthlySalary} isActive=${t.isActive}`));
  console.log('=== Technicians matching /pe[sš]i/i (Milan Pešić?) ===');
  milanPesic.forEach(t => console.log(`  [${t._id}] name=${JSON.stringify(t.name)} paymentType=${t.paymentType} monthlySalary=${t.monthlySalary} isActive=${t.isActive}`));
  console.log('=== Other "Aleksandar" technicians (sanity) ===');
  otherAleks.forEach(t => console.log(`  [${t._id}] name=${JSON.stringify(t.name)}`));

  if (aleks.length !== 1 || milanPesic.length !== 1) {
    console.log(`\n!!! Expected exactly 1 match each. Got gagi=${aleks.length}, pesi=${milanPesic.length}. Inspect above.`);
  }

  const settings = await FinancialSettings.findOne().lean();
  console.log(`\nFinancialSettings docs technicianPrices entries: ${(settings.technicianPrices || []).length}`);

  for (const t of [...aleks, ...milanPesic]) {
    const tp = (settings.technicianPrices || []).find(x => x.technicianId.toString() === t._id.toString());
    console.log(`\n--- technicianPrices for ${t.name} ---`);
    if (!tp) { console.log('  (no entry)'); continue; }
    const prices = tp.pricesByCustomerStatus || {};
    Object.entries(prices).forEach(([k, v]) => {
      const short = k.length > 70 ? k.slice(0, 67) + '...' : k;
      console.log(`  ${v}\t${short}`);
    });
  }

  // Aleksandar's transactions since June 1
  for (const t of aleks) {
    const txs = await FinancialTransaction.find({
      'technicians.technicianId': t._id,
      verifiedAt: { $gte: FROM_DATE }
    }).sort({ verifiedAt: 1 }).lean();

    console.log(`\n=== ${t.name}: ${txs.length} FinancialTransactions with verifiedAt >= 2026-06-01 ===`);

    const byStatus = {};
    const byMonth = {};
    const nameVariants = {};
    let sumEarnings = 0, plataCount = 0, poStatusuCount = 0, coTechTx = 0;

    txs.forEach(tx => {
      const e = tx.technicians.find(x => x.technicianId.toString() === t._id.toString());
      sumEarnings += (e.earnings || 0);
      if (e.paymentType === 'plata') plataCount++; else poStatusuCount++;
      nameVariants[e.name] = (nameVariants[e.name] || 0) + 1;
      byStatus[tx.customerStatus] = byStatus[tx.customerStatus] || { n: 0, earn: 0 };
      byStatus[tx.customerStatus].n++;
      byStatus[tx.customerStatus].earn += (e.earnings || 0);
      const m = tx.verifiedAt.toISOString().slice(0, 7);
      byMonth[m] = byMonth[m] || { n: 0, earn: 0 };
      byMonth[m].n++;
      byMonth[m].earn += (e.earnings || 0);
      if (tx.technicians.length > 1) coTechTx++;
    });

    console.log(`  His entries: plata=${plataCount}, po_statusu=${poStatusuCount}, total earnings=${Math.round(sumEarnings * 100) / 100}`);
    console.log(`  Tx with co-technicians: ${coTechTx}`);
    console.log(`  Name variants in tx: ${JSON.stringify(nameVariants)}`);
    console.log('  By month (his earnings):');
    Object.entries(byMonth).forEach(([m, v]) => console.log(`    ${m}: ${v.n} tx, ${Math.round(v.earn * 100) / 100}`));
    console.log('  By customerStatus:');
    Object.entries(byStatus).forEach(([s, v]) => {
      const short = s.length > 70 ? s.slice(0, 67) + '...' : s;
      console.log(`    ${v.n}x  earn=${Math.round(v.earn * 100) / 100}  ${short}`);
    });

    // Co-technicians involved
    const coTechs = {};
    txs.forEach(tx => tx.technicians.forEach(e => {
      if (e.technicianId.toString() !== t._id.toString()) {
        const key = `${e.name} (${e.paymentType})`;
        coTechs[key] = (coTechs[key] || 0) + 1;
      }
    }));
    console.log(`  Co-technicians on those tx: ${JSON.stringify(coTechs)}`);

    // ALL name copies anywhere (not date-limited) — to size the rename
    const txAllCount = await FinancialTransaction.countDocuments({ 'technicians.technicianId': t._id });
    const evid1 = await WorkOrderEvidence.countDocuments({ technician1: t.name });
    const evid2 = await WorkOrderEvidence.countDocuments({ technician2: t.name });
    console.log(`\n  Rename footprint: FinancialTransaction docs (all time)=${txAllCount}, WorkOrderEvidence technician1=${evid1}, technician2=${evid2}`);
  }

  await mongoose.disconnect();
}
run().then(() => process.exit(0)).catch(e => { console.error('Fatal:', e); process.exit(1); });
