require('dotenv').config();
const mongoose = require('mongoose');
const FailedFinancialTransaction = require('../models/FailedFinancialTransaction');
const FinancialTransaction = require('../models/FinancialTransaction');
const { createFinancialTransaction } = require('../routes/workorders');

async function retryAllFailedTransactions() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI not set in environment');
  }

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');
  }

  const failed = await FailedFinancialTransaction.find({
    resolved: false,
    excludedFromFinances: { $ne: true }
  }).lean();

  console.log(`Found ${failed.length} unresolved failed transactions to retry\n`);

  let success = 0;
  let stillFailing = 0;
  const stillFailingDetails = [];

  for (let i = 0; i < failed.length; i++) {
    const ft = failed[i];
    const workOrderId = ft.workOrderId;
    const label = `[${i + 1}/${failed.length}] WO ${workOrderId}`;

    try {
      // Clear existing records so createFinancialTransaction can run fresh
      await FinancialTransaction.deleteOne({ workOrderId });
      await FailedFinancialTransaction.deleteMany({ workOrderId });

      await createFinancialTransaction(workOrderId);

      const created = await FinancialTransaction.findOne({ workOrderId });
      if (created) {
        success++;
        console.log(`${label} ✅ recalculated`);
      } else {
        const newFail = await FailedFinancialTransaction.findOne({ workOrderId });
        stillFailing++;
        const reason = newFail?.failureMessage || 'unknown';
        console.log(`${label} ❌ still failing: ${reason}`);
        stillFailingDetails.push({ workOrderId, reason });
      }
    } catch (err) {
      stillFailing++;
      console.log(`${label} ❌ error: ${err.message}`);
      stillFailingDetails.push({ workOrderId, reason: err.message });
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Successfully recalculated: ${success}`);
  console.log(`Still failing: ${stillFailing}`);

  if (stillFailingDetails.length > 0) {
    console.log('\nReasons for still-failing transactions:');
    const reasonCounts = {};
    stillFailingDetails.forEach(d => {
      reasonCounts[d.reason] = (reasonCounts[d.reason] || 0) + 1;
    });
    Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([reason, count]) => console.log(`  ${count}× ${reason}`));
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

retryAllFailedTransactions()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
