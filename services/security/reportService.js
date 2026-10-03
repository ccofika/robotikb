// Izveštaj smene (digitalni Dnevnik rada): podaci, HTML email, PDF i slanje na adrese objekta
const path = require('path');
const SecurityShift = require('../../models/SecurityShift');
const SecurityScan = require('../../models/SecurityScan');
const SecurityAlarm = require('../../models/SecurityAlarm');
const SecurityObservation = require('../../models/SecurityObservation');
const SecurityTask = require('../../models/SecurityTask');
const SecurityWorker = require('../../models/SecurityWorker');
const { getSettings, rulesFor } = require('./settings');
const { instantToLocal, fmtDateSr } = require('./time');
const { shiftLabel } = require('./shiftService');
const { shiftMinutes, payFor, holidaySetFor } = require('./payService');
const { sendMail, esc } = require('./notify');

const hm = (d) => (d ? instantToLocal(d).hhmm : '');

const ALARM_TEXT = { late: 'Alarm radniku: nije prijavljen', master: 'MASTER ALARM', checkpoint1: 'Alarm za checkpoint', checkpoint2: 'Drugi alarm za checkpoint, obavešten admin', no_clock_out: 'Nema odjave' };
const STATE_TEXT = { open: 'otvoren', snoozed: 'odložen', escalated: 'eskaliran', ack: 'preuzet', resolved: 'rešen' };

