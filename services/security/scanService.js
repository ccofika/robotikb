// Obrada NFC očitavanja: prijava, odjava, checkpoint, nepoznat ili zamenjen tag
const SecurityScan = require('../../models/SecurityScan');
const SecurityShift = require('../../models/SecurityShift');
const SecurityFacility = require('../../models/SecurityFacility');
const NfcTag = require('../../models/NfcTag');
const { getSettings, rulesFor } = require('./settings');
const { buildRounds } = require('./shiftService');
const { addDossier, resolveAlarms, hm } = require('./events');
const { adminRecipients, webNotify } = require('./notify');
const { instantToLocal } = require('./time');

// "04a22c1f9b5c3e80", "04:a2:2c:..." ili "04-A2-..." -> "04:A2:2C:1F:9B:5C:3E:80"
function normalizeUid(raw) {
  const hex = String(raw || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (hex.length < 8 || hex.length > 20 || hex.length % 2 !== 0) return null;
  return hex.match(/.{2}/g).join(':');
}

function distanceM(a, b) {
  const R = 6371000, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const RESULT_TEXT = {
  clock_in: 'Prijavljen na smenu',
  clock_out: 'Odjavljen sa smene',
  checkpoint: 'Checkpoint očitan',
  extra: 'Očitano van plana obilaska',
  unknown_tag: 'Tag nije registrovan. Admin je obavešten.',
  replaced_tag: 'Ovaj tag je zamenjen novim.',
  retired_tag: 'Ovaj tag je uklonjen iz upotrebe.',
  no_shift: 'Nemaš smenu na ovom objektu u ovo vreme.',
  no_clock_in: 'Prvo se prijavi na tag radnog mesta.',
  shift_done: 'Smena je već završena.',
  duplicate: 'Već očitano.'
};

function publicResult(scan, extra = {}) {
  return {
    result: scan.result,
    message: scan.message || RESULT_TEXT[scan.result] || '',
    lateMin: scan.lateMin || 0,
    at: scan.at,
    tag: scan.tagName ? { name: scan.tagName, category: scan.category } : null,
    facilityName: scan.facilityName,
    shiftId: scan.shiftId,
    scanId: scan._id,
    ...extra
  };
}

async function recordScan(base, fields) {
  return SecurityScan.create({ ...base, ...fields });
}

// Smena radnika na objektu koja odgovara vremenu očitavanja
async function findShiftFor(workerId, facilityId, eventAt, rules) {
  const early = (rules.earlyClockInMin || 0) * 60000;
  const list = await SecurityShift.find({
    workerId, facilityId, published: true,
    status: { $in: ['planned', 'active', 'done'] },
    plannedStart: { $lte: new Date(eventAt.getTime() + early) },
    plannedEnd: { $gte: new Date(eventAt.getTime() - 6 * 3600000) }
  }).sort({ plannedStart: 1 });
  return list.find((s) => s.status === 'active')
    || list.find((s) => s.status === 'planned' && eventAt.getTime() >= s.plannedStart.getTime() - early && eventAt <= s.plannedEnd)
    || list.find((s) => s.status === 'done')
    || null;
}

async function processScan(worker, body = {}) {
  const now = new Date();
  const uid = normalizeUid(body.uid);
  if (!uid) { const e = new Error('Neispravan broj taga.'); e.status = 400; throw e; }

  // Isto očitavanje poslato ponovo (posle rada bez interneta ili dupli dodir)
  if (body.clientId) {
    const prev = await SecurityScan.findOne({ clientId: body.clientId });
    if (prev) return publicResult(prev, { repeated: true });
  }

  let eventAt = now;
  const flags = [];
  const deviceAt = body.deviceAt ? new Date(body.deviceAt) : null;
  if (deviceAt && !isNaN(deviceAt.getTime())) {
    const diffMin = (now - deviceAt) / 60000;
    if (body.offline && diffMin >= -2 && diffMin <= 24 * 60) eventAt = deviceAt < now ? deviceAt : now;
    else if (Math.abs(diffMin) > 5) flags.push('clock');
  }
  const geo = body.geo && typeof body.geo.lat === 'number' ? { lat: body.geo.lat, lng: body.geo.lng, acc: body.geo.acc } : undefined;
  const source = ['nfc', 'simulated', 'manual'].includes(body.source) ? body.source : 'nfc';
  const base = { at: eventAt, receivedAt: now, deviceAt, clientId: body.clientId || null, workerId: worker._id, workerName: worker.name, uid, geo, offline: !!body.offline, source, flags };

  const tag = await NfcTag.findOne({ uid });
  if (!tag) {
    const replaced = await NfcTag.findOne({ 'previousUids.uid': uid });
    if (replaced) {
      const scan = await recordScan(base, { result: 'replaced_tag', tagId: replaced._id, tagName: replaced.name, facilityId: replaced.facilityId, message: `Ovaj tag je zamenjen novim. Skeniraj novi tag: ${replaced.name}.` });
      return publicResult(scan);
    }
    // Nepoznat tag: pamtimo ga sa objektom iz trenutne smene, da admin može da ga registruje jednim klikom
    const current = await SecurityShift.findOne({ workerId: worker._id, status: { $in: ['active', 'planned'] }, plannedStart: { $lte: new Date(now.getTime() + 3600000) }, plannedEnd: { $gte: now } }).populate('facilityId', 'name');
    const facility = current && current.facilityId;
    const scan = await recordScan(base, { result: 'unknown_tag', facilityId: facility ? facility._id : null, facilityName: facility ? facility.name : '', shiftId: current ? current._id : null });
    const dayKey = instantToLocal(now).ymd;
    const seenToday = await SecurityScan.countDocuments({ uid, result: 'unknown_tag', at: { $gte: new Date(now.getTime() - 24 * 3600000) } });
    if (seenToday <= 1) {
      const admins = await adminRecipients();
      await webNotify(admins, {
        type: 'security_unknown_tag', priority: 'medium',
        title: 'Očitan nepoznat NFC tag',
        message: `${worker.name}${facility ? ` na objektu ${facility.name}` : ''} je očitao tag koji nije registrovan (${uid}). Registruj ga jednim klikom.`,
        targetPage: '/security/objekti?nepoznati=1', targetId: `${uid}:${dayKey}`
      });
    }
    return publicResult(scan);
  }

  const facility = await SecurityFacility.findById(tag.facilityId);
  base.tagId = tag._id; base.tagName = tag.name; base.category = tag.category;
  base.facilityId = tag.facilityId; base.facilityName = facility ? facility.name : '';

  if (tag.status === 'retired') {
    return publicResult(await recordScan(base, { result: 'retired_tag' }));
  }

  // Dupli dodir istog taga u kratkom roku vraća prethodni rezultat
  const recent = await SecurityScan.findOne({ workerId: worker._id, tagId: tag._id, at: { $gte: new Date(eventAt.getTime() - 20000) }, result: { $in: ['clock_in', 'clock_out', 'checkpoint', 'extra'] } }).sort({ at: -1 });
  if (recent) return publicResult(recent, { repeated: true });

  if (facility && facility.geo && facility.geo.lat != null && geo) {
    const s0 = await getSettings();
    if (distanceM(facility.geo, geo) > (s0.gpsRadiusM || 300)) flags.push('far');
  }

  const s = await getSettings();
  const rules = rulesFor(s, facility);
  const shift = await findShiftFor(worker._id, tag.facilityId, eventAt, rules);
  if (!shift) return publicResult(await recordScan(base, { result: 'no_shift' }));
  base.shiftId = shift._id;

  // ---------- RADNO MESTO: prijava / odjava ----------
  if (tag.category === 'workplace') {
    if (shift.status === 'planned') {
      const lateMin = Math.max(0, Math.floor((eventAt - shift.plannedStart) / 60000));
      const rounds = await buildRounds(shift, facility, s);
      const upd = await SecurityShift.findOneAndUpdate(
        { _id: shift._id, status: 'planned' },
        { $set: { status: 'active', lateMin, rounds, clockIn: { at: eventAt, receivedAt: now, deviceAt, tagId: tag._id, uid, geo, offline: !!body.offline, source } } },
        { new: true }
      );
      if (!upd) return publicResult(await recordScan(base, { result: 'duplicate' }));
      const scan = await recordScan(base, { result: 'clock_in', lateMin, message: lateMin > 0 ? `Prijavljen u ${hm(eventAt)}, kašnjenje ${lateMin} min` : `Prijavljen na smenu u ${hm(eventAt)}` });
      await resolveAlarms({ shiftId: shift._id, kind: { $in: ['late', 'master'] } }, `Prijava u ${hm(eventAt)}`);
      if (lateMin > 0) {
        await addDossier({ workerId: worker._id, kind: 'late', level: 'warn', facility, shiftId: shift._id, text: `Kašnjenje na smenu ${lateMin} min (prijava ${hm(eventAt)}, početak ${hm(shift.plannedStart)}).` });
      }
      // Prethodnoj smeni na objektu upisujemo ko je primio smenu
      await SecurityShift.updateOne(
        { facilityId: shift.facilityId, _id: { $ne: shift._id }, workerId: { $ne: worker._id }, status: { $in: ['active', 'done'] }, plannedEnd: { $gte: new Date(shift.plannedStart.getTime() - 3600000), $lte: new Date(shift.plannedStart.getTime() + 3600000) }, 'receivedBy.workerId': null },
        { $set: { receivedBy: { workerId: worker._id, name: worker.name, at: eventAt } } }
      );
      await NfcTag.updateOne({ _id: tag._id }, { $set: { lastScanAt: eventAt, lastScanByName: worker.name } });
      return publicResult(scan, { shiftStatus: 'active' });
    }
    if (shift.status === 'active') {
      const early = eventAt.getTime() < shift.plannedEnd.getTime() - 30 * 60000;
      if (early && !body.confirmEarly) {
        return { result: 'confirm_early', message: `Smena traje do ${hm(shift.plannedEnd)}. Da li sigurno odlaziš ranije?`, minutesLeft: Math.round((shift.plannedEnd - eventAt) / 60000), shiftId: shift._id, tag: { name: tag.name, category: tag.category } };
      }
      const earlyLeaveMin = early ? Math.floor((shift.plannedEnd - eventAt) / 60000) : 0;
      const upd = await SecurityShift.findOneAndUpdate(
        { _id: shift._id, status: 'active' },
        { $set: { status: 'done', earlyLeaveMin, clockOut: { at: eventAt, receivedAt: now, deviceAt, tagId: tag._id, uid, geo, offline: !!body.offline, source, early } } },
        { new: true }
      );
      if (!upd) return publicResult(await recordScan(base, { result: 'duplicate' }));
      const scan = await recordScan(base, { result: 'clock_out', message: early ? `Odjavljen u ${hm(eventAt)}, ${earlyLeaveMin} min pre kraja smene` : `Odjavljen sa smene u ${hm(eventAt)}` });
      await resolveAlarms({ shiftId: shift._id, kind: 'no_clock_out' }, `Odjava u ${hm(eventAt)}`);
      if (early) await addDossier({ workerId: worker._id, kind: 'early_leave', level: 'warn', facility, shiftId: shift._id, text: `Rana odjava u ${hm(eventAt)}, ${earlyLeaveMin} min pre kraja smene (${hm(shift.plannedEnd)}).` });
      await NfcTag.updateOne({ _id: tag._id }, { $set: { lastScanAt: eventAt, lastScanByName: worker.name } });
      setImmediate(() => {
        require('./reportService').sendShiftReport(shift._id, { reason: 'clock_out' }).catch((e) => console.error('[Security] izveštaj posle odjave:', e.message));
      });
      return publicResult(scan, { shiftStatus: 'done' });
    }
    return publicResult(await recordScan(base, { result: 'shift_done' }));
  }

  // ---------- CHECKPOINT ----------
  if (shift.status === 'planned') return publicResult(await recordScan(base, { result: 'no_clock_in' }));
  if (shift.status === 'done') return publicResult(await recordScan(base, { result: 'shift_done' }));

  // Brz obilazak: dva različita checkpointa u par sekundi (moguće da je tag skinut sa zida)
  const last = await SecurityScan.findOne({ workerId: worker._id, shiftId: shift._id, result: { $in: ['checkpoint', 'extra'] } }).sort({ at: -1 });
  if (last && String(last.tagId) !== String(tag._id) && Math.abs(eventAt - last.at) < 15000) flags.push('fast');

  const idx = shift.rounds.findIndex((r) => String(r.tagId) === String(tag._id) && !r.scannedAt && eventAt.getTime() >= r.dueAt.getTime() - 60 * 60000);
  if (idx === -1) {
    const scan = await recordScan(base, { result: 'extra' });
    await NfcTag.updateOne({ _id: tag._id }, { $set: { lastScanAt: eventAt, lastScanByName: worker.name } });
    return publicResult(scan);
  }
  const round = shift.rounds[idx];
  const lateMin = Math.max(0, Math.floor((eventAt - round.dueAt) / 60000));
  const scanDoc = new SecurityScan({ ...base, result: 'checkpoint', lateMin });
  const upd = await SecurityShift.updateOne(
    { _id: shift._id, [`rounds.${idx}.scannedAt`]: null },
    { $set: { [`rounds.${idx}.scannedAt`]: eventAt, [`rounds.${idx}.lateMin`]: lateMin, [`rounds.${idx}.scanId`]: scanDoc._id } }
  );
  if (!upd.modifiedCount) return publicResult(await recordScan(base, { result: 'duplicate' }));
  const late = lateMin > rules.checkpointTolMin;
  scanDoc.message = late ? `${tag.name} očitan ${lateMin} min posle plana (${hm(round.dueAt)})` : `${tag.name} očitan u ${hm(eventAt)}`;
  await scanDoc.save();
  await resolveAlarms({ shiftId: shift._id, roundIndex: idx, kind: { $in: ['checkpoint1', 'checkpoint2'] } }, `Očitano ${hm(eventAt)}`);
  if (late) {
    const reason = (round.snoozes || []).length ? round.snoozes[round.snoozes.length - 1].reason : '';
    await addDossier({ workerId: worker._id, kind: 'cp_late', level: 'warn', facility, shiftId: shift._id, text: `Checkpoint ${tag.name} očitan ${lateMin} min posle plana (${hm(round.dueAt)})${reason ? `. Razlog: ${reason}` : ''}.` });
  }
  await NfcTag.updateOne({ _id: tag._id }, { $set: { lastScanAt: eventAt, lastScanByName: worker.name } });
  return publicResult(scanDoc, { roundIndex: idx, late });
}

module.exports = { processScan, normalizeUid, distanceM };
