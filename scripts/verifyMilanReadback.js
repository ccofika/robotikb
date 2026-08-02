/** READ-ONLY: read back a few transactions to confirm persisted structure. */
require('dotenv').config();
const mongoose = require('mongoose');
const FinancialTransaction = require('../models/FinancialTransaction');
const Technician = require('../models/Technician');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const techs = await Technician.find({ name: { $in: [/milan\s+ac/i, /milan\s+brdar/i, /nemanja\s+isak/i] } })
    .select('name paymentType monthlySalary').lean();
  console.log('Technician flags now:');
  techs.forEach(t => console.log(`  ${t.name}: ${t.paymentType}, salary=${t.monthlySalary}`));

  const milanIds = (await Technician.find({ name: { $in: [/milan\s+ac/i, /milan\s+brdar/i] } }).select('_id').lean()).map(t => t._id);

  // one both-Milans tx
  const both = await FinancialTransaction.findOne({
    verifiedAt: { $gte: new Date('2026-04-01T00:00:00+02:00') },
    'technicians.technicianId': { $all: milanIds }
  }).lean();

  // the 2 Nemanja-shared tx (final 3300 / 9925)
  const nem = await FinancialTransaction.find({ finalPrice: { $in: [3300, 9925] },
    verifiedAt: { $gte: new Date('2026-04-03T00:00:00+02:00'), $lt: new Date('2026-04-04T00:00:00+02:00') } }).lean();

  const dump = (label, tx) => {
    if (!tx) { console.log(`\n${label}: (not found)`); return; }
    console.log(`\n${label}  date=${tx.verifiedAt.toISOString().slice(0,10)} final=${tx.finalPrice} totalTechEarnings=${tx.totalTechnicianEarnings} profit=${tx.companyProfit}`);
    tx.technicians.forEach(e => console.log(`   - ${e.name}: ${e.paymentType}, earnings=${e.earnings}, salaryDetails=${e.salaryDetails ? JSON.stringify(e.salaryDetails) : 'none'}`));
  };

  dump('BOTH MILANS', both);
  nem.forEach((tx, i) => dump(`NEMANJA-SHARED #${i+1}`, tx));

  await mongoose.disconnect();
}
run().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
