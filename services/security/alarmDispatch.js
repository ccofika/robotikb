// Ko dobija koji alarm i kojim kanalom
const SecurityWorker = require('../../models/SecurityWorker');
const SecurityFacility = require('../../models/SecurityFacility');
const { pushToWorker, adminRecipients, coordinatorsOf, webNotify, sendMail, alertEmailHtml } = require('./notify');
const { raiseAlarm, addDossier, hm } = require('./events');
const SecurityAlarm = require('../../models/SecurityAlarm');

const extraAlertEmails = () => (process.env.SECURITY_ALERT_EMAILS || '').split(',').map((e) => e.trim()).filter(Boolean);

// Mehanizam je atomski "rezervisao" alarm, ali je radnik u istoj sekundi možda uradio ono zbog čega alarm ide
// (prijava, očitavanje, odjava). Posle upisa alarma uslov se proverava još jednom: ako više ne važi, alarm se
// odmah zatvara i niko ne dobija obaveštenje. Očitavanje zatvara alarme posle svog upisa, pa uvek jedna strana
// vidi drugu: alarm nikad ne ostaje otvoren posle prijave ili očitavanja.
async function stillNeeded(alarm, check) {
  if (!check || (await check())) return true;
  await SecurityAlarm.updateOne(
    { _id: alarm._id, state: { $ne: 'resolved' } },
    { $set: { state: 'resolved', resolvedAt: new Date(), resolution: 'Radnik je reagovao u istom trenutku' } }
  );
  return false;
}

async function load(shift) {
  const [worker, facility] = await Promise.all([
    SecurityWorker.findById(shift.workerId),
    SecurityFacility.findById(shift.facilityId)
  ]);
  return { worker, facility };
}

// Alarm radniku: nije se prijavio posle lateMin minuta
async function fireLate(shift, rules, check) {
  const { worker, facility } = await load(shift);
  if (!worker || !facility) return null;
  const alarm = await raiseAlarm({
    kind: 'late', level: 'warn', shift, worker, facility,
    title: 'Radnik nije prijavljen',
    message: `${worker.name} se nije prijavio ${rules.lateMin} min posle početka smene (${hm(shift.plannedStart)}).`,
    recipients: [{ name: worker.name, role: 'guard' }], channels: ['push']
  });
  if (!(await stillNeeded(alarm, check))) return null;
  await pushToWorker(worker, {
    title: 'Nisi prijavljen na smenu',
    body: `${facility.name}: smena je počela u ${hm(shift.plannedStart)}. Prisloni telefon na tag radnog mesta.`,
    data: { type: 'security_alarm', kind: 'late', alarmId: String(alarm._id), shiftId: String(shift._id) }
  });
  return alarm;
}

// MASTER ALARM: koordinator objekta i administratori
async function fireMaster(shift, rules, check) {
  const { worker, facility } = await load(shift);
  if (!worker || !facility) return null;
  const [admins, coords] = await Promise.all([adminRecipients(), coordinatorsOf(facility._id)]);
  const recipients = [...coords.map((c) => ({ name: c.name, role: 'coordinator' })), ...admins.map((a) => ({ name: a.name, role: a.role }))];
  const alarm = await raiseAlarm({
    kind: 'master', level: 'critical', shift, worker, facility,
    title: 'MASTER ALARM',
    message: `${worker.name} nije prijavljen ${rules.masterMin} min. Smena na objektu ${facility.name} je počela u ${hm(shift.plannedStart)}.`,
    recipients, channels: ['web', 'push', 'email']
  });
  if (!(await stillNeeded(alarm, check))) return null;
  await webNotify([...admins, ...coords], {
    title: `MASTER ALARM · ${facility.name}`,
    message: `${worker.name} nije prijavljen ${rules.masterMin} min (smena od ${hm(shift.plannedStart)}).`,
    targetPage: '/security', targetId: alarm._id
  });
  await sendMail({
    to: [...admins.map((a) => a.gmail), ...coords.map((c) => c.email), ...extraAlertEmails()],
    subject: `MASTER ALARM · ${facility.name} · ${worker.name} nije prijavljen`,
    html: alertEmailHtml({
      heading: `MASTER ALARM · ${facility.name}`,
      lines: [`${worker.name} nije prijavljen na smenu ${rules.masterMin} min.`, `Smena je počela u ${hm(shift.plannedStart)}.`, worker.phone ? `Telefon radnika: ${worker.phone}` : ''].filter(Boolean)
    })
  });
  for (const c of coords) {
    await pushToWorker(c, { title: `MASTER ALARM · ${facility.name}`, body: `${worker.name} nije prijavljen ${rules.masterMin} min.`, data: { type: 'security_master', alarmId: String(alarm._id) } });
  }
  await pushToWorker(worker, {
    title: 'MASTER ALARM je poslat',
    body: `Koordinator i admin su obavešteni. Prijavi se odmah na tag radnog mesta (${facility.name}).`,
    data: { type: 'security_alarm', kind: 'master', alarmId: String(alarm._id), shiftId: String(shift._id) }
  });
  await addDossier({ workerId: worker._id, kind: 'master', level: 'critical', facility, shiftId: shift._id, alarmId: alarm._id, text: `MASTER ALARM: nije se prijavio ${rules.masterMin} min posle početka smene (${hm(shift.plannedStart)}).` });
  return alarm;
}