async function buildReportData(shiftId) {
  const shift = await SecurityShift.findById(shiftId).populate('facilityId').populate('workerId', 'name phone');
  if (!shift) return null;
  const facility = shift.facilityId || {};
  const worker = shift.workerId || {};
  const s = await getSettings();
  const [scans, alarms, notes, tasks, coords] = await Promise.all([
    SecurityScan.find({ shiftId: shift._id }).sort({ at: 1 }).lean(),
    SecurityAlarm.find({ shiftId: shift._id }).sort({ firedAt: 1 }).lean(),
    SecurityObservation.find({ shiftId: shift._id }).sort({ at: 1 }).lean(),
    SecurityTask.find({ facilityId: facility._id, $or: [{ shiftId: shift._id }, { shiftId: null, dueAt: { $gte: shift.plannedStart, $lte: shift.plannedEnd } }] }).sort({ dueAt: 1 }).lean(),
    SecurityWorker.find({ role: 'coordinator', facilityIds: facility._id, isActive: true }).select('name email').lean()
  ]);

  const events = [];
  for (const sc of scans) {
    if (sc.result === 'clock_in') events.push({ at: sc.at, kind: 'system', text: `Prijava na smenu, NFC ${sc.tagName}${sc.lateMin ? `, kašnjenje ${sc.lateMin} min` : ''}.` });
    else if (sc.result === 'clock_out') events.push({ at: sc.at, kind: 'system', text: `Odjava sa smene, NFC ${sc.tagName}.` });
    else if (sc.result === 'checkpoint') events.push({ at: sc.at, kind: 'system', text: `Obilazak: ${sc.tagName}${sc.lateMin > 0 ? ` (${sc.lateMin} min posle plana)` : ''}.` });
    else if (sc.result === 'extra') events.push({ at: sc.at, kind: 'system', text: `Očitan ${sc.tagName} van plana obilaska.` });
  }
  for (const a of alarms) events.push({ at: a.firedAt, kind: 'alarm', text: `${ALARM_TEXT[a.kind] || a.title}${a.tagName ? `: ${a.tagName}` : ''} (${STATE_TEXT[a.state] || a.state}).` });
  for (const n of notes) {
    if (n.kind === 'authority') events.push({ at: n.at, kind: 'guard', text: `Primena ovlašćenja: ${n.power}. ${n.text}` });
    else events.push({ at: n.at, kind: 'guard', text: n.text });
  }
  for (const t of tasks) if (t.status === 'done') events.push({ at: t.doneAt, kind: 'system', text: `Povremeni zadatak urađen: ${t.text}. Komentar: ${t.comment}` });
  events.sort((x, y) => new Date(x.at) - new Date(y.at));

  const standing = (facility.standingTasks || []).map((t) => {
    const done = (shift.standingDone || []).find((d) => String(d.taskId) === String(t._id));
    return { text: t.text, done: !!done, doneAt: done ? hm(done.doneAt) : '', comment: done ? done.comment : '' };
  });
  // tolerancija objekta (lokalno pravilo ima prednost), ista kao u mehanizmu alarma
  const tol = rulesFor(s, facility).checkpointTolMin;
  const rounds = (shift.rounds || []).map((r) => ({
    tagName: r.tagName, due: hm(r.dueAt), scanned: r.scannedAt ? hm(r.scannedAt) : '', lateMin: r.lateMin || 0,
    snoozeReason: (r.snoozes || []).length ? r.snoozes[r.snoozes.length - 1].reason : '',
    status: r.scannedAt ? (r.lateMin > tol ? 'late' : 'ok') : (r.alarm2At ? 'missed' : r.alarm1At ? 'alarm' : 'open')
  }));

  const worker2 = shift.workerId && shift.workerId._id ? await SecurityWorker.findById(shift.workerId._id).select('hourlyRate') : null;
  const rate = worker2 && worker2.hourlyRate != null ? worker2.hourlyRate : s.pay.defaultRate;
  const y = Number(shift.date.slice(0, 4));
  const mins = shiftMinutes(shift, holidaySetFor([y, y + 1]));
  const pay = payFor(mins, rate, s.pay);
  const authority = notes.filter((n) => n.kind === 'authority');
  const emails = [...(facility.reportEmails || []), ...(s.reports.ccCoordinator ? coords.map((c) => c.email).filter(Boolean) : [])];

  return {
    shiftId: String(shift._id),
    status: shift.status,
    facility: { id: String(facility._id), name: facility.name || '', address: [facility.address, facility.city].filter(Boolean).join(', ') },
    date: fmtDateSr(shift.date),
    type: shift.type,
    shiftLabel: shiftLabel(shift),
    planned: `${hm(shift.plannedStart)} - ${hm(shift.plannedEnd)}`,
    worker: { name: worker.name || '', phone: worker.phone || '' },
    clockIn: shift.clockIn ? { time: hm(shift.clockIn.at), lateMin: shift.lateMin || 0, source: shift.clockIn.source, offline: !!shift.clockIn.offline, byName: shift.clockIn.byName || '' } : null,
    clockOut: shift.clockOut ? { time: hm(shift.clockOut.at), early: !!shift.clockOut.early, earlyLeaveMin: shift.earlyLeaveMin || 0, source: shift.clockOut.source, byName: shift.clockOut.byName || '' } : null,
    handover: shift.handover && shift.handover.at ? { radio: shift.handover.radio, items: shift.handover.items || [], condition: shift.handover.condition, note: shift.handover.note } : null,
    events: events.map((e) => ({ time: hm(e.at), kind: e.kind, text: e.text })),
    rounds, roundsDone: rounds.filter((r) => r.scanned).length, roundsLate: rounds.filter((r) => r.status === 'late').length,
    standing,
    occasional: tasks.map((t) => ({ text: t.text, due: hm(t.dueAt), done: t.status === 'done', doneAt: hm(t.doneAt), comment: t.comment || '', status: t.status })),
    observations: notes.filter((n) => n.kind === 'observation').map((n) => ({ time: hm(n.at), text: n.text, photos: n.photos || [] })),
    authority: authority.map((n) => ({ time: hm(n.at), power: n.power, subject: n.subject, text: n.text, witnesses: n.witnesses, photos: n.photos || [] })),
    extraordinary: authority.length ? 'Ima (sledi izveštaj)' : 'Nema',
    alarms: alarms.map((a) => ({ time: hm(a.firedAt), title: ALARM_TEXT[a.kind] || a.title, tagName: a.tagName, state: STATE_TEXT[a.state] || a.state, level: a.level })),
    receivedBy: shift.receivedBy && shift.receivedBy.name ? { name: shift.receivedBy.name, time: hm(shift.receivedBy.at) } : null,
    review: shift.review && shift.review.at ? { byName: shift.review.byName, time: `${fmtDateSr(instantToLocal(shift.review.at).ymd)} ${hm(shift.review.at)}`, remark: shift.review.remark, note: shift.review.note } : null,
    pay: { paidMin: mins.paidMin, nightMin: mins.nightMin, holidayMin: mins.holidayMin, rate, amount: Math.round(pay.total), nightPct: s.pay.nightPct, holidayPct: s.pay.holidayPct },
    emails: [...new Set(emails.map((e) => String(e).toLowerCase()))],
    sent: shift.report && shift.report.sentAt ? { at: `${fmtDateSr(instantToLocal(shift.report.sentAt).ymd)} ${hm(shift.report.sentAt)}`, to: shift.report.sentTo } : null,
    noClockOut: !!(shift.report && shift.report.noClockOut && !shift.clockOut)
  };
}

