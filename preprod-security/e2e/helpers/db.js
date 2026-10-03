// Čišćenje test stanja direktno u lokalnoj bazi (samo robotik_preprod_security na 127.0.0.1:27118):
// smene, očitavanja, alarmi, zapažanja i zadaci test radnika, da svaki test krene od istog stanja.
const { MONGO_URI, DB_NAME, BACKEND_DIR, GUARD } = require('./env');

const { MongoClient } = require(require.resolve('mongodb', { paths: [BACKEND_DIR] }));

async function withDb(fn) {
  if (!/^mongodb:\/\/127\.0\.0\.1:27118$/.test(MONGO_URI) || DB_NAME !== 'robotik_preprod_security') throw new Error('[db] dozvoljena je samo lokalna Security pre-prod baza');
  const client = await MongoClient.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  try { return await fn(client.db(DB_NAME)); } finally { await client.close(); }
}

// Sve što je test radnik uradio ili dobio (smene, alarmi, očitavanja, dosije, zapažanja, zadaci za njegove smene)
async function resetGuard(name = GUARD) {
  return withDb(async (db) => {
    const w = await db.collection('securityworkers').findOne({ name });
    if (!w) throw new Error(`[db] radnik "${name}" ne postoji`);
    const shifts = await db.collection('securityshifts').find({ workerId: w._id }).project({ _id: 1 }).toArray();
    const ids = shifts.map((s) => s._id);
    const out = {
      shifts: (await db.collection('securityshifts').deleteMany({ workerId: w._id })).deletedCount,
      alarms: (await db.collection('securityalarms').deleteMany({ $or: [{ workerId: w._id }, { shiftId: { $in: ids } }] })).deletedCount,
      scans: (await db.collection('securityscans').deleteMany({ workerId: w._id })).deletedCount,
      notes: (await db.collection('securityobservations').deleteMany({ workerId: w._id })).deletedCount,
      tasks: (await db.collection('securitytasks').deleteMany({ $or: [{ shiftId: { $in: ids } }, { text: /^E2E / }] })).deletedCount,
      dossier: (await db.collection('securitydossiers').deleteMany({ workerId: w._id })).deletedCount,
    };
    return out;
  });
}

// Alarmi koje je mehanizam možda upalio pre nego što je test pomerio plan (prijava preko API-ja, pa pomeranje tačaka)
async function clearAlarms(shiftId) {
  return withDb(async (db) => {
    const { ObjectId } = require(require.resolve('mongodb', { paths: [BACKEND_DIR] }));
    const id = new ObjectId(String(shiftId));
    await db.collection('securityalarms').deleteMany({ shiftId: id });
    await db.collection('securityshifts').updateOne({ _id: id }, { $set: { 'rounds.$[].alarm1At': null, 'rounds.$[].alarm2At': null, 'rounds.$[].snoozedUntil': null, 'rounds.$[].snoozes': [] } });
  });
}

async function shift(shiftId) {
  return withDb(async (db) => {
    const { ObjectId } = require(require.resolve('mongodb', { paths: [BACKEND_DIR] }));
    return db.collection('securityshifts').findOne({ _id: new ObjectId(String(shiftId)) });
  });
}

async function alarms(shiftId) {
  return withDb(async (db) => {
    const { ObjectId } = require(require.resolve('mongodb', { paths: [BACKEND_DIR] }));
    return db.collection('securityalarms').find({ shiftId: new ObjectId(String(shiftId)) }).sort({ firedAt: 1 }).toArray();
  });
}

async function notes(shiftId) {
  return withDb(async (db) => {
    const { ObjectId } = require(require.resolve('mongodb', { paths: [BACKEND_DIR] }));
    return db.collection('securityobservations').find({ shiftId: new ObjectId(String(shiftId)) }).sort({ at: 1 }).toArray();
  });
}

async function task(taskId) {
  return withDb(async (db) => {
    const { ObjectId } = require(require.resolve('mongodb', { paths: [BACKEND_DIR] }));
    return db.collection('securitytasks').findOne({ _id: new ObjectId(String(taskId)) });
  });
}

async function dossier(name = GUARD, kind) {
  return withDb(async (db) => {
    const w = await db.collection('securityworkers').findOne({ name });
    return db.collection('securitydossiers').find({ workerId: w._id, ...(kind ? { kind } : {}) }).toArray();
  });
}

// Web obaveštenja datog tipa nastala u poslednjih ms milisekundi
async function recentNotifications(type, ms = 15 * 60000) {
  return withDb(async (db) => {
    const list = await db.collection('notifications').find({ type }).sort({ _id: -1 }).limit(20).toArray();
    return list.filter((n) => Date.now() - n._id.getTimestamp().getTime() < ms);
  });
}

async function unknownTag(uid) {
  return withDb((db) => db.collection('securityscans').findOne({ uid, result: 'unknown_tag' }));
}

async function lastScans(name = GUARD, n = 5) {
  return withDb(async (db) => {
    const w = await db.collection('securityworkers').findOne({ name });
    return db.collection('securityscans').find({ workerId: w._id }).sort({ receivedAt: -1, _id: -1 }).limit(n).toArray();
  });
}

module.exports = { withDb, resetGuard, clearAlarms, shift, alarms, notes, task, dossier, recentNotifications, unknownTag, lastScans };