async function fireCheckpoint1(shift, index, rules, check) {
  const { worker, facility } = await load(shift);
  const round = shift.rounds[index];
  if (!worker || !facility || !round) return null;
  const alarm = await raiseAlarm({
    kind: 'checkpoint1', level: 'warn', shift, worker, facility, roundIndex: index, tagName: round.tagName,
    title: `Kasni checkpoint: ${round.tagName}`,
    message: `Planirano ${hm(round.dueAt)}, tolerancija ${rules.checkpointTolMin} min. Prvi alarm radniku.`,
    recipients: [{ name: worker.name, role: 'guard' }], channels: ['push']
  });
  if (!(await stillNeeded(alarm, check))) return null;
  await pushToWorker(worker, {
    title: 'Kasniš na checkpoint',
    body: `${round.tagName}, plan ${hm(round.dueAt)}. Očitaj tag ili odloži alarm uz razlog.`,
    data: { type: 'security_alarm', kind: 'checkpoint1', alarmId: String(alarm._id), shiftId: String(shift._id), roundIndex: index }
  });
  return alarm;
}

// Drugi alarm za checkpoint: automatski ide i administratoru
async function fireCheckpoint2(shift, index, rules, check) {
  const { worker, facility } = await load(shift);
  const round = shift.rounds[index];
  if (!worker || !facility || !round) return null;
  await SecurityAlarm.updateMany({ shiftId: shift._id, kind: 'checkpoint1', roundIndex: index, state: { $in: ['open', 'snoozed'] } }, { $set: { state: 'escalated' } });
  const [admins, coords] = await Promise.all([adminRecipients(), coordinatorsOf(facility._id)]);
  const snoozed = (round.snoozes || []).length > 0;
  const alarm = await raiseAlarm({
    kind: 'checkpoint2', level: 'critical', shift, worker, facility, roundIndex: index, tagName: round.tagName,
    title: `Drugi alarm: ${round.tagName}`,
    message: `Checkpoint nije očitan${snoozed ? ' ni posle odlaganja' : ''} (plan ${hm(round.dueAt)}). Obavešten administrator.`,
    recipients: [{ name: worker.name, role: 'guard' }, ...admins.map((a) => ({ name: a.name, role: a.role })), ...coords.map((c) => ({ name: c.name, role: 'coordinator' }))],
    channels: ['push', 'web', 'email']
  });
  if (!(await stillNeeded(alarm, check))) return null;
  await pushToWorker(worker, {
    title: 'Drugi alarm: obavešten admin',
    body: `${round.tagName} i dalje nije očitan. Očitaj tag što pre.`,
    data: { type: 'security_alarm', kind: 'checkpoint2', alarmId: String(alarm._id), shiftId: String(shift._id), roundIndex: index }
  });
  await webNotify([...admins, ...coords], {
    title: `Propušten obilazak · ${facility.name}`,
    message: `${worker.name}: ${round.tagName} nije očitan (plan ${hm(round.dueAt)})${snoozed ? ', ni posle odlaganja' : ''}.`,
    targetPage: '/security', targetId: alarm._id
  });
  await sendMail({
    to: [...admins.map((a) => a.gmail), ...extraAlertEmails()],
    subject: `Propušten obilazak · ${facility.name} · ${round.tagName}`,
    html: alertEmailHtml({
      heading: `Propušten obilazak · ${facility.name}`,
      lines: [`${worker.name} nije očitao checkpoint ${round.tagName}.`, `Plan: ${hm(round.dueAt)}.`, snoozed ? `Razlog odlaganja: ${round.snoozes[round.snoozes.length - 1].reason}` : 'Alarm nije odložen.']
    })
  });
  await addDossier({ workerId: worker._id, kind: 'cp_admin', level: 'critical', facility, shiftId: shift._id, alarmId: alarm._id, text: `Checkpoint ${round.tagName}: drugi alarm, obavešten administrator (plan ${hm(round.dueAt)}).` });
  return alarm;
}

async function fireNoClockOut(shift, rules, check) {
  const { worker, facility } = await load(shift);
  if (!worker || !facility) return null;
  const [admins, coords] = await Promise.all([adminRecipients(), coordinatorsOf(facility._id)]);
  const alarm = await raiseAlarm({
    kind: 'no_clock_out', level: 'warn', shift, worker, facility,
    title: 'Nema odjave sa smene',
    message: `${worker.name} se nije odjavio ${rules.noClockOutMin} min posle kraja smene (${hm(shift.plannedEnd)}).`,
    recipients: [...coords.map((c) => ({ name: c.name, role: 'coordinator' })), ...admins.map((a) => ({ name: a.name, role: a.role }))],
    channels: ['web', 'push']
  });
  if (!(await stillNeeded(alarm, check))) return null;
  await webNotify([...coords, ...admins], {
    title: `Nema odjave · ${facility.name}`,
    message: `${worker.name} se nije odjavio posle smene koja je trajala do ${hm(shift.plannedEnd)}.`,
    priority: 'medium', targetPage: '/security', targetId: alarm._id
  });
  await pushToWorker(worker, { title: 'Nisi se odjavio', body: `Smena je završena u ${hm(shift.plannedEnd)}. Prisloni telefon na tag radnog mesta.`, data: { type: 'security_alarm', kind: 'no_clock_out', alarmId: String(alarm._id) } });
  await addDossier({ workerId: worker._id, kind: 'no_clock_out', level: 'warn', facility, shiftId: shift._id, alarmId: alarm._id, text: `Nije se odjavio sa smene (kraj ${hm(shift.plannedEnd)}).` });
  return alarm;
}

module.exports = { fireLate, fireMaster, fireCheckpoint1, fireCheckpoint2, fireNoClockOut };