const fmtHours = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} h`;
const rsd = (n) => `${Math.round(n).toLocaleString('de-DE')} RSD`;

function renderHtml(d) {
  const row = (label, value) => `<tr><td style="padding:6px 0;color:#71717a;width:38%;vertical-align:top">${esc(label)}</td><td style="padding:6px 0;color:#18181b">${value}</td></tr>`;
  const section = (title, inner) => `<tr><td style="padding:18px 24px 4px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#71717a">${esc(title)}</td></tr><tr><td style="padding:0 24px 8px;font-size:14px;line-height:1.55">${inner}</td></tr>`;
  const list = (items, empty) => (items.length ? items.join('') : `<div style="color:#a1a1aa">${esc(empty)}</div>`);
  const status = d.clockOut ? 'Smena završena' : d.noClockOut ? 'Bez odjave' : 'Smena u toku';
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden">
<tr><td style="height:4px;background:#00b97c"></td></tr>
<tr><td style="padding:22px 24px 2px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#71717a">Dnevnik rada · Robotik Security</td></tr>
<tr><td style="padding:2px 24px 4px;font-size:22px;font-weight:bold">${esc(d.facility.name)}</td></tr>
<tr><td style="padding:0 24px 12px;font-size:14px;color:#52525b">${esc(d.date)} · ${esc(d.shiftLabel)} · ${esc(status)}${d.noClockOut ? ' (radnik se nije odjavio)' : ''}</td></tr>
${section('Smena', `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">
${row('Smenu preuzeo', `${esc(d.worker.name)}${d.clockIn ? ` · prijava ${esc(d.clockIn.time)}${d.clockIn.lateMin ? `, kašnjenje ${d.clockIn.lateMin} min` : ''}` : ' · nema prijave'}`)}
${row('Smenu predao', d.clockOut ? `${esc(d.worker.name)} · odjava ${esc(d.clockOut.time)}${d.clockOut.early ? `, ${d.clockOut.earlyLeaveMin} min pre kraja` : ''}` : '-')}
${row('Smenu primio', d.receivedBy ? `${esc(d.receivedBy.name)} · prijava ${esc(d.receivedBy.time)}` : '-')}
${row('Preuzeta oprema', d.handover ? `Radio stanica: ${esc(d.handover.radio || '-')} · ${esc((d.handover.items || []).join(', ') || '-')}` : '-')}
${row('Stanje opreme', d.handover ? (d.handover.condition === 'ok' ? 'Ispravna' : `Neispravna, oštećena${d.handover.note ? `: ${esc(d.handover.note)}` : ''}`) : '-')}
${row('Vanredni događaji', esc(d.extraordinary))}
</table>`)}
${section('Tekući događaji i zapažanja', list(d.events.map((e) => `<div style="padding:3px 0;${e.kind === 'guard' ? '' : 'color:#52525b'}"><span style="font-family:Consolas,monospace;color:#71717a;margin-right:8px">${esc(e.time)}</span>${esc(e.text)}</div>`), 'Nema zabeleženih događaja.'))}
${section(`Obilazak · ${d.roundsDone} od ${d.rounds.length}`, list(d.rounds.map((r) => `<div style="padding:3px 0"><span style="font-family:Consolas,monospace;color:#71717a;margin-right:8px">${esc(r.due)}</span>${esc(r.tagName)} · ${r.scanned ? `očitan ${esc(r.scanned)}${r.status === 'late' ? ` (${r.lateMin} min kasnije)` : ''}` : r.status === 'missed' ? '<b style="color:#e5484d">nije očitan</b>' : 'nije očitan'}${r.snoozeReason ? ` · razlog: ${esc(r.snoozeReason)}` : ''}</div>`), 'Objekat nema plan obilaska.'))}
${section('Zadaci', list([...d.standing.map((t) => `<div style="padding:3px 0">${t.done ? '✓' : '○'} ${esc(t.text)}${t.comment ? ` · ${esc(t.comment)}` : ''}</div>`), ...d.occasional.map((t) => `<div style="padding:3px 0">${t.done ? '✓' : '○'} ${esc(t.due)} ${esc(t.text)}${t.comment ? ` · ${esc(t.comment)}` : ''}</div>`)], 'Nema zadataka.'))}
${d.authority.length ? section('Primenjena ovlašćenja', d.authority.map((a) => `<div style="padding:4px 0"><b>${esc(a.time)} · ${esc(a.power)}</b>${a.subject ? ` · lice: ${esc(a.subject)}` : ''}<br>${esc(a.text)}${a.witnesses ? `<br><span style="color:#71717a">Svedoci: ${esc(a.witnesses)}</span>` : ''}</div>`).join('')) : ''}
${section('Plaćeno vreme', `${fmtHours(d.pay.paidMin)} · od toga noću ${fmtHours(d.pay.nightMin)}${d.pay.holidayMin ? ` · na praznik ${fmtHours(d.pay.holidayMin)}` : ''}`)}
<tr><td style="padding:16px 24px 22px;font-size:12px;color:#a1a1aa">Automatski izveštaj posle smene. PDF je u prilogu.</td></tr>
</table></td></tr></table></body></html>`;
}

