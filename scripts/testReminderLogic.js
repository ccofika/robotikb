/**
 * READ-ONLY test za logiku podsetnika 30 min pre radnog naloga.
 * 1. Unit-testira getAppointmentInstant (letnje/zimsko računanje vremena)
 * 2. Simulira query + odluku slanja na PRODUKCIJSKOJ bazi bez ikakvog pisanja/slanja
 *
 * Run: node scripts/testReminderLogic.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { WorkOrder } = require('../models');
const { getAppointmentInstant } = require('../services/workOrderScheduler');

let failures = 0;
function expectEqual(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${actual} ${ok ? '==' : '!='} ${expected}`);
}

// --- 1. Unit testovi vremena (nezavisno od zone servera) ---
console.log('=== UNIT: getAppointmentInstant ===');
// Leto (CEST, UTC+2): 2026-08-02 18:00 Beograd = 16:00 UTC
expectEqual('leto 18:00',
  getAppointmentInstant({ date: new Date('2026-08-02T00:00:00.000Z'), time: '18:00' }).toISOString(),
  '2026-08-02T16:00:00.000Z');
// Zima (CET, UTC+1): 2026-01-15 09:00 Beograd = 08:00 UTC
expectEqual('zima 09:00',
  getAppointmentInstant({ date: new Date('2026-01-15T00:00:00.000Z'), time: '09:00' }).toISOString(),
  '2026-01-15T08:00:00.000Z');
// Bez time -> 09:00
expectEqual('default 09:00 (leto)',
  getAppointmentInstant({ date: new Date('2026-07-01T00:00:00.000Z'), time: null }).toISOString(),
  '2026-07-01T07:00:00.000Z');
// Nevalidan time -> 09:00
expectEqual('nevalidan time',
  getAppointmentInstant({ date: new Date('2026-07-01T00:00:00.000Z'), time: 'abc' }).toISOString(),
  '2026-07-01T07:00:00.000Z');
// Ponoć
expectEqual('00:30 (leto)',
  getAppointmentInstant({ date: new Date('2026-08-03T00:00:00.000Z'), time: '00:30' }).toISOString(),
  '2026-08-02T22:30:00.000Z');
// Nema date
expectEqual('bez date', getAppointmentInstant({ date: null, time: '09:00' }), null);

// --- 2. Simulacija na produkcijskoj bazi (READ-ONLY) ---
async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('\n=== SIMULACIJA (prod baza, bez pisanja/slanja) ===');
  const now = new Date();
  console.log(`Sada (UTC): ${now.toISOString()} | Beograd: ${now.toLocaleString('sr-RS', { timeZone: 'Europe/Belgrade' })}`);

  const windowStart = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + (3 * 60 + 30) * 60 * 1000);

  const candidates = await WorkOrder.find({
    status: 'nezavrsen',
    appointmentDateTime: { $gte: windowStart, $lte: windowEnd }
  }).select('_id date time address userName userPhone technicianId technician2Id appointmentDateTime reminderSentForAppointment').lean();

  console.log(`Kandidata u grubom prozoru (±3h): ${candidates.length}`);
  let bislo = 0;
  candidates.forEach(wo => {
    const instant = getAppointmentInstant(wo);
    const msUntil = instant ? instant.getTime() - now.getTime() : null;
    const wouldSend = msUntil !== null && msUntil > 0 && msUntil <= 30 * 60 * 1000
      && (wo.technicianId || wo.technician2Id);
    if (wouldSend) bislo++;
    const mins = msUntil !== null ? Math.round(msUntil / 60000) : 'n/a';
    console.log(`  ${wouldSend ? '>> POSLAO BIH' : '   preskačem '} | ${wo.time} ${wo.address?.slice(0, 40)} | pravi termin za ${mins} min | tel: ${wo.userPhone || '-'} | teh: ${[wo.technicianId, wo.technician2Id].filter(Boolean).length}`);
  });
  console.log(`\nUkupno bi bilo poslato SADA: ${bislo}`);

  // Statistika za danas — koliko naloga ima termin u budućnosti danas
  const today = await WorkOrder.countDocuments({ status: 'nezavrsen', appointmentDateTime: { $gte: now, $lte: new Date(now.getTime() + 24 * 3600 * 1000) } });
  console.log(`Nezavršenih naloga sa terminom u narednih 24h: ${today}`);

  await mongoose.disconnect();
  console.log(failures === 0 ? '\nALL UNIT TESTS PASSED' : `\n!!! ${failures} UNIT TESTS FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error('Fatal:', e); process.exit(1); });
