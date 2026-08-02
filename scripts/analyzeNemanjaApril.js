/**
 * READ-ONLY: Did Nemanja Isak fill his monthly salary in April 2026 from his
 * OTHER work (excluding the 2 jobs shared with a Milan)?
 * Writes nothing.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const FinancialTransaction = require('../models/FinancialTransaction');
const Technician = require('../models/Technician');

const APR_START = new Date('2026-04-01T00:00:00.000+02:00');
const MAY_START = new Date('2026-05-01T00:00:00.000+02:00');
const MILAN = [/milan\s+ac/i, /milan\s+brdar/i];

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected\n');

  const nem = await Technician.findOne({ name: /nemanja\s+isak/i }).select('_id name paymentType monthlySalary').lean();
  if (!nem) throw new Error('Nemanja Isak not found');
  console.log(`Nemanja: ${nem.name}  id=${nem._id}  paymentType=${nem.paymentType}  monthlySalary=${nem.monthlySalary}\n`);

  const allTechs = await Technician.find({}).select('_id name').lean();
  const milanIds = new Set(allTechs.filter(t => MILAN.some(re => re.test(t.name || ''))).map(t => t._id.toString()));

  const txs = await FinancialTransaction.find({
    'technicians.technicianId': nem._id,
    verifiedAt: { $gte: APR_START, $lt: MAY_START }
  }).sort({ verifiedAt: 1 }).lean();

  console.log(`Nemanja's April 2026 transactions: ${txs.length}\n`);

  let totalAll = 0, totalExclDisputed = 0, disputedCredit = 0;
  let disputedCount = 0;
  for (const tx of txs) {
    const e = tx.technicians.find(t => t.technicianId.toString() === nem._id.toString());
    const credit = (e && e.salaryDetails && e.salaryDetails.earnedTowardsSalary) || 0;
    const isDisputed = tx.technicians.some(t => milanIds.has(t.technicianId.toString()));
    totalAll += credit;
    if (isDisputed) { disputedCredit += credit; disputedCount++; }
    else totalExclDisputed += credit;
    console.log(`  ${tx.verifiedAt.toISOString().slice(0,10)} final=${String(tx.finalPrice).padStart(6)} earnedTowardsSalary=${String(credit).padStart(6)} paymentType=${e?e.paymentType:'?'}${isDisputed?'  <-- shared with Milan (disputed)':''}`);
  }

  console.log('\n=== SALARY FILL (April 2026) ===');
  console.log(`  monthlySalary                         : ${nem.monthlySalary}`);
  console.log(`  total earnedTowardsSalary (ALL)       : ${totalAll}`);
  console.log(`  on 2 disputed (shared w/ Milan)       : ${disputedCredit}  (${disputedCount} tx)`);
  console.log(`  earnedTowardsSalary EXCLUDING disputed: ${totalExclDisputed}`);
  const reached = totalExclDisputed >= nem.monthlySalary;
  console.log(`\n  Filled salary from OTHER work alone?  : ${reached ? 'YES — remainder on the 2 jobs should go to PROFIT' : 'NO'}`);
  if (!reached) {
    console.log(`  Headroom to cap from other work       : ${nem.monthlySalary - totalExclDisputed} RSD`);
    console.log(`  (Nemanja can still absorb up to this much across the 2 disputed jobs; rest -> profit)`);
  }

  await mongoose.disconnect();
  console.log('\nDone (read-only).');
}
run().then(()=>process.exit(0)).catch(e=>{console.error('Fatal:',e);process.exit(1);});
