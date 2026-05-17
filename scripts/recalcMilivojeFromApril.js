require('dotenv').config();
const mongoose = require('mongoose');
const FinancialSettings = require('../models/FinancialSettings');
const FinancialTransaction = require('../models/FinancialTransaction');
const Technician = require('../models/Technician');

const TECHNICIAN_NAME = 'Milivoje Leković';
const FROM_DATE = new Date('2026-04-01T00:00:00.000Z');
const APPLY = process.argv.includes('--apply');

async function run() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGODB_URI not set');

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');
  console.log(`Mode: ${APPLY ? 'APPLY (will write changes)' : 'DRY-RUN (no changes)'}`);
  console.log(`Technician: ${TECHNICIAN_NAME}`);
  console.log(`Period: from ${FROM_DATE.toISOString()} to now\n`);

  const tech = await Technician.findOne({ name: TECHNICIAN_NAME });
  if (!tech) throw new Error(`Technician "${TECHNICIAN_NAME}" not found`);
  console.log(`Found technician: ${tech.name} (${tech._id})  paymentType=${tech.paymentType || 'po_statusu'}`);

  const settings = await FinancialSettings.findOne();
  if (!settings) throw new Error('FinancialSettings not found');

  const techPricing = settings.technicianPrices.find(
    tp => tp.technicianId.toString() === tech._id.toString()
  );
  if (!techPricing) throw new Error(`No technicianPrices entry for ${tech.name}`);

  const newPrices = techPricing.pricesByCustomerStatus;
  console.log('\nNew prices for Milivoje (current settings in DB):');
  Object.entries(newPrices.toObject ? newPrices.toObject() : newPrices).forEach(([k, v]) => {
    if (v && v > 0) console.log(`  ${v} RSD — ${k.substring(0, 80)}${k.length > 80 ? '…' : ''}`);
  });

  const transactions = await FinancialTransaction.find({
    'technicians.technicianId': tech._id,
    verifiedAt: { $gte: FROM_DATE }
  }).sort({ verifiedAt: 1 });

  console.log(`\nFound ${transactions.length} transactions involving ${tech.name} since April 1\n`);

  let changed = 0;
  let unchanged = 0;
  let skippedNonStatus = 0;
  let missingPrice = 0;
  let totalOldEarnings = 0;
  let totalNewEarnings = 0;
  const missingDetails = [];

  for (const tx of transactions) {
    const entry = tx.technicians.find(t => t.technicianId.toString() === tech._id.toString());
    if (!entry) continue;

    if (entry.paymentType !== 'po_statusu') {
      skippedNonStatus++;
      continue;
    }

    const newPrice = newPrices[tx.customerStatus];
    if (!newPrice || newPrice === 0) {
      missingPrice++;
      missingDetails.push({ tx: tx._id.toString(), customerStatus: tx.customerStatus });
      continue;
    }

    const oldEarnings = entry.earnings;
    if (oldEarnings === newPrice) {
      unchanged++;
      continue;
    }

    totalOldEarnings += oldEarnings;
    totalNewEarnings += newPrice;

    const oldTotalTechEarnings = tx.totalTechnicianEarnings;
    const newTotalTechEarnings = oldTotalTechEarnings - oldEarnings + newPrice;
    const newCompanyProfit = tx.finalPrice - newTotalTechEarnings;

    console.log(
      `WO ${tx.workOrderId}  ${tx.verifiedAt.toISOString().slice(0, 10)}  ` +
      `${tx.customerStatus.substring(0, 50)}…  ` +
      `${oldEarnings} → ${newPrice} RSD  ` +
      `(profit ${tx.companyProfit} → ${newCompanyProfit})`
    );

    if (APPLY) {
      entry.earnings = newPrice;
      tx.totalTechnicianEarnings = newTotalTechEarnings;
      tx.companyProfit = newCompanyProfit;
      await tx.save();
    }

    changed++;
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Total transactions involving ${tech.name}: ${transactions.length}`);
  console.log(`Would change: ${changed}`);
  console.log(`Unchanged (already correct): ${unchanged}`);
  console.log(`Skipped (paymentType != po_statusu): ${skippedNonStatus}`);
  console.log(`Skipped (no price for customerStatus in new settings): ${missingPrice}`);
  if (missingPrice > 0) {
    console.log('Missing-price details:');
    missingDetails.forEach(m => console.log(`  tx ${m.tx} — ${m.customerStatus}`));
  }
  console.log(`\nMilivoje total earnings change: ${totalOldEarnings} → ${totalNewEarnings} RSD (delta ${totalNewEarnings - totalOldEarnings})`);

  if (!APPLY) {
    console.log('\nDRY-RUN ONLY — no changes written. Re-run with --apply to commit.');
  } else {
    console.log('\nChanges committed.');
  }

  await mongoose.disconnect();
}

run()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