// PDF Dnevnika rada (IBM Plex fontovi imaju sva slova: č, ć, š, ž, đ i ćirilicu)
function renderPdf(d) {
  const PDFDocument = require('pdfkit');
  const fonts = path.join(__dirname, '..', '..', 'assets', 'fonts');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 48, left: 48, right: 48 }, info: { Title: `Dnevnik rada ${d.facility.name} ${d.date}` } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('sans', path.join(fonts, 'IBMPlexSans-Regular.ttf'));
    doc.registerFont('bold', path.join(fonts, 'IBMPlexSans-SemiBold.ttf'));
    doc.registerFont('mono', path.join(fonts, 'IBMPlexMono-Regular.ttf'));
    const W = doc.page.width - 96;
    const label = (t) => { doc.moveDown(0.8); doc.font('mono').fontSize(8).fillColor('#71717a').text(t.toUpperCase(), { characterSpacing: 1 }); doc.moveDown(0.3); };
    const kv = (k, v) => {
      const y = doc.y;
      doc.font('sans').fontSize(10).fillColor('#71717a').text(k, 48, y, { width: 150 });
      doc.font('sans').fontSize(10).fillColor('#18181b').text(v || '-', 200, y, { width: W - 152 });
      doc.moveDown(0.2);
    };
    doc.rect(48, 40, W, 3).fill('#00b97c');
    doc.moveDown(0.6);
    doc.font('mono').fontSize(8).fillColor('#71717a').text('DNEVNIK RADA · ROBOTIK SECURITY', 48, 56, { characterSpacing: 1 });
    doc.font('bold').fontSize(20).fillColor('#18181b').text(d.facility.name, 48, 70);
    doc.font('sans').fontSize(10.5).fillColor('#52525b').text(`${d.date} · ${d.shiftLabel} · plan ${d.planned}${d.facility.address ? ` · ${d.facility.address}` : ''}`);
    label('Smena');
    kv('Smenu preuzeo', `${d.worker.name}${d.clockIn ? ` · prijava ${d.clockIn.time}${d.clockIn.lateMin ? `, kašnjenje ${d.clockIn.lateMin} min` : ''}` : ' · nema prijave'}`);
    kv('Smenu predao', d.clockOut ? `${d.worker.name} · odjava ${d.clockOut.time}${d.clockOut.early ? `, ${d.clockOut.earlyLeaveMin} min pre kraja` : ''}` : (d.noClockOut ? 'Radnik se nije odjavio' : '-'));
    kv('Smenu primio', d.receivedBy ? `${d.receivedBy.name} · prijava ${d.receivedBy.time}` : '-');
    kv('Preuzeta oprema', d.handover ? `Radio stanica: ${d.handover.radio || '-'} · ${(d.handover.items || []).join(', ') || '-'}` : '-');
    kv('Stanje opreme', d.handover ? (d.handover.condition === 'ok' ? 'Ispravna' : `Neispravna, oštećena${d.handover.note ? `: ${d.handover.note}` : ''}`) : '-');
    kv('Vanredni događaji', d.extraordinary);
    kv('Kontrola', d.review ? `${d.review.remark ? 'Primedba: DA' : 'Primedba: NE'} · ${d.review.byName}${d.review.note ? ` · ${d.review.note}` : ''}` : 'Čeka pregled koordinatora');
    label('Tekući događaji i zapažanja');
    if (!d.events.length) doc.font('sans').fontSize(10).fillColor('#a1a1aa').text('Nema zabeleženih događaja.');
    d.events.forEach((e) => {
      const y = doc.y;
      doc.font('mono').fontSize(9).fillColor('#71717a').text(e.time, 48, y, { width: 44 });
      doc.font('sans').fontSize(10).fillColor(e.kind === 'guard' ? '#18181b' : '#52525b').text(e.text, 96, y, { width: W - 48 });
      doc.moveDown(0.15);
    });
    label(`Obilazak · ${d.roundsDone} od ${d.rounds.length}`);
    if (!d.rounds.length) doc.font('sans').fontSize(10).fillColor('#a1a1aa').text('Objekat nema plan obilaska.');
    d.rounds.forEach((r) => {
      const y = doc.y;
      doc.font('mono').fontSize(9).fillColor('#71717a').text(r.due, 48, y, { width: 44 });
      const st = r.scanned ? `očitan ${r.scanned}${r.status === 'late' ? ` (${r.lateMin} min kasnije)` : ''}` : 'nije očitan';
      doc.font('sans').fontSize(10).fillColor(r.scanned ? '#18181b' : '#e5484d').text(`${r.tagName} · ${st}${r.snoozeReason ? ` · razlog: ${r.snoozeReason}` : ''}`, 96, y, { width: W - 48 });
      doc.moveDown(0.15);
    });
    label('Zadaci');
    const tasks = [...d.standing.map((t) => `${t.done ? '[x]' : '[ ]'} ${t.text}${t.comment ? ` · ${t.comment}` : ''}`), ...d.occasional.map((t) => `${t.done ? '[x]' : '[ ]'} ${t.due} ${t.text}${t.comment ? ` · ${t.comment}` : ''}`)];
    if (!tasks.length) doc.font('sans').fontSize(10).fillColor('#a1a1aa').text('Nema zadataka.');
    tasks.forEach((t) => { doc.font('sans').fontSize(10).fillColor('#18181b').text(t, 48, doc.y, { width: W }); doc.moveDown(0.1); });
    if (d.authority.length) {
      label('Primenjena ovlašćenja');
      d.authority.forEach((a) => {
        doc.font('bold').fontSize(10).fillColor('#18181b').text(`${a.time} · ${a.power}${a.subject ? ` · lice: ${a.subject}` : ''}`, 48, doc.y, { width: W });
        doc.font('sans').fontSize(10).fillColor('#18181b').text(a.text, { width: W });
        if (a.witnesses) doc.font('sans').fontSize(9).fillColor('#71717a').text(`Svedoci: ${a.witnesses}`, { width: W });
        doc.moveDown(0.3);
      });
    }
    label('Plaćeno vreme');
    doc.font('sans').fontSize(10).fillColor('#18181b').text(`${fmtHours(d.pay.paidMin)} · noću ${fmtHours(d.pay.nightMin)}${d.pay.holidayMin ? ` · na praznik ${fmtHours(d.pay.holidayMin)}` : ''} · ${rsd(d.pay.amount)}`, 48, doc.y, { width: W });
    doc.moveDown(1.2);
    doc.font('mono').fontSize(7.5).fillColor('#a1a1aa').text('Automatski izveštaj iz aplikacije Robotik. Vremena su iz NFC očitavanja.', 48, doc.y, { width: W });
    doc.end();
  });
}

