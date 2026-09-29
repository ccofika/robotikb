// Podešavanja Security modula (singleton) sa kratkim kešom
const SecuritySettings = require('../../models/SecuritySettings');

let cache = null;
let cacheAt = 0;
const TTL_MS = 15 * 1000;

async function getSettings() {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  let doc = await SecuritySettings.findOne({ key: 'global' });
  if (!doc) {
    try {
      doc = await SecuritySettings.create({ key: 'global' });
    } catch (e) {
      doc = await SecuritySettings.findOne({ key: 'global' }); // paralelno kreiranje
    }
  }
  cache = doc.toObject();
  cacheAt = Date.now();
  return cache;
}

function invalidateSettings() { cache = null; cacheAt = 0; }

// Pravila za konkretan objekat (lokalna pravila imaju prednost)
function rulesFor(settings, facility) {
  const a = settings.alarms || {};
  const r = (facility && facility.rules) || {};
  return {
    lateMin: a.lateMin,
    masterMin: a.masterMin,
    checkpointTolMin: r.checkpointTolMin != null ? r.checkpointTolMin : a.checkpointTolMin,
    snoozeMin: r.snoozeMin != null ? r.snoozeMin : a.snoozeMin,
    maxSnoozes: a.maxSnoozes,
    noClockOutEnabled: a.noClockOutEnabled,
    noClockOutMin: a.noClockOutMin,
    earlyClockInMin: a.earlyClockInMin
  };
}

module.exports = { getSettings, invalidateSettings, rulesFor };
