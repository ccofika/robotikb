// Vreme za Security modul: sve se čuva kao UTC trenutak, a računa po zidnom vremenu u Srbiji.
// Server (Render) radi u UTC-u, pa nikad ne koristimo lokalnu zonu servera.
const TZ = 'Europe/Belgrade';

const pad = (n) => String(n).padStart(2, '0');

function partsOf(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
  });
  const p = {};
  fmt.formatToParts(date).forEach((x) => { p[x.type] = x.value; });
  return p;
}

// Offset zone Europe/Belgrade u minutima za dati trenutak (+60 zimi, +120 leti)
function belgradeOffsetMinutes(date) {
  const p = partsOf(date);
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
  return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

// 'YYYY-MM-DD' + 'HH:mm' (zidno vreme u Srbiji) -> Date (UTC trenutak)
function localToInstant(ymd, hhmm) {
  const [y, m, d] = ymd.split('-').map(Number);
  const [h, mi] = (hhmm || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi, 0, 0);
  const off1 = belgradeOffsetMinutes(new Date(guess));
  let inst = new Date(guess - off1 * 60000);
  const off2 = belgradeOffsetMinutes(inst);
  if (off2 !== off1) inst = new Date(guess - off2 * 60000);
  return inst;
}

// Date -> { ymd, hhmm, dow (0=ned), minutes (od ponoći) } po vremenu u Srbiji
function instantToLocal(date) {
  const d = date instanceof Date ? date : new Date(date);
  const p = partsOf(d);
  const hour = (+p.hour) % 24;
  const dows = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    ymd: `${p.year}-${p.month}-${p.day}`,
    hhmm: `${pad(hour)}:${p.minute}`,
    dow: dows[p.weekday],
    minutes: hour * 60 + (+p.minute)
  };
}

function addDaysYmd(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

function todayYmd(now = new Date()) { return instantToLocal(now).ymd; }

// Ponedeljak nedelje u kojoj je ymd
function weekStartYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDaysYmd(ymd, dow === 0 ? -6 : 1 - dow);
}

function minutesToHHMM(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

function hhmmToMinutes(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Plan smene: dnevna od dayStart do nightStart istog dana, noćna od nightStart do dayStart sledećeg dana
function shiftWindow(ymd, type, settings) {
  const dayStart = (settings && settings.dayStart) || '07:00';
  const nightStart = (settings && settings.nightStart) || '19:00';
  if (type === 'night') {
    return { start: localToInstant(ymd, nightStart), end: localToInstant(addDaysYmd(ymd, 1), dayStart) };
  }
  return { start: localToInstant(ymd, dayStart), end: localToInstant(ymd, nightStart) };
}

// Vreme iz plana obilaska (HH:mm) pretvara u trenutak unutar smene.
// Za noćnu smenu, vreme pre početka smene (npr. 01:00) pripada sledećem danu.
function planTimeInShift(ymd, type, hhmm, settings) {
  const nightStart = hhmmToMinutes((settings && settings.nightStart) || '19:00');
  const t = hhmmToMinutes(hhmm);
  if (type === 'night' && t < nightStart) return localToInstant(addDaysYmd(ymd, 1), hhmm);
  return localToInstant(ymd, hhmm);
}

// Pravoslavni Uskrs (julijanski računar + 13 dana, važi 1900-2099)
function orthodoxEaster(year) {
  const a = year % 4, b = year % 7, c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const julian = new Date(Date.UTC(year, month - 1, day));
  julian.setUTCDate(julian.getUTCDate() + 13);
  return `${julian.getUTCFullYear()}-${pad(julian.getUTCMonth() + 1)}-${pad(julian.getUTCDate())}`;
}

// Državni praznici u Srbiji (neradni dani); ako praznik padne u nedelju, radi se i u ponedeljak
function serbianHolidays(year) {
  const fixed = [
    [`${year}-01-01`, `${year}-01-02`, 'Nova godina'],
    [`${year}-01-07`, null, 'Božić'],
    [`${year}-02-15`, `${year}-02-16`, 'Sretenje'],
    [`${year}-05-01`, `${year}-05-02`, 'Praznik rada'],
    [`${year}-11-11`, null, 'Dan primirja'],
  ];
  const out = [];
  const dowOf = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
  for (const [a, b, name] of fixed) {
    out.push({ date: a, name });
    if (b) out.push({ date: b, name });
    const last = b || a;
    if (dowOf(a) === 0 || (b && dowOf(b) === 0)) out.push({ date: addDaysYmd(last, 1), name: `${name} (prenos)` });
  }
  const easter = orthodoxEaster(year);
  out.push({ date: addDaysYmd(easter, -2), name: 'Veliki petak' });
  out.push({ date: addDaysYmd(easter, -1), name: 'Velika subota' });
  out.push({ date: easter, name: 'Vaskrs' });
  out.push({ date: addDaysYmd(easter, 1), name: 'Vaskršnji ponedeljak' });
  return out;
}

function fmtDateSr(ymd) {
  const [y, m, d] = ymd.split('-');
  return `${d}.${m}.${y}.`;
}

module.exports = {
  TZ, belgradeOffsetMinutes, localToInstant, instantToLocal, addDaysYmd, todayYmd, weekStartYmd,
  minutesToHHMM, hhmmToMinutes, shiftWindow, planTimeInShift, orthodoxEaster, serbianHolidays, fmtDateSr
};
