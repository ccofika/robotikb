const mongoose = require('mongoose');
const Equipment = require('../models/Equipment');
require('../models/Technician');
const MONGODB_URI = "mongodb+srv://ccofika:maksimgej@cluster0.ozvllua.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

const testSerials = [
  'gkmpm1111c200500456', 'gkmpm1111c190601529', 'tsr202301003744',
  '00016530603819', 'saap31345099', '00160229229', 'tsr202404001152',
  '00160169882', 'ztegc2d2ab36', '48575443d8d47baa', '955101603367'
];

async function main() {
  await mongoose.connect(MONGODB_URI);

  for (const sn of testSerials) {
    const exact = await Equipment.findOne({ serialNumber: sn }).lean();
    const caseInsensitive = await Equipment.findOne({
      serialNumber: { $regex: new RegExp('^' + sn.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '$', 'i') }
    }).lean();
    const upper = await Equipment.findOne({ serialNumber: sn.toUpperCase() }).lean();

    let result = 'NOT FOUND anywhere';
    if (exact) result = 'exact match';
    else if (upper) result = 'FOUND as UPPERCASE: ' + upper.serialNumber;
    else if (caseInsensitive) result = 'FOUND case-insensitive: ' + caseInsensitive.serialNumber;

    console.log(sn + ' -> ' + result);
  }

  // Now do a bulk case-insensitive count
  // Get ALL equipment serial numbers from DB
  const allEquipment = await Equipment.find({}, { serialNumber: 1 }).lean();
  const dbSerialsLower = new Map();
  for (const eq of allEquipment) {
    dbSerialsLower.set(eq.serialNumber.toLowerCase(), eq.serialNumber);
  }
  console.log('\nTotal equipment in DB:', allEquipment.length);

  // Check all 549 not-found serials
  const allExcelSerials = require('./notFoundSerials.json');
  let foundWithCase = 0;
  let stillNotFound = 0;
  for (const sn of allExcelSerials) {
    const dbSn = dbSerialsLower.get(sn.toLowerCase());
    if (dbSn) {
      foundWithCase++;
      if (dbSn !== sn) {
        console.log('  Case mismatch: Excel=' + sn + ' DB=' + dbSn);
      }
    } else {
      stillNotFound++;
    }
  }

  console.log('\nOf 549 "not found": found with case-insensitive=' + foundWithCase + ', truly not found=' + stillNotFound);

  await mongoose.disconnect();
}

main().catch(err => { console.error(err); mongoose.disconnect(); process.exit(1); });
