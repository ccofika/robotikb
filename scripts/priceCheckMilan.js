/**
 * READ-ONLY final price verification before applying the Milan pair recalc.
 * For every customerStatus that appears in the 122 transactions, show the short name,
 * the configured price for each Milan, the count, and whether it's OK (>0 and equal for both).
 */
require('dotenv').config();
const mongoose = require('mongoose');
const FinancialSettings = require('../models/FinancialSettings');
const FinancialTransaction = require('../models/FinancialTransaction');
const Technician = require('../models/Technician');

const NAME_PATTERNS = [/milan\s+ac/i, /milan\s+brdar/i];
const FROM_DATE = new Date('2026-04-01T00:00:00.000+02:00');

const BASE_STATUSES = [
  'Priključenje korisnika na HFC KDS mreža u zgradi sa instalacijom CPE opreme (izrada kompletne instalacije od RO do korisnika sa instalacijom kompletne CPE opreme)',
  'Priključenje korisnika na HFC KDS mreža u privatnim kućama sa instalacijom CPE opreme (izrada instalacije od PM-a do korisnika sa instalacijom kompletne CPE opreme)',
  'Priključenje korisnika na GPON mrežu u privatnim kućama (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)',
  'Priključenje korisnika na GPON mrežu u zgradi (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)',
  'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji sa montažnim radovima',
  'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji bez montažnih radova',
];
const SUFFIX = ' sa isporukom materijala';
const SHORT = {
  'Priključenje korisnika na HFC KDS mreža u zgradi sa instalacijom CPE opreme (izrada kompletne instalacije od RO do korisnika sa instalacijom kompletne CPE opreme)': 'HFC Zgrada',
  'Priključenje korisnika na HFC KDS mreža u privatnim kućama sa instalacijom CPE opreme (izrada instalacije od PM-a do korisnika sa instalacijom kompletne CPE opreme)': 'HFC Kuća',
  'Priključenje korisnika na GPON mrežu u privatnim kućama (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)': 'GPON Kuća',
  'Priključenje korisnika na GPON mrežu u zgradi (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)': 'GPON Zgrada',
  'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji sa montažnim radovima': 'Sa Montažom',
  'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji bez montažnih radova': 'Bez Montaže',
  'Nov korisnik': 'Nov Korisnik',
};

function resolvePrice(priceMap, status) {
  if (!priceMap) return undefined;
  if (priceMap[status] !== undefined && priceMap[status] !== null) return priceMap[status];
  if (BASE_STATUSES.includes(status) && priceMap[status + SUFFIX] !== undefined) return priceMap[status + SUFFIX];
  if (status.endsWith(SUFFIX) && priceMap[status.slice(0, -SUFFIX.length)] !== undefined) return priceMap[status.slice(0, -SUFFIX.length)];
  return undefined;
}
function shortName(status) {
  const base = status.endsWith(SUFFIX) ? status.slice(0, -SUFFIX.length) : status;
  return SHORT[base] || base.slice(0, 30);
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const allTechs = await Technician.find({}).select('_id name').lean();
  const matched = allTechs.filter(t => NAME_PATTERNS.some(re => re.test(t.name || '')));
  const settings = await FinancialSettings.findOne().lean();
  const priceLookup = {}, idToName = {};
  for (const t of matched) {
    idToName[t._id.toString()] = t.name;
    const tp = (settings.technicianPrices || []).find(x => x.technicianId.toString() === t._id.toString());
    priceLookup[t._id.toString()] = tp ? (tp.pricesByCustomerStatus || {}) : {};
  }
  const acaId = matched.find(t => /ac/i.test(t.name))._id.toString();
  const brdarId = matched.find(t => /brdar/i.test(t.name))._id.toString();

  const txs = await FinancialTransaction.find({
    'technicians.technicianId': { $in: matched.map(t => t._id) },
    verifiedAt: { $gte: FROM_DATE }
  }).lean();

  const byStatus = {};
  txs.forEach(tx => {
    if (!byStatus[tx.customerStatus]) byStatus[tx.customerStatus] = 0;
    byStatus[tx.customerStatus]++;
  });

  console.log('Status (variant) | short | Aca | Brdar | #tx | OK?');
  console.log('-'.repeat(70));
  let allOk = true, totalEntries = 0;
  Object.entries(byStatus).sort((a,b)=>b[1]-a[1]).forEach(([status, count]) => {
    const variant = status.endsWith(SUFFIX) ? 'NEW' : (BASE_STATUSES.includes(status) ? 'OLD' : 'OTHER');
    const pa = resolvePrice(priceLookup[acaId], status);
    const pb = resolvePrice(priceLookup[brdarId], status);
    const ok = (pa > 0) && (pb > 0) && (pa === pb);
    if (!ok) allOk = false;
    console.log(`[${variant}] ${shortName(status).padEnd(12)} | Aca=${String(pa).padStart(5)} | Brdar=${String(pb).padStart(5)} | ${String(count).padStart(3)} | ${ok ? 'OK' : '!!! CHECK'}`);
  });

  // count how many tx involve each Milan (entries), to confirm coverage
  txs.forEach(tx => tx.technicians.forEach(e => {
    if (e.technicianId.toString() === acaId || e.technicianId.toString() === brdarId) totalEntries++;
  }));

  console.log('-'.repeat(70));
  console.log(`Distinct statuses: ${Object.keys(byStatus).length} | total tx: ${txs.length} | total Milan entries to reprice: ${totalEntries}`);
  console.log(`Prices match screenshot? HFC Zgrada=1100, HFC Kuća=2000, GPON Kuća=2000, GPON Zgrada=1500, Sa/Bez Montaže=350`);
  console.log(allOk ? '\n✅ ALL prices > 0 and identical for both Milans.' : '\n❌ Some statuses need attention (see !!! CHECK).');

  await mongoose.disconnect();
}
run().then(()=>process.exit(0)).catch(e=>{console.error('Fatal:',e);process.exit(1);});
