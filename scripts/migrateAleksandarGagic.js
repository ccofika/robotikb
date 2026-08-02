/**
 * Aleksandar Gagic — switch to po_statusu with Milan Pešić's prices + rename c -> ć.
 *
 * Does 4 things (all-or-nothing on --apply):
 *   1. Technician doc: name "Aleksandar Gagic" -> "Aleksandar Gagić",
 *      paymentType 'plata' -> 'po_statusu', monthlySalary -> 0  (same as Milan Pešić)
 *   2. FinancialSettings.technicianPrices: add/overwrite entry for Aleksandar with an
 *      exact COPY of Milan Pešić's pricesByCustomerStatus
 *   3. FinancialTransaction.technicians[].name copies -> "Aleksandar Gagić" (matched by technicianId)
 *   4. WorkOrderEvidence.technician1/technician2 exact-name copies -> "Aleksandar Gagić"
 *
 * NOTE: it does NOT recalculate historical transactions — that is scripts/recalcAleksandarFromJune.js
 * (run it AFTER this one is applied).
 *
 * Preview:  node scripts/migrateAleksandarGagic.js           (dry-run, no writes)
 * Apply:    node scripts/migrateAleksandarGagic.js --apply   (backs up, then writes)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Technician = require('../models/Technician');
const FinancialSettings = require('../models/FinancialSettings');
const FinancialTransaction = require('../models/FinancialTransaction');
const WorkOrderEvidence = require('../models/WorkOrderEvidence');

const OLD_NAME = 'Aleksandar Gagic';
const NEW_NAME = 'Aleksandar Gagić';
const ALEKS_RE = /^aleksandar\s+gagi[cć]$/i;
const MILAN_RE = /^milan\s+pe[sš]i[cć]$/i;
const APPLY = process.argv.includes('--apply');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected. Mode: ${APPLY ? 'APPLY (writes)' : 'DRY-RUN (no writes)'}\n`);

  // --- Locate the two technicians, with strict guards ---
  const all = await Technician.find({}).select('_id name paymentType monthlySalary');
  const aleksMatches = all.filter(t => ALEKS_RE.test(t.name || ''));
  const milanMatches = all.filter(t => MILAN_RE.test(t.name || ''));
  if (aleksMatches.length !== 1) throw new Error(`Expected exactly 1 Aleksandar Gagic/Gagić, found ${aleksMatches.length}: ${aleksMatches.map(t => t.name).join(', ')}`);
  if (milanMatches.length !== 1) throw new Error(`Expected exactly 1 Milan Pešić, found ${milanMatches.length}: ${milanMatches.map(t => t.name).join(', ')}`);
  const aleks = aleksMatches[0];
  const milan = milanMatches[0];

  console.log('Current state:');
  console.log(`  Aleksandar: [${aleks._id}] name=${JSON.stringify(aleks.name)} paymentType=${aleks.paymentType} monthlySalary=${aleks.monthlySalary}`);
  console.log(`  Milan     : [${milan._id}] name=${JSON.stringify(milan.name)} paymentType=${milan.paymentType} monthlySalary=${milan.monthlySalary}`);

  if (milan.paymentType !== 'po_statusu') throw new Error(`Milan Pešić is not po_statusu (${milan.paymentType}) — aborting, nothing to copy.`);

  // --- Milan's prices (source of truth to copy) ---
  const settings = await FinancialSettings.findOne();
  if (!settings) throw new Error('No FinancialSettings document found.');
  const milanEntry = (settings.technicianPrices || []).find(x => x.technicianId.toString() === milan._id.toString());
  if (!milanEntry) throw new Error('Milan Pešić has no technicianPrices entry — nothing to copy.');
  const milanPrices = JSON.parse(JSON.stringify(milanEntry.pricesByCustomerStatus || {}));
  const nonZero = Object.values(milanPrices).filter(v => v > 0).length;
  if (nonZero === 0) throw new Error("Milan's price list is all zeros — refusing to copy.");

  console.log(`\nPrices to copy from Milan Pešić (${nonZero} non-zero):`);
  Object.entries(milanPrices).forEach(([k, v]) => {
    console.log(`  ${String(v).padStart(6)}  ${k.length > 80 ? k.slice(0, 77) + '...' : k}`);
  });

  const aleksEntry = (settings.technicianPrices || []).find(x => x.technicianId.toString() === aleks._id.toString());
  if (aleksEntry) {
    console.log('\nAleksandar ALREADY has a technicianPrices entry — it will be OVERWRITTEN:');
    Object.entries(aleksEntry.pricesByCustomerStatus || {}).forEach(([k, v]) => {
      if (v !== milanPrices[k]) console.log(`  DIFF ${k.slice(0, 60)}...: ${v} -> ${milanPrices[k]}`);
    });
  } else {
    console.log('\nAleksandar has NO technicianPrices entry — a new one will be added.');
  }

  // --- Rename footprint ---
  const txCount = await FinancialTransaction.countDocuments({ 'technicians.technicianId': aleks._id, 'technicians.name': { $ne: NEW_NAME } });
  const evid1 = await WorkOrderEvidence.countDocuments({ technician1: OLD_NAME });
  const evid2 = await WorkOrderEvidence.countDocuments({ technician2: OLD_NAME });
  // near-miss variants the exact-match update would NOT catch
  const variant1 = await WorkOrderEvidence.find({ technician1: { $regex: /aleksandar\s+gagi/i, $nin: [OLD_NAME, NEW_NAME] } }).select('technician1').lean();
  const variant2 = await WorkOrderEvidence.find({ technician2: { $regex: /aleksandar\s+gagi/i, $nin: [OLD_NAME, NEW_NAME] } }).select('technician2').lean();

  console.log('\nPlanned changes:');
  console.log(`  1. Technician: name -> ${JSON.stringify(NEW_NAME)}, paymentType -> 'po_statusu', monthlySalary -> 0`);
  console.log(`  2. FinancialSettings: ${aleksEntry ? 'overwrite' : 'add'} technicianPrices entry (copy of Milan's, above)`);
  console.log(`  3. FinancialTransaction: update name in ${txCount} docs (matched by technicianId)`);
  console.log(`  4. WorkOrderEvidence: technician1 in ${evid1} docs, technician2 in ${evid2} docs (exact "${OLD_NAME}")`);
  if (variant1.length || variant2.length) {
    console.log(`  !!! Name variants NOT covered by exact match (will stay as-is):`);
    [...new Set([...variant1.map(v => v.technician1), ...variant2.map(v => v.technician2)])].forEach(n => console.log(`      ${JSON.stringify(n)}`));
  }
  console.log('\n  NAPOMENA: Aleksandar se na Android aplikaciju loguje IMENOM — posle izmene mora da kuca "Aleksandar Gagić" (sa ć).');

  if (!APPLY) {
    console.log('\nDRY-RUN ONLY — nothing written. Re-run with --apply to commit.');
    await mongoose.disconnect();
    return;
  }

  // --- APPLY ---
  const backup = {
    technician: aleks.toObject(),
    milanPricesEntry: milanEntry.toObject ? milanEntry.toObject() : milanEntry,
    aleksPricesEntry: aleksEntry ? (aleksEntry.toObject ? aleksEntry.toObject() : aleksEntry) : null,
    txIdsWithOldName: (await FinancialTransaction.find({ 'technicians.technicianId': aleks._id }).select('_id').lean()).map(d => d._id.toString()),
    evidenceT1Ids: (await WorkOrderEvidence.find({ technician1: OLD_NAME }).select('_id').lean()).map(d => d._id.toString()),
    evidenceT2Ids: (await WorkOrderEvidence.find({ technician2: OLD_NAME }).select('_id').lean()).map(d => d._id.toString()),
  };
  const backupFile = path.join(__dirname, `backup_aleksandar_migration_${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  console.log(`\nBackup written: ${backupFile}`);

  // 1. Technician doc
  aleks.name = NEW_NAME;
  aleks.paymentType = 'po_statusu';
  aleks.monthlySalary = 0;
  await aleks.save();

  // 2. FinancialSettings prices
  if (aleksEntry) {
    aleksEntry.pricesByCustomerStatus = milanPrices;
  } else {
    settings.technicianPrices.push({ technicianId: aleks._id, pricesByCustomerStatus: milanPrices });
  }
  settings.markModified('technicianPrices');
  await settings.save();

  // 3. FinancialTransaction denormalized names (by technicianId, not by string)
  const txRes = await FinancialTransaction.updateMany(
    { 'technicians.technicianId': aleks._id },
    { $set: { 'technicians.$[t].name': NEW_NAME } },
    { arrayFilters: [{ 't.technicianId': aleks._id }] }
  );

  // 4. WorkOrderEvidence names (exact string)
  const ev1Res = await WorkOrderEvidence.updateMany({ technician1: OLD_NAME }, { $set: { technician1: NEW_NAME } });
  const ev2Res = await WorkOrderEvidence.updateMany({ technician2: OLD_NAME }, { $set: { technician2: NEW_NAME } });

  console.log(`\nWrites done: tx matched=${txRes.matchedCount} modified=${txRes.modifiedCount}, evidence t1=${ev1Res.modifiedCount}, t2=${ev2Res.modifiedCount}`);

  // --- Verify by re-reading ---
  const after = await Technician.findById(aleks._id).lean();
  const settingsAfter = await FinancialSettings.findOne().lean();
  const entryAfter = (settingsAfter.technicianPrices || []).find(x => x.technicianId.toString() === aleks._id.toString());
  const pricesOk = entryAfter && Object.entries(milanPrices).every(([k, v]) => entryAfter.pricesByCustomerStatus[k] === v);
  const oldNameTx = await FinancialTransaction.countDocuments({ 'technicians.technicianId': aleks._id, 'technicians.name': OLD_NAME });
  const oldNameEv = await WorkOrderEvidence.countDocuments({ $or: [{ technician1: OLD_NAME }, { technician2: OLD_NAME }] });

  console.log('\n=== VERIFICATION (re-read) ===');
  console.log(`  Technician: name=${JSON.stringify(after.name)} paymentType=${after.paymentType} monthlySalary=${after.monthlySalary}`);
  console.log(`  Prices copied correctly: ${pricesOk ? 'YES' : 'NO !!!'}`);
  console.log(`  Docs still holding old name: tx=${oldNameTx}, evidence=${oldNameEv} (both should be 0)`);
  const ok = after.name === NEW_NAME && after.paymentType === 'po_statusu' && after.monthlySalary === 0 && pricesOk && oldNameTx === 0 && oldNameEv === 0;
  console.log(ok ? '\nALL OK — migration committed.' : '\n!!! VERIFICATION FAILED — inspect above.');

  await mongoose.disconnect();
}
run().then(() => process.exit(0)).catch(e => { console.error('Fatal:', e); process.exit(1); });
