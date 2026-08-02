/**
 * Flip Milan Aca + Milan Brdar from 'plata' to 'po_statusu' on the Technician model.
 * Backs up current values to JSON first. Preview by default; pass --apply to write.
 *
 * Preview:  node scripts/changeMilanPaymentType.js
 * Apply:    node scripts/changeMilanPaymentType.js --apply
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Technician = require('../models/Technician');

const NAME_PATTERNS = [/milan\s+ac/i, /milan\s+brdar/i];
const APPLY = process.argv.includes('--apply');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected. Mode: ${APPLY ? 'APPLY (writes)' : 'PREVIEW (no writes)'}\n`);

  const all = await Technician.find({}).select('_id name paymentType monthlySalary');
  const matched = all.filter(t => NAME_PATTERNS.some(re => re.test(t.name || '')));

  if (matched.length !== 2) {
    console.log(`Expected 2 technicians, found ${matched.length}:`);
    matched.forEach(t => console.log(`  ${t.name}`));
    throw new Error('Aborting: did not match exactly 2 technicians.');
  }

  const backup = matched.map(t => ({
    _id: t._id.toString(), name: t.name,
    paymentType: t.paymentType || 'po_statusu', monthlySalary: t.monthlySalary || 0
  }));
  console.log('Current state:');
  backup.forEach(b => console.log(`  ${b.name}: paymentType=${b.paymentType}, monthlySalary=${b.monthlySalary}`));

  if (APPLY) {
    const backupFile = path.join(__dirname, `backup_milan_paymenttype_${Date.now()}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
    console.log(`\nBackup written: ${backupFile}`);

    for (const t of matched) {
      t.paymentType = 'po_statusu';
      t.monthlySalary = 0;
      await t.save();
    }
    console.log('\nAfter:');
    const after = await Technician.find({ _id: { $in: matched.map(t => t._id) } }).select('name paymentType monthlySalary');
    after.forEach(t => console.log(`  ${t.name}: paymentType=${t.paymentType}, monthlySalary=${t.monthlySalary}`));
    console.log('\nDone — changes committed.');
  } else {
    console.log('\nWould set BOTH to: paymentType=po_statusu, monthlySalary=0');
    console.log('PREVIEW ONLY — re-run with --apply to commit.');
  }

  await mongoose.disconnect();
}
run().then(() => process.exit(0)).catch(e => { console.error('Fatal:', e); process.exit(1); });
