/**
 * READ-ONLY per-transaction dump of Aleksandar Gagic's FinancialTransactions since 2026-06-01.
 * Run: node scripts/dumpAleksandarTxs.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Technician = require('../models/Technician');
const FinancialTransaction = require('../models/FinancialTransaction');

const FROM_DATE = new Date('2026-06-01T00:00:00.000+02:00');

const SHORT = {
  'Priključenje korisnika na HFC KDS mreža u zgradi sa instalacijom CPE opreme (izrada kompletne instalacije od RO do korisnika sa instalacijom kompletne CPE opreme)': 'HFC-zgrada',
  'Priključenje korisnika na HFC KDS mreža u privatnim kućama sa instalacijom CPE opreme (izrada instalacije od PM-a do korisnika sa instalacijom kompletne CPE opreme)': 'HFC-kuća',
  'Priključenje korisnika na GPON mrežu u privatnim kućama (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)': 'GPON-kuća',
  'Priključenje korisnika na GPON mrežu u zgradi (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)': 'GPON-zgrada',
  'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji sa montažnim radovima': 'Radovi-sa-mont',
  'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji bez montažnih radova': 'Radovi-bez-mont',
};
const shortStatus = s => {
  if (SHORT[s]) return SHORT[s];
  const base = s.replace(/ sa isporukom materijala$/, '');
  if (SHORT[base]) return SHORT[base] + '+mat';
  return s.slice(0, 40);
};

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const aleks = await Technician.findOne({ name: /gagi/i }).lean();
  console.log(`Technician: ${aleks.name} [${aleks._id}]\n`);

  const txs = await FinancialTransaction.find({
    'technicians.technicianId': aleks._id,
    verifiedAt: { $gte: FROM_DATE }
  }).sort({ verifiedAt: 1 }).lean();

  let badShape = 0;
  txs.forEach((tx, i) => {
    if (tx.technicians.length !== 2) badShape++;
    const parts = tx.technicians.map(e => {
      let s = `${e.name}=${e.earnings}(${e.paymentType}`;
      if (e.paymentType === 'plata' && e.salaryDetails) {
        s += ` sal=${e.salaryDetails.monthlySalary} prev=${e.salaryDetails.previouslyEarned} twd=${e.salaryDetails.earnedTowardsSalary} exc=${e.salaryDetails.excessAmount}`;
      }
      return s + ')';
    });
    console.log(
      `${String(i + 1).padStart(2)}. ${tx.verifiedAt.toISOString().slice(0, 10)} ` +
      `${shortStatus(tx.customerStatus).padEnd(18)} final=${String(tx.finalPrice).padStart(6)} ` +
      `techSum=${String(tx.totalTechnicianEarnings).padStart(6)} profit=${String(tx.companyProfit).padStart(7)} | ${parts.join(' + ')}`
    );
  });
  console.log(`\nTx not shaped as exactly 2 technicians: ${badShape}`);
  await mongoose.disconnect();
}
run().then(() => process.exit(0)).catch(e => { console.error('Fatal:', e); process.exit(1); });
