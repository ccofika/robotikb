/**
 * READ-ONLY investigation for Milan Aca + Milan Brdar pair recalc.
 * Does NOT write anything. Just gathers facts so we can plan the recalc safely.
 *
 * Run:  node scripts/investigateMilanPair.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const FinancialSettings = require('../models/FinancialSettings');
const FinancialTransaction = require('../models/FinancialTransaction');
const Technician = require('../models/Technician');

// Match by case-insensitive substring so we catch full names like "Milan Aleksić" etc.
const NAME_PATTERNS = [/milan\s+ac/i, /milan\s+brdar/i];
const FROM_DATE = new Date('2026-04-01T00:00:00.000+02:00'); // 1. april 00:00 po srpskom vremenu

function short(s, n = 55) {
  if (!s) return String(s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

async function run() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGODB_URI not set');
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB\n');
  console.log(`FROM_DATE = ${FROM_DATE.toISOString()} (= 2026-04-01 00:00 Serbia)\n`);

  // 1) Find the two technicians
  const allTechs = await Technician.find({}).select('_id name paymentType monthlySalary role isAdmin').lean();
  const matched = allTechs.filter(t => NAME_PATTERNS.some(re => re.test(t.name || '')));

  console.log('=== MATCHED TECHNICIANS ===');
  matched.forEach(t => {
    console.log(`  ${t.name}  id=${t._id}  paymentType=${t.paymentType || 'po_statusu'}  monthlySalary=${t.monthlySalary || 0}  role=${t.role}`);
  });
  if (matched.length === 0) {
    console.log('  NONE matched — listing all technician names so we can fix the pattern:');
    allTechs.forEach(t => console.log(`   - ${t.name}`));
    await mongoose.disconnect();
    return;
  }
  const matchedIds = matched.map(t => t._id.toString());
  const idToName = {};
  matched.forEach(t => { idToName[t._id.toString()] = t.name; });

  // 2) Their configured po_statusu prices
  const settings = await FinancialSettings.findOne().lean();
  if (!settings) throw new Error('FinancialSettings not found');
  console.log('\n=== CONFIGURED PER-STATUS PRICES (technicianPrices) ===');
  for (const t of matched) {
    const tp = (settings.technicianPrices || []).find(x => x.technicianId.toString() === t._id.toString());
    console.log(`\n  ${t.name}:`);
    if (!tp) { console.log('    (no technicianPrices entry!)'); continue; }
    Object.entries(tp.pricesByCustomerStatus || {}).forEach(([k, v]) => {
      console.log(`    ${String(v).padStart(6)} RSD  ${short(k, 70)}`);
    });
  }

  // build quick lookup: techId -> { customerStatus -> price }
  const priceLookup = {};
  for (const t of matched) {
    const tp = (settings.technicianPrices || []).find(x => x.technicianId.toString() === t._id.toString());
    priceLookup[t._id.toString()] = tp ? (tp.pricesByCustomerStatus || {}) : {};
  }

  // 3) All transactions since April 1 involving either tech
  const txs = await FinancialTransaction.find({
    'technicians.technicianId': { $in: matched.map(t => t._id) },
    verifiedAt: { $gte: FROM_DATE }
  }).sort({ verifiedAt: 1 }).lean();

  console.log(`\n=== TRANSACTIONS SINCE APRIL 1 INVOLVING THE PAIR: ${txs.length} ===`);

  // also report transactions BEFORE April that involve them, for context (count only)
  const txsBefore = await FinancialTransaction.countDocuments({
    'technicians.technicianId': { $in: matched.map(t => t._id) },
    verifiedAt: { $lt: FROM_DATE }
  });
  console.log(`(For context: ${txsBefore} transactions BEFORE April 1 — will NOT be touched)\n`);

  let bothTogether = 0, soloCount = 0, withOtherTech = 0;
  const statusCounts = {};
  const missingPriceRows = [];
  let curTotalOld = 0;        // current earnings of our pair (sum across tx)
  let projTotalNew = 0;       // projected earnings of our pair under po_statusu
  let curProfitTotal = 0;
  let projProfitTotal = 0;
  const otherPlataCoTechs = new Set();

  for (const tx of txs) {
    const entries = tx.technicians || [];
    const ourEntries = entries.filter(e => matchedIds.includes(e.technicianId.toString()));
    const otherEntries = entries.filter(e => !matchedIds.includes(e.technicianId.toString()));

    if (ourEntries.length === 2) bothTogether++;
    else if (otherEntries.length === 0) soloCount++;
    else withOtherTech++;

    otherEntries.forEach(e => {
      if (e.paymentType === 'plata') otherPlataCoTechs.add(e.name);
    });

    statusCounts[tx.customerStatus] = (statusCounts[tx.customerStatus] || 0) + 1;

    // project new earnings for our pair entries
    let newTotalTechEarnings = 0;
    // keep other entries' earnings as-is
    otherEntries.forEach(e => { newTotalTechEarnings += (e.earnings || 0); });

    let rowMissing = false;
    ourEntries.forEach(e => {
      const price = priceLookup[e.technicianId.toString()][tx.customerStatus];
      if (price === undefined || price === null || price === 0) {
        rowMissing = true;
        missingPriceRows.push({
          tx: tx._id.toString(),
          date: tx.verifiedAt,
          tech: idToName[e.technicianId.toString()],
          status: tx.customerStatus,
          configuredPrice: price
        });
      }
      newTotalTechEarnings += (price || 0);
      curTotalOld += (e.earnings || 0);
      projTotalNew += (price || 0);
    });

    const newProfit = tx.finalPrice - newTotalTechEarnings;
    curProfitTotal += tx.companyProfit;
    projProfitTotal += newProfit;
  }

  console.log('--- Pairing breakdown ---');
  console.log(`  Both Aca & Brdar on same WO : ${bothTogether}`);
  console.log(`  One of them solo            : ${soloCount}`);
  console.log(`  Paired with OTHER technician: ${withOtherTech}`);
  console.log(`  Other PLATA co-technicians  : ${otherPlataCoTechs.size ? [...otherPlataCoTechs].join(', ') : 'NONE (good)'}`);

  console.log('\n--- customerStatus distribution ---');
  Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`  ${String(v).padStart(3)}x  ${short(k, 75)}`);
  });

  console.log('\n--- per-transaction detail ---');
  for (const tx of txs) {
    const ourEntries = (tx.technicians || []).filter(e => matchedIds.includes(e.technicianId.toString()));
    const parts = (tx.technicians || []).map(e => {
      const isOurs = matchedIds.includes(e.technicianId.toString());
      const tag = isOurs ? '*' : '';
      return `${tag}${e.name}[${e.paymentType}:${e.earnings}]`;
    }).join('  ');
    const newParts = ourEntries.map(e => {
      const price = priceLookup[e.technicianId.toString()][tx.customerStatus];
      return `${e.name}:${e.earnings}->${price === undefined ? 'NO_PRICE' : price}`;
    }).join('  ');
    console.log(
      `  ${tx.verifiedAt.toISOString().slice(0, 10)}  WO=${tx.workOrderId}  ` +
      `final=${tx.finalPrice}  profit=${tx.companyProfit}  | ${short(tx.customerStatus, 40)}\n` +
      `        techs: ${parts}\n` +
      `        change: ${newParts}`
    );
  }

  console.log('\n=== PROJECTION SUMMARY (surgical po_statusu conversion) ===');
  console.log(`  Pair earnings  : ${curTotalOld} -> ${projTotalNew}  (delta ${projTotalNew - curTotalOld})`);
  console.log(`  Company profit : ${curProfitTotal} -> ${projProfitTotal}  (delta ${projProfitTotal - curProfitTotal})`);

  if (missingPriceRows.length) {
    console.log(`\n!!! ${missingPriceRows.length} entries have NO configured price for their customerStatus (would become 0):`);
    missingPriceRows.forEach(m => {
      console.log(`   ${m.date.toISOString().slice(0,10)}  ${m.tech}  price=${m.configuredPrice}  status="${m.status}"`);
    });
  } else {
    console.log('\nAll involved (status x technician) combinations have a configured price. ✓');
  }

  await mongoose.disconnect();
  console.log('\nDone (read-only, nothing written).');
}

run().then(() => process.exit(0)).catch(err => { console.error('Fatal:', err); process.exit(1); });
