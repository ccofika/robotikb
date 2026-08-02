/**
 * READ-ONLY investigation v2 for Milan Aca + Milan Brdar pair recalc.
 * Fixes the old->new customerStatus mapping and produces a correct projection.
 * Writes NOTHING.
 *
 * Run:  node scripts/investigateMilanPair2.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const FinancialSettings = require('../models/FinancialSettings');
const FinancialTransaction = require('../models/FinancialTransaction');
const WorkOrderEvidence = require('../models/WorkOrderEvidence');
const Technician = require('../models/Technician');

const NAME_PATTERNS = [/milan\s+ac/i, /milan\s+brdar/i];
const FROM_DATE = new Date('2026-04-01T00:00:00.000+02:00');

// The 6 base statuses that exist in both OLD and NEW (" sa isporukom materijala") form.
const BASE_STATUSES = [
  'Priključenje korisnika na HFC KDS mreža u zgradi sa instalacijom CPE opreme (izrada kompletne instalacije od RO do korisnika sa instalacijom kompletne CPE opreme)',
  'Priključenje korisnika na HFC KDS mreža u privatnim kućama sa instalacijom CPE opreme (izrada instalacije od PM-a do korisnika sa instalacijom kompletne CPE opreme)',
  'Priključenje korisnika na GPON mrežu u privatnim kućama (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)',
  'Priključenje korisnika na GPON mrežu u zgradi (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)',
  'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji sa montažnim radovima',
  'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji bez montažnih radova',
];
const SUFFIX = ' sa isporukom materijala';

// Resolve a price from a technician's pricesByCustomerStatus map for a given (possibly old) status.
function resolvePrice(priceMap, status) {
  if (!priceMap) return { price: undefined, keyUsed: null };
  if (priceMap[status] !== undefined && priceMap[status] !== null) {
    return { price: priceMap[status], keyUsed: 'exact' };
  }
  // If it's an OLD base status, try the NEW (+suffix) key
  if (BASE_STATUSES.includes(status)) {
    const newKey = status + SUFFIX;
    if (priceMap[newKey] !== undefined) return { price: priceMap[newKey], keyUsed: 'old->new' };
  }
  // If it's a NEW status, try stripping the suffix to an OLD key (defensive)
  if (status.endsWith(SUFFIX)) {
    const oldKey = status.slice(0, -SUFFIX.length);
    if (priceMap[oldKey] !== undefined) return { price: priceMap[oldKey], keyUsed: 'new->old' };
  }
  return { price: undefined, keyUsed: null };
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected\n');

  const allTechs = await Technician.find({}).select('_id name paymentType monthlySalary').lean();
  const matched = allTechs.filter(t => NAME_PATTERNS.some(re => re.test(t.name || '')));
  const matchedIds = matched.map(t => t._id.toString());
  const idToName = {}; matched.forEach(t => { idToName[t._id.toString()] = t.name; });

  const settings = await FinancialSettings.findOne().lean();
  const priceLookup = {};
  for (const t of matched) {
    const tp = (settings.technicianPrices || []).find(x => x.technicianId.toString() === t._id.toString());
    priceLookup[t._id.toString()] = tp ? (tp.pricesByCustomerStatus || {}) : {};
  }

  const txs = await FinancialTransaction.find({
    'technicians.technicianId': { $in: matched.map(t => t._id) },
    verifiedAt: { $gte: FROM_DATE }
  }).sort({ verifiedAt: 1 }).lean();

  // exact status strings with counts
  const statusCounts = {};
  txs.forEach(tx => { statusCounts[tx.customerStatus] = (statusCounts[tx.customerStatus] || 0) + 1; });
  console.log('=== EXACT customerStatus values (transactions) ===');
  Object.entries(statusCounts).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => {
    const isOld = BASE_STATUSES.includes(k);
    const isNew = k.endsWith(SUFFIX);
    const tag = isOld ? 'OLD' : (isNew ? 'NEW' : 'OTHER');
    console.log(`  ${String(v).padStart(3)}x [${tag}] ${k}`);
  });

  // categorize + project
  const cats = { both: [], solo: [], with_po_statusu: [], with_plata: [] };
  let unresolved = [];

  for (const tx of txs) {
    const entries = tx.technicians || [];
    const ours = entries.filter(e => matchedIds.includes(e.technicianId.toString()));
    const others = entries.filter(e => !matchedIds.includes(e.technicianId.toString()));

    // compute new earnings for our entries
    let ourNew = 0, ourOld = 0;
    for (const e of ours) {
      const { price, keyUsed } = resolvePrice(priceLookup[e.technicianId.toString()], tx.customerStatus);
      ourOld += (e.earnings || 0);
      if (price === undefined || price === 0) {
        unresolved.push({ date: tx.verifiedAt, tech: idToName[e.technicianId.toString()], status: tx.customerStatus, price });
      }
      ourNew += (price || 0);
    }
    const othersOldEarnings = others.reduce((s, e) => s + (e.earnings || 0), 0);

    const rec = {
      id: tx._id.toString(), date: tx.verifiedAt, wo: tx.workOrderId, status: tx.customerStatus,
      finalPrice: tx.finalPrice, oldProfit: tx.companyProfit,
      ours, others, ourOld, ourNew, othersOldEarnings,
      newTotalTechEarnings_keepOthers: ourNew + othersOldEarnings,
    };
    rec.newProfit_keepOthers = tx.finalPrice - rec.newTotalTechEarnings_keepOthers;

    if (ours.length === 2) cats.both.push(rec);
    else if (others.length === 0) cats.solo.push(rec);
    else if (others.some(e => e.paymentType === 'plata')) cats.with_plata.push(rec);
    else cats.with_po_statusu.push(rec);
  }

  function summarize(name, arr) {
    const oldPairEarn = arr.reduce((s, r) => s + r.ourOld, 0);
    const newPairEarn = arr.reduce((s, r) => s + r.ourNew, 0);
    const oldProfit = arr.reduce((s, r) => s + r.oldProfit, 0);
    const newProfit = arr.reduce((s, r) => s + r.newProfit_keepOthers, 0);
    console.log(`\n--- ${name}: ${arr.length} tx ---`);
    console.log(`   pair earnings : ${oldPairEarn} -> ${newPairEarn}  (delta ${newPairEarn - oldPairEarn})`);
    console.log(`   company profit: ${oldProfit} -> ${newProfit}  (delta ${(newProfit - oldProfit).toFixed(2)})`);
  }

  console.log('\n=== CATEGORY SUMMARIES (projection: Milans->fixed price, co-techs kept as-is) ===');
  summarize('BOTH Milans together', cats.both);
  summarize('SOLO (one Milan only)', cats.solo);
  summarize('With OTHER po_statusu tech', cats.with_po_statusu);
  summarize('With OTHER *plata* tech (NEEDS DECISION)', cats.with_plata);

  const grandOldEarn = txs.reduce((s,_,i)=>s,0); // placeholder
  const allRecs = [...cats.both, ...cats.solo, ...cats.with_po_statusu, ...cats.with_plata];
  const totOldEarn = allRecs.reduce((s,r)=>s+r.ourOld,0);
  const totNewEarn = allRecs.reduce((s,r)=>s+r.ourNew,0);
  const totOldProfit = allRecs.reduce((s,r)=>s+r.oldProfit,0);
  const totNewProfit = allRecs.reduce((s,r)=>s+r.newProfit_keepOthers,0);
  console.log('\n=== GRAND TOTAL (all 122 tx) ===');
  console.log(`   pair earnings : ${totOldEarn} -> ${totNewEarn}  (delta ${totNewEarn-totOldEarn})`);
  console.log(`   company profit: ${totOldProfit.toFixed(2)} -> ${totNewProfit.toFixed(2)}  (delta ${(totNewProfit-totOldProfit).toFixed(2)})`);

  // Detail the plata-co-tech cases
  console.log('\n=== DETAIL: WOs where a Milan is paired with a PLATA co-tech ===');
  for (const r of cats.with_plata) {
    const techStr = [...r.ours, ...r.others].map(e => {
      const ours = matchedIds.includes(e.technicianId.toString());
      return `${ours?'*':''}${e.name}[${e.paymentType}:${e.earnings}${e.salaryDetails?` toSal=${e.salaryDetails.earnedTowardsSalary}`:''}]`;
    }).join('  ');
    console.log(`  ${r.date.toISOString().slice(0,10)} final=${r.finalPrice} oldProfit=${r.oldProfit} | ${techStr}`);
    console.log(`     -> ourNew=${r.ourNew}, keepOthers profit=${r.newProfit_keepOthers}`);
  }

  // price resolution sanity
  if (unresolved.length) {
    console.log(`\n!!! ${unresolved.length} Milan entries still have NO price>0 after mapping:`);
    const byStatus = {};
    unresolved.forEach(u => { byStatus[u.status] = (byStatus[u.status]||0)+1; });
    Object.entries(byStatus).forEach(([k,v]) => console.log(`   ${v}x  price-missing for: ${k}`));
  } else {
    console.log('\nAll Milan entries resolve to a configured price > 0 (after old->new mapping). ✓');
  }

  // Compare evidence.customerStatus vs transaction.customerStatus for a sample (re-run viability)
  console.log('\n=== SAMPLE: evidence.customerStatus vs transaction.customerStatus (first 5) ===');
  for (const tx of txs.slice(0, 5)) {
    const ev = await WorkOrderEvidence.findOne({ workOrderId: tx.workOrderId }).select('customerStatus').lean();
    const same = ev && ev.customerStatus === tx.customerStatus;
    console.log(`  WO=${tx.workOrderId}`);
    console.log(`     tx.customerStatus : ${tx.customerStatus}`);
    console.log(`     ev.customerStatus : ${ev ? ev.customerStatus : '(no evidence)'}  ${same?'[SAME]':'[DIFFERENT]'}`);
  }

  await mongoose.disconnect();
  console.log('\nDone (read-only).');
}
run().then(()=>process.exit(0)).catch(e=>{console.error('Fatal:',e);process.exit(1);});