async function sendShiftReport(shiftId, { to, reason = 'clock_out' } = {}) {
  const d = await buildReportData(shiftId);
  if (!d) return { sent: false, reason: 'not_found' };
  const recipients = to && to.length ? to : d.emails;
  const s = await getSettings();
  await SecurityShift.updateOne({ _id: shiftId }, { $inc: { 'report.attempts': 1 } });
  if (!recipients.length) {
    await SecurityShift.updateOne({ _id: shiftId }, { $set: { 'report.error': 'Objekat nema email adrese za izveštaj' } });
    return { sent: false, reason: 'no_recipients' };
  }
  const attachments = [];
  if (s.reports.attachPdf) {
    try {
      const pdf = await renderPdf(d);
      const slug = d.facility.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      attachments.push({ filename: `dnevnik-rada-${slug}-${d.date.replace(/\./g, '-').replace(/-$/, '')}.pdf`, content: pdf, contentType: 'application/pdf' });
    } catch (e) { console.error('[Security] PDF nije napravljen:', e.message); }
  }
  const subject = `Dnevnik rada · ${d.facility.name} · ${d.date} ${d.shiftLabel} · ${d.extraordinary === 'Nema' ? 'bez vanrednih događaja' : 'ima vanrednih događaja'}${d.noClockOut ? ' · bez odjave' : ''}`;
  const res = await sendMail({ to: recipients, subject, html: renderHtml(d), attachments });
  if (res.sent) {
    await SecurityShift.updateOne({ _id: shiftId }, { $set: { 'report.sentAt': new Date(), 'report.sentTo': res.to, 'report.error': '' } });
  } else {
    await SecurityShift.updateOne({ _id: shiftId }, { $set: { 'report.error': res.reason || 'Slanje nije uspelo' } });
  }
  return { ...res, reason: res.sent ? reason : res.reason };
}

module.exports = { buildReportData, renderHtml, renderPdf, sendShiftReport };
