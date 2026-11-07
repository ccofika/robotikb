/**
 * Jednokratna ispravka appointmentDateTime (i postponedUntil odloženih naloga) na postojećim nalozima.
 *
 * Do 11/2026 se appointmentDateTime upisivao setHours-om na UTC serveru, pa je bio 1h (zimi)
 * ili 2h (leti) posle pravog termina, a termini u 00:xx su upisani kao 09:xx. Sada se računa
 * iz date + time po srpskom vremenu (getAppointmentInstant) i ova skripta to radi za stare naloge.
 * - reminderSentForAppointment / uncontactedAlertSentForAppointment pamte appointmentDateTime za
 *   koji je podsetnik/alert poslat; prate novu vrednost da podsetnik ne bi otišao ponovo.
 * - postponedUntil odloženog naloga (isti bug) se ispravlja samo kad je tačno 1h ili 2h posle termina.
 * Upis je zaštićen: nalog se menja samo ako mu je appointmentDateTime i dalje stara vrednost.
 * Idempotentno: posle upisa ponovno pokretanje nema šta da menja.
 *
 * Provera:  node scripts/fixAppointmentTimes.js
 * Upis:     node scripts/fixAppointmentTimes.js --apply
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { getAppointmentInstant } = require('../services/workOrderScheduler');

const APPLY = process.argv.includes('--apply');
const HOUR_MS = 60 * 60 * 1000;
const sameInstant = (a, b) => Boolean(a && b) && new Date(a).getTime() === new Date(b).getTime();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const collection = mongoose.connection.db.collection('workorders');
  console.log(`Baza: ${mongoose.connection.db.databaseName} | ${APPLY ? 'UPIS' : 'PROVERA (bez upisa)'}`);

  const workOrders = await collection.find({}, {
    projection: {
      date: 1, time: 1, status: 1, appointmentDateTime: 1, postponedUntil: 1,
      reminderSentForAppointment: 1, uncontactedAlertSentForAppointment: 1
    }
  }).toArray();

  const ops = [];
  const stats = { appointment: 0, reminder: 0, alert: 0, postponed: 0 };
  const shiftMinutes = {};

  for (const wo of workOrders) {
    const instant = getAppointmentInstant(wo);
    if (!instant) continue;
    const set = {};
    const old = wo.appointmentDateTime;

    if (!sameInstant(old, instant)) {
      set.appointmentDateTime = instant;
      stats.appointment++;
      const shift = old ? Math.round((new Date(old) - instant) / 60000) : 'bez vrednosti';
      shiftMinutes[shift] = (shiftMinutes[shift] || 0) + 1;
      if (sameInstant(wo.reminderSentForAppointment, old)) {
        set.reminderSentForAppointment = instant;
        stats.reminder++;
      }
      if (sameInstant(wo.uncontactedAlertSentForAppointment, old)) {
        set.uncontactedAlertSentForAppointment = instant;
        stats.alert++;
      }
    }

    if (wo.status === 'odlozen' && wo.postponedUntil) {
      const diff = new Date(wo.postponedUntil) - instant;
      if (diff === HOUR_MS || diff === 2 * HOUR_MS) {
        set.postponedUntil = instant;
        stats.postponed++;
      }
    }

    if (Object.keys(set).length > 0) {
      ops.push({
        updateOne: {
          filter: { _id: wo._id, appointmentDateTime: old ?? null },
          update: { $set: set }
        }
      });
    }
  }

  console.log(`Naloga: ${workOrders.length} | za ispravku: ${ops.length}`);
  console.log(`  appointmentDateTime: ${stats.appointment} (pomak u minutima -> broj: ${JSON.stringify(shiftMinutes)})`);
  console.log(`  podsetnik/alert prate novu vrednost: ${stats.reminder} / ${stats.alert}`);
  console.log(`  postponedUntil odloženih: ${stats.postponed}`);

  if (APPLY && ops.length > 0) {
    const result = await collection.bulkWrite(ops, { ordered: false });
    console.log(`  ispravljeno: ${result.modifiedCount}`);
  }
}

run()
  .catch(err => {
    console.error('Greška:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
    // Scheduler povlači servise sa tajmerima (mejl), pa proces ne bi sam izašao
    process.exit();
  });
