/**
 * Jednokratna ispravka vremena postojećih notifikacija (web i Android).
 *
 * Do 11/2026 su Notification i AndroidNotification upisivali createdAt kao "sada + 2h".
 * Zimi je web panel zato kasnio 1h, a "upravo sada" je stajalo 2h posle nastanka.
 * Nove notifikacije se upisuju u pravom vremenu, a ova skripta vraća stare 2h nazad.
 *
 * Pomerena notifikacija se prepoznaje po tome što je createdAt ~2h posle vremena iz
 * njenog _id (ObjectId nosi pravo vreme nastanka). Zato je skripta idempotentna:
 * ispravljena ili nova notifikacija se više ne poklapa i ne dira se.
 *
 * Provera:  node scripts/fixNotificationTimes.js           (bez upisa)
 * Upis:     node scripts/fixNotificationTimes.js --apply
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const SHIFT_MS = 2 * 60 * 60 * 1000;
const TOLERANCE_MS = 60 * 1000;

const ageOffset = { $subtract: ['$createdAt', { $toDate: '$_id' }] };
const shiftedFilter = {
  $expr: {
    $and: [
      { $gte: [ageOffset, SHIFT_MS - TOLERANCE_MS] },
      { $lte: [ageOffset, SHIFT_MS + TOLERANCE_MS] }
    ]
  }
};

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Baza: ${mongoose.connection.db.databaseName} | ${APPLY ? 'UPIS' : 'PROVERA (bez upisa)'}`);

  for (const name of ['notifications', 'androidnotifications']) {
    const collection = mongoose.connection.db.collection(name);
    const total = await collection.countDocuments();
    const shifted = await collection.countDocuments(shiftedFilter);
    console.log(`${name}: ${shifted} od ${total} ima vreme pomereno +2h`);

    if (APPLY && shifted > 0) {
      const result = await collection.updateMany(shiftedFilter, [
        { $set: { createdAt: { $subtract: ['$createdAt', SHIFT_MS] } } }
      ]);
      console.log(`  ispravljeno: ${result.modifiedCount}`);
    }
  }
}

run()
  .catch(err => {
    console.error('Greška:', err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
