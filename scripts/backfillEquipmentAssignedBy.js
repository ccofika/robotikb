/**
 * Backfill assignedAt / assignedBy / assignedByName for equipment CURRENTLY assigned to technicians.
 *
 * Sources, in order of preference:
 *   1. AdminActivityLog 'equipment_assign_to_tech' entries (NOTE: TTL = 90 days, older are gone)
 *      -> gives BOTH the date and the admin (Marko/Ana/SuperAdmin) who assigned it.
 *   2. Equipment.confirmationDate when confirmationStatus === 'confirmed'
 *      -> gives the DATE the technician confirmed receipt (assignedByName stays empty).
 *   3. Nothing available -> fields stay empty (export shows blank).
 *
 * Idempotent: only touches equipment where assignedAt is not already set.
 *
 * Preview:  node scripts/backfillEquipmentAssignedBy.js           (dry-run, no writes)
 * Apply:    node scripts/backfillEquipmentAssignedBy.js --apply   (backs up, then writes)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Equipment = require('../models/Equipment');
const Technician = require('../models/Technician');
const AdminActivityLog = require('../models/AdminActivityLog');

const APPLY = process.argv.includes('--apply');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected. Mode: ${APPLY ? 'APPLY (writes)' : 'DRY-RUN (no writes)'}\n`);

  // 1. Build serial+technician -> latest assign event map from AdminActivityLog
  const logs = await AdminActivityLog.find({ action: 'equipment_assign_to_tech' })
    .sort({ timestamp: 1 }) // ascending: later entries overwrite -> latest wins
    .select('timestamp userId userName entityId details.assignedItems')
    .lean();

  const assignMap = {}; // key: `${serialLower}|${techId}` -> {ts, userId, userName}
  let logItemsTotal = 0;
  logs.forEach(log => {
    const techId = log.entityId ? log.entityId.toString() : null;
    if (!techId) return; // legacy endpoint logs without entityId can't be matched safely
    const items = Array.isArray(log.details?.assignedItems) ? log.details.assignedItems : [];
    items.forEach(it => {
      const serial = (it?.serialNumber || '').toString().toLowerCase();
      if (!serial) return;
      assignMap[`${serial}|${techId}`] = { ts: log.timestamp, userId: log.userId, userName: log.userName };
      logItemsTotal++;
    });
  });
  console.log(`AdminActivityLog: ${logs.length} assign log docs (last ~90 days), ${logItemsTotal} item entries, ${Object.keys(assignMap).length} unique serial+tech pairs.\n`);

  // 2. All equipment currently assigned to a technician, without a stamp yet
  const equipment = await Equipment.find({
    assignedTo: { $ne: null },
    $or: [{ assignedAt: null }, { assignedAt: { $exists: false } }]
  }).lean();
  console.log(`Equipment assigned to technicians WITHOUT assignedAt stamp: ${equipment.length}\n`);

  const techNames = {};
  (await Technician.find({}).select('_id name').lean()).forEach(t => { techNames[t._id.toString()] = t.name; });

  let fromLog = 0, fromConfirmation = 0, empty = 0;
  const updates = [];
  const perTech = {};

  for (const eq of equipment) {
    const techId = eq.assignedTo.toString();
    const key = `${(eq.serialNumber || '').toLowerCase()}|${techId}`;
    const hit = assignMap[key];
    const techLabel = techNames[techId] || techId;
    perTech[techLabel] = perTech[techLabel] || { log: 0, confirmation: 0, empty: 0 };

    if (hit) {
      updates.push({ _id: eq._id, serial: eq.serialNumber, set: { assignedAt: hit.ts, assignedBy: hit.userId, assignedByName: hit.userName } });
      fromLog++;
      perTech[techLabel].log++;
    } else if (eq.confirmationStatus === 'confirmed' && eq.confirmationDate) {
      updates.push({ _id: eq._id, serial: eq.serialNumber, set: { assignedAt: eq.confirmationDate, assignedBy: null, assignedByName: '' } });
      fromConfirmation++;
      perTech[techLabel].confirmation++;
    } else {
      empty++;
      perTech[techLabel].empty++;
    }
  }

  console.log('=== PO TEHNIČARIMA (log = datum+ime, confirmation = samo datum, empty = ostaje prazno) ===');
  Object.entries(perTech).sort().forEach(([name, v]) =>
    console.log(`  ${name.padEnd(28)} log=${String(v.log).padStart(3)}  confirmation=${String(v.confirmation).padStart(3)}  empty=${String(v.empty).padStart(3)}`));

  console.log('\n=== SUMMARY ===');
  console.log(`  From AdminActivityLog (date + admin name): ${fromLog}`);
  console.log(`  From confirmationDate (date only)        : ${fromConfirmation}`);
  console.log(`  Left empty (no data available)           : ${empty}`);

  // Sample rows for eyeballing
  console.log('\n=== SAMPLE (first 15 updates) ===');
  updates.slice(0, 15).forEach(u => {
    const d = new Date(u.set.assignedAt).toISOString().slice(0, 10);
    console.log(`  ${u.serial.padEnd(20)} -> ${d}  ${u.set.assignedByName || '(bez imena)'}`);
  });

  if (!APPLY) {
    console.log('\nDRY-RUN ONLY — nothing written. Re-run with --apply to commit.');
    await mongoose.disconnect();
    return;
  }

  const backupFile = path.join(__dirname, `backup_equipment_backfill_${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify({ affectedIds: updates.map(u => u._id.toString()), count: updates.length }, null, 2));
  console.log(`\nBackup (affected ids) written: ${backupFile}`);

  let written = 0;
  for (const u of updates) {
    await Equipment.updateOne({ _id: u._id }, { $set: u.set });
    written++;
  }
  console.log(`Writes done: ${written}`);

  // Verify
  const stillMissing = await Equipment.countDocuments({
    assignedTo: { $ne: null },
    $or: [{ assignedAt: null }, { assignedAt: { $exists: false } }]
  });
  console.log(`\n=== VERIFICATION ===`);
  console.log(`Assigned equipment still without stamp: ${stillMissing} (expected ${empty})`);
  console.log(stillMissing === empty ? 'ALL OK — backfill committed.' : '!!! Unexpected count — inspect.');

  await mongoose.disconnect();
}
run().then(() => process.exit(0)).catch(e => { console.error('Fatal:', e); process.exit(1); });
