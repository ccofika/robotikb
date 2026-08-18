/**
 * Backfill provere adresa za naloge IMPORTOVANE u poslednja 3 dana:
 * za svaki proveri da li postoji ranije OTKAZAN nalog na istoj adresi,
 * upiše flag polja i (kod --apply) pošalje notifikacije adminima
 * (pojedinačne ako je flagovanih <= 10, inače jednu zbirnu).
 *
 * Pokretanje:  node scripts/backfillDuplicateAddress.js          (dry-run)
 *              node scripts/backfillDuplicateAddress.js --apply
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const WorkOrder = require('../models/WorkOrder');
const Technician = require('../models/Technician');
const Notification = require('../models/Notification');
const { addressPattern } = require('../services/duplicateAddressChecker');

const APPLY = process.argv.includes('--apply');
const DAYS = 3;
const PER_ORDER_NOTIFICATION_LIMIT = 10;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(APPLY ? '=== APPLY ===' : '=== DRY-RUN (bez upisa) ===');

  const since = new Date(Date.now() - DAYS * 24 * 3600 * 1000);
  const orders = await WorkOrder.find({ createdAt: { $gte: since } })
    .select('address tisId tisJobId userName date time status duplicateAddressCheckedAt createdAt')
    .lean();
  console.log(`Naloga importovano u poslednja ${DAYS} dana: ${orders.length}`);

  const flagged = [];
  let checked = 0, skipped = 0;
  for (const order of orders) {
    if (order.duplicateAddressCheckedAt) { skipped++; continue; }
    const pattern = addressPattern(order.address);
    let canceledCount = 0;
    if (pattern) {
      canceledCount = await WorkOrder.countDocuments({
        _id: { $ne: order._id },
        status: 'otkazan',
        address: pattern
      });
    }
    checked++;
    if (canceledCount > 0) {
      flagged.push({ ...order, canceledCount });
    }
    if (APPLY) {
      await WorkOrder.updateOne(
        { _id: order._id },
        { $set: {
          duplicateAddressFlagged: canceledCount > 0,
          duplicateAddressCanceledCount: canceledCount,
          duplicateAddressCheckedAt: new Date()
        } }
      );
    }
    await sleep(60);
  }

  console.log(`Provereno: ${checked} | preskočeno (već provereno): ${skipped}`);
  console.log(`FLAGOVANO (adresa ranije otkazanog naloga): ${flagged.length}`);
  flagged.forEach(f => console.log(
    `  TIS: ${(f.tisId || '-').padEnd(10)} | ${(f.userName || '').slice(0, 25).padEnd(25)} | ${f.date ? f.date.toISOString().slice(0, 10) : ''} ${f.time || ''} | otkazanih na adresi: ${f.canceledCount} | ${(f.address || '').slice(0, 50)}`
  ));

  if (!APPLY) {
    console.log('\nDry-run gotov. Pokreni sa --apply za upis flagova i notifikacije.');
  } else if (flagged.length > 0) {
    const admins = await Technician.find({ isAdmin: true }).select('_id');
    if (flagged.length > PER_ORDER_NOTIFICATION_LIMIT) {
      for (const admin of admins) {
        await Notification.createDuplicateAddressSummary(flagged.length, admin._id).catch(e => console.error(e.message));
        await sleep(100);
      }
      console.log(`\nPoslata ZBIRNA notifikacija (${flagged.length} flagovanih) za ${admins.length} admina.`);
    } else {
      for (const f of flagged) {
        for (const admin of admins) {
          await Notification.createDuplicateAddress(f._id, f.tisId || '', f.address || '', f.canceledCount, admin._id).catch(e => console.error(e.message));
          await sleep(100);
        }
      }
      console.log(`\nPoslate pojedinačne notifikacije (${flagged.length} naloga × ${admins.length} admina).`);
    }
  }
  await mongoose.disconnect();
})().catch(e => { console.error('GRESKA:', e); process.exit(1); });
