// Smene: plan obilaska, provera preklapanja i odmora, nazivi
const SecurityShift = require('../../models/SecurityShift');
const NfcTag = require('../../models/NfcTag');
const { planTimeInShift, instantToLocal, fmtDateSr } = require('./time');

const REST_MIN = 12 * 60; // Zakon o radu, čl. 66: najmanje 12 h odmora u toku 24 časa

const TYPE_LABEL = { day: 'Dnevna', night: 'Noćna' };

function shiftLabel(shift, settings) {
  const a = instantToLocal(shift.plannedStart).hhmm.slice(0, 2);
  const b = instantToLocal(shift.plannedEnd).hhmm.slice(0, 2);
  return `${TYPE_LABEL[shift.type] || 'Smena'} ${a}-${b}`;
}

function shiftSpanText(shift) {
  const a = instantToLocal(shift.plannedStart);
  const b = instantToLocal(shift.plannedEnd);
  return `${fmtDateSr(a.ymd)} ${a.hhmm} - ${b.ymd !== a.ymd ? fmtDateSr(b.ymd) + ' ' : ''}${b.hhmm}`;
}

// Plan obilaska objekta pretvoren u konkretne tačke za ovu smenu
async function buildRounds(shift, facility, settings) {
  const plan = ((facility && facility.roundPlan && facility.roundPlan[shift.type]) || []).slice();
  if (!plan.length) return [];
  const tags = await NfcTag.find({ _id: { $in: plan.map((p) => p.tagId) }, status: 'active' }).select('name');
  const byId = new Map(tags.map((t) => [t._id.toString(), t]));
  const rounds = [];
  for (const p of plan) {
    const tag = byId.get(String(p.tagId));
    if (!tag) continue;
    const dueAt = planTimeInShift(shift.date, shift.type, p.time, settings);
    if (dueAt < shift.plannedStart || dueAt > shift.plannedEnd) continue;
    rounds.push({ tagId: tag._id, tagName: tag.name, dueAt });
  }
  rounds.sort((x, y) => x.dueAt - y.dueAt);
  return rounds;
}

// Da li radnik u tom periodu već ima smenu (na bilo kom objektu) i koliko odmora ostaje
async function checkConflicts({ workerId, start, end, excludeId }) {
  const q = { workerId, status: { $ne: 'cancelled' } };
  if (excludeId) q._id = { $ne: excludeId };
  const around = await SecurityShift.find({
    ...q,
    plannedStart: { $lt: new Date(end.getTime() + REST_MIN * 60000) },
    plannedEnd: { $gt: new Date(start.getTime() - REST_MIN * 60000) }
  }).populate('facilityId', 'name');

  const overlap = around.find((s) => s.plannedStart < end && start < s.plannedEnd) || null;
  const rest = [];
  for (const s of around) {
    if (overlap && s._id.equals(overlap._id)) continue;
    if (s.plannedEnd <= start) {
      const gap = Math.round((start - s.plannedEnd) / 60000);
      if (gap < REST_MIN) rest.push({ shift: s, gapMin: gap, side: 'before' });
    } else if (s.plannedStart >= end) {
      const gap = Math.round((s.plannedStart - end) / 60000);
      if (gap < REST_MIN) rest.push({ shift: s, gapMin: gap, side: 'after' });
    }
  }
  return { overlap, rest };
}

function describeConflict(conf, workerName) {
  if (conf.overlap) {
    const o = conf.overlap;
    return {
      code: 'overlap',
      message: `${workerName} je u to vreme na objektu ${o.facilityId ? o.facilityId.name : ''} (${shiftSpanText(o)}). Radnik ne može biti na dva objekta u isto vreme.`
    };
  }
  if (conf.rest.length) {
    const parts = conf.rest.map((r) => {
      const h = Math.floor(r.gapMin / 60), m = r.gapMin % 60;
      const gap = h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
      return `${r.side === 'before' ? 'posle smene' : 'pre smene'} ${shiftSpanText(r.shift)} ostaje samo ${gap} odmora`;
    });
    return { code: 'rest', message: `${workerName}: ${parts.join(', a ')}. Zakon traži najmanje 12 h odmora.` };
  }
  return null;
}

module.exports = { REST_MIN, TYPE_LABEL, shiftLabel, shiftSpanText, buildRounds, checkConflicts, describeConflict };
