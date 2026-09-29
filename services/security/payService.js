// Satnica: plaćeno vreme iz NFC prijave/odjave, noćni sati (22-06) i praznici
const SecurityShift = require('../../models/SecurityShift');
const SecurityWorker = require('../../models/SecurityWorker');
const { localToInstant, addDaysYmd, serbianHolidays } = require('./time');

const overlapMin = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1)) / 60000;

// Plaćeno vreme ide od kasnijeg (plan ili prijava) do ranijeg (plan ili odjava).
// Rani dolazak se ne plaća, a kašnjenje i rana odjava umanjuju sate.
function paidInterval(shift, now = new Date()) {
  if (!shift.clockIn || !shift.clockIn.at) return null;
  const start = Math.max(shift.plannedStart.getTime(), new Date(shift.clockIn.at).getTime());
  const endRaw = shift.clockOut && shift.clockOut.at ? new Date(shift.clockOut.at).getTime() : Math.min(now.getTime(), shift.plannedEnd.getTime());
  const end = Math.min(shift.plannedEnd.getTime(), endRaw);
  return end > start ? [start, end] : null;
}

function holidaySetFor(years) {
  const set = new Map();
  for (const y of years) serbianHolidays(y).forEach((h) => set.set(h.date, h.name));
  return set;
}

// Minuti ukupno / noću / na praznik za jednu smenu
function shiftMinutes(shift, holidays, now = new Date()) {
  const iv = paidInterval(shift, now);
  if (!iv) return { paidMin: 0, nightMin: 0, holidayMin: 0 };
  const [a, b] = iv;
  const paidMin = Math.round((b - a) / 60000);
  let nightMin = 0, holidayMin = 0;
  for (let k = -1; k <= 1; k++) {
    const d = addDaysYmd(shift.date, k);
    const n1 = localToInstant(d, '22:00').getTime();
    const n2 = localToInstant(addDaysYmd(d, 1), '06:00').getTime();
    nightMin += overlapMin(a, b, n1, n2);
    if (holidays.has(d)) {
      holidayMin += overlapMin(a, b, localToInstant(d, '00:00').getTime(), localToInstant(addDaysYmd(d, 1), '00:00').getTime());
    }
  }
  return { paidMin, nightMin: Math.round(nightMin), holidayMin: Math.round(holidayMin) };
}

function payFor(mins, rate, pay) {
  const base = (mins.paidMin / 60) * rate;
  const night = (mins.nightMin / 60) * rate * (pay.nightPct / 100);
  const holiday = (mins.holidayMin / 60) * rate * (pay.holidayPct / 100);
  return { base, night, holiday, total: base + night + holiday };
}

// Mesečni obračun po radniku. scope = null (svi objekti) ili niz id-jeva objekata.
async function computeTimesheet({ month, scope = null, settings }) {
  const [y, m] = month.split('-').map(Number);
  const from = localToInstant(`${month}-01`, '00:00');
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const to = localToInstant(`${nextMonth}-01`, '00:00');
  const q = { plannedStart: { $gte: from, $lt: to }, status: { $ne: 'cancelled' } };
  if (scope) q.facilityId = { $in: scope };
  const shifts = await SecurityShift.find(q).populate('facilityId', 'name').lean();
  const holidays = holidaySetFor([y, y + (m === 12 ? 1 : 0)]);
  const workerIds = [...new Set(shifts.map((s) => String(s.workerId)))];
  const workers = await SecurityWorker.find({ _id: { $in: workerIds } }).select('name hourlyRate role').lean();
  const wMap = new Map(workers.map((w) => [String(w._id), w]));
  const pay = settings.pay;
  const rows = new Map();
  const now = new Date();

  for (const s of shifts) {
    const w = wMap.get(String(s.workerId));
    if (!w) continue;
    const key = String(s.workerId);
    if (!rows.has(key)) {
      rows.set(key, {
        workerId: key, name: w.name, rate: w.hourlyRate != null ? w.hourlyRate : pay.defaultRate, customRate: w.hourlyRate != null,
        facilities: new Set(), planned: 0, done: 0, active: 0, missed: 0, late: 0, lateMin: 0,
        paidMin: 0, nightMin: 0, holidayMin: 0
      });
    }
    const r = rows.get(key);
    if (s.facilityId) r.facilities.add(s.facilityId.name);
    r.planned++;
    if (s.status === 'done') r.done++;
    if (s.status === 'active') r.active++;
    if (s.status === 'missed') r.missed++;
    if (s.lateMin > 0) { r.late++; r.lateMin += s.lateMin; }
    if (s.status === 'done') {
      const mins = shiftMinutes(s, holidays, now);
      r.paidMin += mins.paidMin; r.nightMin += mins.nightMin; r.holidayMin += mins.holidayMin;
    }
  }

  const list = [...rows.values()].map((r) => {
    const p = payFor(r, r.rate, pay);
    return { ...r, facilities: [...r.facilities], basePay: p.base, nightPay: p.night, holidayPay: p.holiday, total: p.total };
  }).sort((a, b) => a.name.localeCompare(b.name, 'sr'));

  const totals = list.reduce((t, r) => ({
    paidMin: t.paidMin + r.paidMin, nightMin: t.nightMin + r.nightMin, holidayMin: t.holidayMin + r.holidayMin,
    total: t.total + r.total, done: t.done + r.done
  }), { paidMin: 0, nightMin: 0, holidayMin: 0, total: 0, done: 0 });

  const monthHolidays = [...holidays.entries()].filter(([d]) => d.startsWith(month)).map(([date, name]) => ({ date, name }));
  return { month, rows: list, totals, pay, holidays: monthHolidays };
}

module.exports = { paidInterval, shiftMinutes, payFor, holidaySetFor, computeTimesheet };
