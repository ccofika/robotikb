// Upisi u dosije i alarmi (zajedničko za skeniranje, cron i rute)
const SecurityDossier = require('../../models/SecurityDossier');
const SecurityAlarm = require('../../models/SecurityAlarm');
const { instantToLocal } = require('./time');

const hm = (d) => instantToLocal(d).hhmm;

async function addDossier({ workerId, kind, level = 'warn', text, facility, facilityName, shiftId, alarmId, byName, at }) {
  if (!workerId) return null;
  try {
    return await SecurityDossier.create({
      workerId, kind, level, text,
      at: at || new Date(),
      facilityId: facility ? facility._id : null,
      facilityName: facilityName || (facility ? facility.name : ''),
      shiftId: shiftId || null,
      alarmId: alarmId || null,
      byName: byName || ''
    });
  } catch (e) {
    console.error('[Security] dosije upis nije uspeo:', e.message);
    return null;
  }
}

// Samo pre-prod E2E (test kuka /_test/delays, SECURITY_TEST_HOOKS=1): veštačko kašnjenje pre upisa alarma,
// da trka "mehanizam alarma i očitavanje u istoj sekundi" može da se ponovi u testu. U produkciji ne postoji.
async function testDelay(name) {
  const ms = global.__securityTestDelays && global.__securityTestDelays[name];
  if (ms) await new Promise((r) => setTimeout(r, ms));
}

async function raiseAlarm({ kind, level, title, message, facility, shift, worker, roundIndex = null, tagName = '', recipients = [], channels = [], firedAt }) {
  await testDelay('raiseAlarm');
  return SecurityAlarm.create({
    kind, level, title, message,
    facilityId: facility ? facility._id : null,
    facilityName: facility ? facility.name : '',
    shiftId: shift ? shift._id : null,
    workerId: worker ? worker._id : null,
    workerName: worker ? worker.name : '',
    roundIndex, tagName,
    firedAt: firedAt || new Date(),
    recipients: recipients.map((r) => ({ name: r.name, role: r.role || '' })),
    channels
  });
}

// true samo za prvi poziv sa tim ključem (i kad dva zahteva stignu u istoj sekundi)
async function claimOnce(key) {
  const SecurityOnce = require('../../models/SecurityOnce');
  try {
    await SecurityOnce.create({ key });
    return true;
  } catch (e) {
    if (e && e.code === 11000) return false;
    throw e;
  }
}

// Zatvara otvorene alarme koji su se rešili sami (prijava, očitan checkpoint, odjava)
async function resolveAlarms(filter, resolution) {
  return SecurityAlarm.updateMany(
    { ...filter, state: { $in: ['open', 'snoozed', 'escalated', 'ack'] } },
    { $set: { state: 'resolved', resolvedAt: new Date(), resolution } }
  );
}

module.exports = { addDossier, raiseAlarm, resolveAlarms, claimOnce, hm };
