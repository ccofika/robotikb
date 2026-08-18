/**
 * Backfill ContactEvent kolekcije iz postojećih podataka:
 *  - WorkOrder.customerCallAttemptedAt (+customerCallSource) → customer_call
 *  - WorkOrder.reminderSentAt                                → reminder_sent
 *  - Notification(type=customer_not_contacted)               → uncontacted_alert
 *    (po jedan događaj po nalogu+minutu — u bazi postoji kopija po adminu;
 *     createdAt u Notification modelu je pomeren +2h, pa se ovde vraća na UTC)
 *
 * Idempotentno: prvo briše SVE postojeće backfilled:true zapise pa ih ponovo pravi.
 * Zapisi koje su kuke upisale uživo (backfilled:false) se NE diraju, a za njihove
 * naloge se backfill preskače (da ne bude duplikata za isti tip).
 *
 * Pokretanje:  node scripts/backfillContactEvents.js          (dry-run)
 *              node scripts/backfillContactEvents.js --apply  (upis)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const WorkOrder = require('../models/WorkOrder');
const Technician = require('../models/Technician');
const Notification = require('../models/Notification');
const ContactEvent = require('../models/ContactEvent');

const APPLY = process.argv.includes('--apply');
// createdAt u Notification modelu se upisuje pomeren +2h (bug u default-u modela)
const NOTIF_TZ_SKEW_MS = 2 * 60 * 60 * 1000;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(APPLY ? '=== APPLY ===' : '=== DRY-RUN (bez upisa) ===');

  // Nalozi za koje već postoje ŽIVI zapisi (upisale kuke) — po tipu
  const live = await ContactEvent.aggregate([
    { $match: { backfilled: { $ne: true } } },
    { $group: { _id: { workOrderId: '$workOrderId', eventType: '$eventType' } } }
  ]);
  const liveKeys = new Set(live.map(x => `${x._id.workOrderId}:${x._id.eventType}`));
  console.log('Naloga sa živim (ne-backfill) zapisima po tipu:', liveKeys.size);

  const toCreate = [];

  // 1) customer_call iz WorkOrder polja
  const withCalls = await WorkOrder.find({ customerCallAttemptedAt: { $ne: null } })
    .select('customerCallAttemptedAt customerCallSource technicianId technician2Id')
    .populate('technicianId', 'name')
    .populate('technician2Id', 'name')
    .lean();
  let skippedLiveCalls = 0;
  for (const wo of withCalls) {
    if (liveKeys.has(`${wo._id}:customer_call`)) { skippedLiveCalls++; continue; }
    // Ko je kliknuo se za istorijske ne zna pouzdano — ime samo ako je tehničar jedan
    const singleTech = wo.technicianId && !wo.technician2Id ? wo.technicianId : null;
    toCreate.push({
      workOrderId: wo._id,
      eventType: 'customer_call',
      at: wo.customerCallAttemptedAt,
      technicianId: singleTech ? singleTech._id : undefined,
      technicianName: singleTech ? (singleTech.name || '') : '',
      source: wo.customerCallSource || '',
      backfilled: true
    });
  }
  console.log(`customer_call: ${withCalls.length} naloga sa klikom, backfill ${withCalls.length - skippedLiveCalls} (preskočeno ${skippedLiveCalls} sa živim zapisom)`);

  // 2) reminder_sent iz WorkOrder polja
  const withReminders = await WorkOrder.find({ reminderSentAt: { $ne: null } })
    .select('reminderSentAt technicianId technician2Id')
    .populate('technicianId', 'name')
    .populate('technician2Id', 'name')
    .lean();
  let skippedLiveRem = 0;
  for (const wo of withReminders) {
    if (liveKeys.has(`${wo._id}:reminder_sent`)) { skippedLiveRem++; continue; }
    const names = [wo.technicianId?.name, wo.technician2Id?.name].filter(Boolean).join(' i ');
    toCreate.push({
      workOrderId: wo._id,
      eventType: 'reminder_sent',
      at: wo.reminderSentAt,
      technicianName: names,
      backfilled: true
    });
  }
  console.log(`reminder_sent: ${withReminders.length} naloga sa podsetnikom, backfill ${withReminders.length - skippedLiveRem} (preskočeno ${skippedLiveRem})`);

  // 3) uncontacted_alert iz Notification kolekcije (dedup: nalog + minut)
  const alerts = await Notification.find({ type: 'customer_not_contacted', workOrderId: { $ne: null } })
    .select('workOrderId createdAt technicianName')
    .lean();
  const seenAlert = new Set();
  let alertEvents = 0, skippedLiveAlerts = 0;
  for (const n of alerts) {
    const realAt = new Date(n.createdAt.getTime() - NOTIF_TZ_SKEW_MS);
    const key = `${n.workOrderId}:${Math.floor(realAt.getTime() / 60000)}`;
    if (seenAlert.has(key)) continue;
    seenAlert.add(key);
    if (liveKeys.has(`${n.workOrderId}:uncontacted_alert`)) { skippedLiveAlerts++; continue; }
    toCreate.push({
      workOrderId: n.workOrderId,
      eventType: 'uncontacted_alert',
      at: realAt,
      technicianName: n.technicianName || '',
      backfilled: true
    });
    alertEvents++;
  }
  console.log(`uncontacted_alert: ${alerts.length} notifikacija → ${alertEvents} događaja posle dedup-a (preskočeno ${skippedLiveAlerts})`);

  console.log(`\nUKUPNO za upis: ${toCreate.length} događaja`);
  console.log('Primeri (prvih 5):');
  toCreate.slice(0, 5).forEach(e => console.log(' ', e.eventType, e.at.toISOString(), e.technicianName || '-', e.source || ''));

  if (!APPLY) {
    console.log('\nDry-run gotov. Pokreni sa --apply za upis.');
  } else {
    const del = await ContactEvent.deleteMany({ backfilled: true });
    console.log(`\nObrisano starih backfill zapisa: ${del.deletedCount}`);
    if (toCreate.length > 0) {
      const ins = await ContactEvent.insertMany(toCreate, { ordered: false });
      console.log(`Upisano: ${ins.length}`);
    }
    const total = await ContactEvent.countDocuments({});
    console.log(`ContactEvent ukupno u bazi: ${total}`);
  }
  await mongoose.disconnect();
})().catch(e => { console.error('GRESKA:', e); process.exit(1); });
