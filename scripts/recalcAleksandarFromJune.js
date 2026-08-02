/**
 * Recalculate Aleksandar Gagić's FinancialTransactions from 2026-06-01, converting HIS
 * entries from 'plata' to 'po_statusu' (fixed per-status price = Milan Pešić's prices) IN PLACE.
 *
 * - Preserves _id, verifiedAt, finalPrice, customerStatus, evidenceId, etc.
 * - Modifies ONLY Aleksandar's technician entries; co-technicians (Milan Pešić) are left
 *   exactly as they are — his historical pay does not change.
 * - Recomputes totalTechnicianEarnings and companyProfit per transaction.
 * - Price source: Aleksandar's FinancialSettings.technicianPrices entry if present
 *   (i.e. after migrateAleksandarGagic.js --apply), otherwise a fallback copy of Milan's.
 *
 * Preview:  node scripts/recalcAleksandarFromJune.js           (dry-run, no writes)
 * Apply:    node scripts/recalcAleksandarFromJune.js --apply   (backs up, then writes)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const FinancialSettings = require('../models/FinancialSettings');
const FinancialTransaction = require('../models/FinancialTransaction');
const Technician = require('../models/Technician');

const ALEKS_RE = /^aleksandar\s+gagi[cć]$/i;
const MILAN_RE = /^milan\s+pe[sš]i[cć]$/i;
const FROM_DATE = new Date('2026-06-01T00:00:00.000+02:00'); // June 1 Serbia local
const APPLY = process.argv.includes('--apply');

// Old customerStatus variants (without " sa isporukom materijala") -> price map uses new keys
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
const shortStatus = s => {
  const base = s.replace(new RegExp(SUFFIX + '$'), '');
  if (/HFC KDS mreža u zgradi/.test(base)) return 'HFC-zgrada';
  if (/HFC KDS mreža u privatnim/.test(base)) return 'HFC-kuća';
  if (/GPON mrežu u privatnim/.test(base)) return 'GPON-kuća';
  if (/GPON mrežu u zgradi/.test(base)) return 'GPON-zgrada';
  if (/sa montažnim radovima/.test(base)) return 'Radovi-sa-mont';
  if (/bez montažnih radova/.test(base)) return 'Radovi-bez-mont';
  return base.slice(0, 30);
};

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected. Mode: ${APPLY ? 'APPLY (writes)' : 'DRY-RUN (no writes)'}`);
  console.log(`Period: verifiedAt >= ${FROM_DATE.toISOString()} (2026-06-01 Serbia)\n`);

  const all = await Technician.find({}).select('_id name paymentType monthlySalary').lean();
  const aleksMatches = all.filter(t => ALEKS_RE.test(t.name || ''));
  if (aleksMatches.length !== 1) throw new Error(`Expected exactly 1 Aleksandar Gagić, found ${aleksMatches.length}`);
  const aleks = aleksMatches[0];
  const aleksId = aleks._id.toString();
  console.log(`Technician: ${aleks.name} [${aleksId}] (current paymentType=${aleks.paymentType})`);

  // --- Resolve price map ---
  const settings = await FinancialSettings.findOne().lean();
  let priceMap = null, priceSource = '';
  const ownEntry = (settings.technicianPrices || []).find(x => x.technicianId.toString() === aleksId);
  if (ownEntry && Object.values(ownEntry.pricesByCustomerStatus || {}).some(v => v > 0)) {
    priceMap = ownEntry.pricesByCustomerStatus;
    priceSource = 'Aleksandar\'s own technicianPrices entry';
  } else {
    const milan = all.find(t => MILAN_RE.test(t.name || ''));
    if (!milan) throw new Error('No price entry for Aleksandar AND Milan Pešić not found — nothing to price from.');
    const milanEntry = (settings.technicianPrices || []).find(x => x.technicianId.toString() === milan._id.toString());
    if (!milanEntry) throw new Error('No price entry for Aleksandar AND Milan has no entry either.');
    priceMap = milanEntry.pricesByCustomerStatus;
    priceSource = `FALLBACK: Milan Pešić's prices (Aleksandar's entry missing — run migrateAleksandarGagic.js --apply first)`;
  }
  console.log(`Price source: ${priceSource}`);
  if (APPLY && priceSource.startsWith('FALLBACK')) {
    throw new Error('Refusing to APPLY with fallback price source — apply migrateAleksandarGagic.js first so settings are consistent.');
  }

  const txs = await FinancialTransaction.find({
    'technicians.technicianId': aleks._id,
    verifiedAt: { $gte: FROM_DATE }
  }).sort({ verifiedAt: 1 });
  console.log(`Found ${txs.length} transactions since June 1.\n`);

  if (APPLY) {
    const backupFile = path.join(__dirname, `backup_aleksandar_recalc_${Date.now()}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(txs.map(t => t.toObject()), null, 2));
    console.log(`Backup of all ${txs.length} transactions written: ${backupFile}\n`);
  }

  let sumOld = 0, sumNew = 0, sumOldProfit = 0, sumNewProfit = 0;
  let changedTx = 0, unchangedTx = 0, skipped = 0;
  const unresolved = [], anomalies = [], byMonth = {}, byStatus = {};

  for (const tx of txs) {
    const mine = tx.technicians.filter(e => e.technicianId.toString() === aleksId);
    const others = tx.technicians.filter(e => e.technicianId.toString() !== aleksId);
    if (mine.length !== 1) {
      anomalies.push(`tx ${tx._id}: Aleksandar appears ${mine.length}x — skipped`);
      skipped++;
      continue;
    }
    // sanity: co-techs should be Milan Pešić only; flag (but don't skip) anything else
    others.forEach(o => {
      if (!MILAN_RE.test(o.name || '')) anomalies.push(`tx ${tx._id}: unexpected co-tech ${JSON.stringify(o.name)} (${o.paymentType}, earnings=${o.earnings}) — left untouched`);
      if (o.paymentType === 'plata' && (o.earnings || 0) > 0) anomalies.push(`tx ${tx._id} ${tx.verifiedAt.toISOString().slice(0, 10)}: co-tech ${o.name} is plata with earnings=${o.earnings} — left untouched (his pay unchanged)`);
    });

    const e = mine[0];
    const price = resolvePrice(priceMap, tx.customerStatus);
    if (price === undefined || price === 0) {
      unresolved.push({ id: tx._id.toString(), status: tx.customerStatus, price });
      skipped++;
      continue;
    }

    const oldEarnings = e.earnings || 0;
    const oldProfit = tx.companyProfit;

    e.earnings = price;
    e.paymentType = 'po_statusu';
    e.salaryDetails = undefined;

    const newTotal = round2(tx.technicians.reduce((s, x) => s + (x.earnings || 0), 0));
    const newProfit = round2(tx.finalPrice - newTotal);

    const m = tx.verifiedAt.toISOString().slice(0, 7);
    byMonth[m] = byMonth[m] || { n: 0, old: 0, nw: 0 };
    byMonth[m].n++; byMonth[m].old += oldEarnings; byMonth[m].nw += price;
    const ss = shortStatus(tx.customerStatus);
    byStatus[ss] = byStatus[ss] || { n: 0, price, old: 0 };
    byStatus[ss].n++; byStatus[ss].old += oldEarnings;

    sumOld += oldEarnings; sumNew += price;
    sumOldProfit += oldProfit; sumNewProfit += newProfit;
    if (oldEarnings !== price || round2(oldProfit) !== newProfit) changedTx++; else unchangedTx++;

    console.log(
      `${tx.verifiedAt.toISOString().slice(0, 10)} ${ss.padEnd(15)} final=${String(tx.finalPrice).padStart(7)} | ` +
      `Aleksandar ${String(oldEarnings).padStart(7)} -> ${String(price).padStart(5)} | ` +
      `profit ${String(round2(oldProfit)).padStart(8)} -> ${String(newProfit).padStart(8)} | ` +
      `co: ${others.map(o => `${o.name}=${o.earnings}(${o.paymentType})`).join(', ') || 'none'}`
    );

    tx.totalTechnicianEarnings = newTotal;
    tx.companyProfit = newProfit;
    tx.markModified('technicians'); // force full-array rewrite so cleared salaryDetails persists

    if (APPLY) await tx.save();
  }

  if (anomalies.length) {
    console.log('\n=== ANOMALIES / NOTES ===');
    anomalies.forEach(a => console.log(`  ${a}`));
  }
  if (unresolved.length) {
    console.log(`\n!!! ${unresolved.length} tx had NO usable price (SKIPPED, not modified):`);
    unresolved.forEach(u => console.log(`   ${u.id}  price=${u.price}  ${u.status}`));
  }

  console.log('\n=== PO STATUSU (new price per job) ===');
  Object.entries(byStatus).forEach(([s, v]) =>
    console.log(`  ${s.padEnd(15)} ${String(v.n).padStart(3)}x @ ${String(v.price).padStart(5)} = ${String(v.n * v.price).padStart(7)}   (staro: ${round2(v.old)})`));

  console.log('\n=== PO MESECIMA (Aleksandar) ===');
  Object.entries(byMonth).forEach(([m, v]) =>
    console.log(`  ${m}: ${String(v.n).padStart(3)} tx   ${String(round2(v.old)).padStart(9)} -> ${String(round2(v.nw)).padStart(8)}   (delta ${round2(v.nw - v.old)})`));

  console.log('\n=== SUMMARY ===');
  console.log(`Transactions processed : ${txs.length}`);
  console.log(`  changed              : ${changedTx}`);
  console.log(`  unchanged            : ${unchangedTx}`);
  console.log(`  skipped              : ${skipped}`);
  console.log(`Aleksandar earnings    : ${round2(sumOld)} -> ${round2(sumNew)}  (delta ${round2(sumNew - sumOld)})`);
  console.log(`Company profit (sum)   : ${round2(sumOldProfit)} -> ${round2(sumNewProfit)}  (delta ${round2(sumNewProfit - sumOldProfit)})`);

  // conservation check: earnings delta must mirror profit delta (Milan untouched)
  const conserves = round2((sumNew - sumOld) + (sumNewProfit - sumOldProfit)) === 0;
  console.log(`Conservation check (earnings delta + profit delta = 0): ${conserves ? 'OK' : '!!! MISMATCH'}`);

  if (APPLY) {
    // --- Verify by re-reading ---
    const fresh = await FinancialTransaction.find({
      'technicians.technicianId': aleks._id,
      verifiedAt: { $gte: FROM_DATE }
    }).lean();
    let bad = 0;
    fresh.forEach(tx => {
      const e = tx.technicians.find(x => x.technicianId.toString() === aleksId);
      const expected = resolvePrice(priceMap, tx.customerStatus);
      const total = round2(tx.technicians.reduce((s, x) => s + (x.earnings || 0), 0));
      if (!e || e.paymentType !== 'po_statusu' || e.earnings !== expected ||
          round2(tx.totalTechnicianEarnings) !== total || round2(tx.companyProfit) !== round2(tx.finalPrice - total)) bad++;
    });
    console.log(`\n=== VERIFICATION (re-read ${fresh.length} tx) ===`);
    console.log(bad === 0 ? 'ALL OK — recalc committed.' : `!!! ${bad} transactions FAILED verification — inspect immediately (backup JSON is next to this script).`);
  } else {
    console.log('\nDRY-RUN ONLY — nothing written. Re-run with --apply to commit.');
  }

  await mongoose.disconnect();
}
run().then(() => process.exit(0)).catch(e => { console.error('Fatal:', e); process.exit(1); });
