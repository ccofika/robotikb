/**
 * Recalculate FinancialTransactions for Milan Aca + Milan Brdar from 2026-04-01,
 * converting them from 'plata' to 'po_statusu' (fixed per-status price) IN PLACE.
 *
 * - Preserves _id, verifiedAt, finalPrice, customerStatus, evidenceId, etc.
 * - Only modifies the two Milans' entries (+ a single 'plata' co-tech, see PLATA_COTECH_MODE).
 * - po_statusu co-techs are left exactly as they are.
 * - Maps OLD customerStatus -> NEW (" sa isporukom materijala") to find the configured price.
 *
 * Preview:  node scripts/recalcMilanPair.js            (dry-run, no writes)
 * Verbose:  node scripts/recalcMilanPair.js --verbose  (per-transaction dump)
 * Apply:    node scripts/recalcMilanPair.js --apply     (backs up, then writes)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const FinancialSettings = require('../models/FinancialSettings');
const FinancialTransaction = require('../models/FinancialTransaction');
const Technician = require('../models/Technician');

const NAME_PATTERNS = [/milan\s+ac/i, /milan\s+brdar/i];
const FROM_DATE = new Date('2026-04-01T00:00:00.000+02:00');
const APPLY = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--verbose');

// 'plata' co-technician (e.g. Nemanja Isak) sharing a WO with a Milan is handled per the
// production salary rule, confirmed by the user:
//   - The co-tech (salaried) absorbs the job's remainder (finalPrice - po_statusu earnings)
//     toward their monthly salary, but ONLY up to their monthly cap.
//   - Whatever is left after they reach the cap goes to company PROFIT.
// Headroom is computed from the co-tech's OTHER (non-recalculated) transactions that month.

const BASE_STATUSES = [
  'Priključenje korisnika na HFC KDS mreža u zgradi sa instalacijom CPE opreme (izrada kompletne instalacije od RO do korisnika sa instalacijom kompletne CPE opreme)',
  'Priključenje korisnika na HFC KDS mreža u privatnim kućama sa instalacijom CPE opreme (izrada instalacije od PM-a do korisnika sa instalacijom kompletne CPE opreme)',
  'Priključenje korisnika na GPON mrežu u privatnim kućama (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)',
  'Priključenje korisnika na GPON mrežu u zgradi (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)',
  'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji sa montažnim radovima',
  'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji bez montažnih radova',
];
const SUFFIX = ' sa isporukom materijala';

function resolvePrice(priceMap, status) {
  if (!priceMap) return undefined;
  if (priceMap[status] !== undefined && priceMap[status] !== null) return priceMap[status];
  if (BASE_STATUSES.includes(status) && priceMap[status + SUFFIX] !== undefined) return priceMap[status + SUFFIX];
  if (status.endsWith(SUFFIX) && priceMap[status.slice(0, -SUFFIX.length)] !== undefined) return priceMap[status.slice(0, -SUFFIX.length)];
  return undefined;
}

const round2 = n => Math.round(n * 100) / 100;

// Serbia-local (UTC+2 in Apr–Oct) month window for a given date, as UTC instants.
function serbiaMonthRange(date) {
  const local = new Date(date.getTime() + 2 * 3600 * 1000);
  const y = local.getUTCFullYear(), m = local.getUTCMonth();
  return {
    key: `${y}-${m}`,
    start: new Date(Date.UTC(y, m, 1) - 2 * 3600 * 1000),
    end: new Date(Date.UTC(y, m + 1, 1) - 2 * 3600 * 1000),
  };
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected. Mode: ${APPLY ? 'APPLY (writes)' : 'DRY-RUN (no writes)'}`);
  console.log(`Period: verifiedAt >= ${FROM_DATE.toISOString()} (2026-04-01 Serbia)\n`);

  const allTechs = await Technician.find({}).select('_id name paymentType monthlySalary').lean();
  const matched = allTechs.filter(t => NAME_PATTERNS.some(re => re.test(t.name || '')));
  if (matched.length !== 2) throw new Error(`Expected 2 Milans, found ${matched.length}`);
  const matchedIds = new Set(matched.map(t => t._id.toString()));
  const idToName = {}; matched.forEach(t => { idToName[t._id.toString()] = t.name; });

  const settings = await FinancialSettings.findOne().lean();
  const priceLookup = {};
  for (const t of matched) {
    const tp = (settings.technicianPrices || []).find(x => x.technicianId.toString() === t._id.toString());
    priceLookup[t._id.toString()] = tp ? (tp.pricesByCustomerStatus || {}) : {};
  }

  // Use real docs so we can save them.
  const txs = await FinancialTransaction.find({
    'technicians.technicianId': { $in: matched.map(t => t._id) },
    verifiedAt: { $gte: FROM_DATE }
  }).sort({ verifiedAt: 1 });

  console.log(`Found ${txs.length} transactions involving the pair since April 1.\n`);

  const txIdSet = new Set(txs.map(t => t._id.toString()));

  // Cap-aware salary headroom for a plata co-tech in the month of `date`.
  // baseEarned = that tech's earnedTowardsSalary in that month, EXCLUDING the tx we are recalculating.
  // Running map lets multiple disputed jobs in the same month share one headroom budget.
  const headroomMap = {};
  async function getRunningHeadroom(coTechEntry, date) {
    const { key, start, end } = serbiaMonthRange(date);
    const mapKey = `${coTechEntry.technicianId}-${key}`;
    if (headroomMap[mapKey] === undefined) {
      const monthlySalary = await Technician.findById(coTechEntry.technicianId).select('monthlySalary').lean()
        .then(d => (d && d.monthlySalary) || 0);
      const others = await FinancialTransaction.find({
        'technicians.technicianId': coTechEntry.technicianId,
        verifiedAt: { $gte: start, $lt: end },
        _id: { $nin: txs.map(t => t._id) },
      }).lean();
      let baseEarned = 0;
      others.forEach(o => {
        const e = o.technicians.find(t => t.technicianId.toString() === coTechEntry.technicianId.toString());
        if (e && e.paymentType === 'plata' && e.salaryDetails) baseEarned += e.salaryDetails.earnedTowardsSalary || 0;
      });
      headroomMap[mapKey] = { monthlySalary, baseEarned, remaining: Math.max(0, monthlySalary - baseEarned) };
    }
    return headroomMap[mapKey];
  }

  if (APPLY) {
    const backupFile = path.join(__dirname, `backup_milan_recalc_${Date.now()}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(txs.map(t => t.toObject()), null, 2));
    console.log(`Backup of all ${txs.length} transactions written: ${backupFile}\n`);
  }

  let sumOldPair = 0, sumNewPair = 0, sumOldProfit = 0, sumNewProfit = 0;
  let changedTx = 0, unchangedTx = 0, errors = 0;
  const plataCases = [];
  const unresolved = [];

  for (const tx of txs) {
    const entries = tx.technicians;
    const finalPrice = tx.finalPrice;

    // 1) Convert Milan entries to fixed price
    let ourOld = 0, ourNew = 0, hadError = false;
    for (const e of entries) {
      if (!matchedIds.has(e.technicianId.toString())) continue;
      const price = resolvePrice(priceLookup[e.technicianId.toString()], tx.customerStatus);
      ourOld += (e.earnings || 0);
      if (price === undefined || price === 0) {
        unresolved.push({ id: tx._id.toString(), tech: idToName[e.technicianId.toString()], status: tx.customerStatus });
        hadError = true;
        continue;
      }
      ourNew += price;
      e.earnings = price;
      e.paymentType = 'po_statusu';
      e.salaryDetails = undefined;
    }
    if (hadError) { errors++; continue; }

    // 2) Handle co-techs
    const plataCoTechs = entries.filter(e => !matchedIds.has(e.technicianId.toString()) && e.paymentType === 'plata');
    const nonPlataSum = entries
      .filter(e => e.paymentType === 'po_statusu' || matchedIds.has(e.technicianId.toString()))
      .reduce((s, e) => s + (e.earnings || 0), 0);

    if (plataCoTechs.length > 0) {
      let remainder = Math.max(0, finalPrice - nonPlataSum); // what's left for the salaried co-tech(s)
      for (let i = 0; i < plataCoTechs.length; i++) {
        const e = plataCoTechs[i];
        const hr = await getRunningHeadroom(e, tx.verifiedAt);
        const oldCredit = (e.salaryDetails && e.salaryDetails.earnedTowardsSalary) || 0;
        const absorbed = Math.min(remainder, Math.max(0, hr.remaining)); // capped at salary headroom
        const toProfit = round2(remainder - absorbed);                   // over-cap -> company profit
        hr.remaining = round2(hr.remaining - absorbed);

        plataCases.push({
          date: tx.verifiedAt, finalPrice,
          milan: entries.filter(x => matchedIds.has(x.technicianId.toString())).map(x => `${x.name}=${x.earnings}`).join(','),
          coTech: e.name, coTechOld: oldCredit,
          monthlySalary: hr.monthlySalary, baseEarned: hr.baseEarned,
          absorbed, toProfit,
        });

        e.earnings = absorbed;
        e.salaryDetails = {
          monthlySalary: hr.monthlySalary,
          earnedTowardsSalary: absorbed,
          previouslyEarned: hr.baseEarned,
          exceededSalary: absorbed < remainder,
          excessAmount: toProfit,
        };
        remainder = round2(remainder - absorbed); // remaining (over-cap) stays out of earnings -> profit
      }
    }

    // 3) Recompute totals
    const newTotalTechEarnings = round2(entries.reduce((s, e) => s + (e.earnings || 0), 0));
    const newProfit = round2(finalPrice - newTotalTechEarnings);

    sumOldPair += ourOld; sumNewPair += ourNew;
    sumOldProfit += tx.companyProfit; sumNewProfit += newProfit;

    const profitChanged = round2(tx.companyProfit) !== newProfit;
    const earningsChanged = round2(tx.totalTechnicianEarnings) !== newTotalTechEarnings;
    if (profitChanged || earningsChanged || ourOld !== ourNew) changedTx++; else unchangedTx++;

    if (VERBOSE) {
      console.log(`${tx.verifiedAt.toISOString().slice(0,10)} WO=${tx.workOrderId} final=${finalPrice} | pair ${ourOld}->${ourNew} | profit ${round2(tx.companyProfit)}->${newProfit}`);
    }

    tx.totalTechnicianEarnings = newTotalTechEarnings;
    tx.companyProfit = newProfit;
    tx.markModified('technicians'); // force full-array rewrite so cleared salaryDetails persists

    if (APPLY) await tx.save();
  }

  console.log('=== PLATA co-tech cases (cap-aware: absorb up to salary, rest -> profit) ===');
  if (plataCases.length === 0) console.log('  none');
  plataCases.forEach(c => {
    console.log(`  ${c.date.toISOString().slice(0,10)} final=${c.finalPrice} | Milan: ${c.milan} | ${c.coTech} oldCredit=${c.coTechOld}`);
    console.log(`     ${c.coTech}: salary=${c.monthlySalary}, alreadyEarnedThisMonth(excl. these)=${c.baseEarned} -> absorbs ${c.absorbed}, to profit ${c.toProfit}`);
  });

  if (unresolved.length) {
    console.log(`\n!!! ${unresolved.length} entries had NO price (skipped their whole tx):`);
    unresolved.forEach(u => console.log(`   ${u.tech}  ${u.status}`));
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Transactions processed : ${txs.length}`);
  console.log(`  changed              : ${changedTx}`);
  console.log(`  unchanged            : ${unchangedTx}`);
  console.log(`  skipped (no price)   : ${errors}`);
  console.log(`Pair (Aca+Brdar) earnings : ${round2(sumOldPair)} -> ${round2(sumNewPair)}  (delta ${round2(sumNewPair - sumOldPair)})`);
  console.log(`Company profit (sum)      : ${round2(sumOldProfit)} -> ${round2(sumNewProfit)}  (delta ${round2(sumNewProfit - sumOldProfit)})`);

  if (!APPLY) console.log('\nDRY-RUN ONLY — nothing written. Re-run with --apply to commit.');
  else console.log('\nChanges committed.');

  await mongoose.disconnect();
}
run().then(() => process.exit(0)).catch(e => { console.error('Fatal:', e); process.exit(1); });
