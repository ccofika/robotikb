// Vreme u Srbiji (Europe/Belgrade: CET zimi, CEST leti).
// Server na Render-u radi u UTC-u, pa za srpsko vreme nikad ne koristiti lokalne
// getere servera (getHours, setHours, new Date(y, m, d)) ni fiksni pomak od +1h/+2h.
const TZ = 'Europe/Belgrade';

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit'
});

function partsOf(date) {
  const p = {};
  partsFormat.formatToParts(date).forEach(x => { p[x.type] = x.value; });
  return p;
}

// Pomak zone u minutima za dati trenutak (+60 zimi, +120 leti)
function belgradeOffsetMinutes(date) {
  const p = partsOf(date);
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

// 'YYYY-MM-DD' + 'HH:mm' zidnog vremena u Srbiji -> pravi trenutak (Date).
// Druga provera pomaka pokriva noći pomeranja sata.
function localToInstant(ymd, hhmm = '00:00') {
  const [y, m, d] = ymd.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const firstOffset = belgradeOffsetMinutes(new Date(guess));
  const instant = new Date(guess - firstOffset * 60000);
  const secondOffset = belgradeOffsetMinutes(instant);
  return secondOffset === firstOffset ? instant : new Date(guess - secondOffset * 60000);
}

// Kalendarski dan u Srbiji ('YYYY-MM-DD') za dati trenutak
function belgradeYmd(date = new Date()) {
  const p = partsOf(date instanceof Date ? date : new Date(date));
  return `${p.year}-${p.month}-${p.day}`;
}

// Sat (0-23) i dan u nedelji (0 = nedelja) po srpskom vremenu
const belgradeHour = (date) => +partsOf(new Date(date)).hour % 24;
const belgradeDayOfWeek = (date) => new Date(`${belgradeYmd(date)}T00:00:00Z`).getUTCDay();

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Datum iz filtera: 'YYYY-MM-DD' ili ISO trenutak (npr. lokalna ponoć iz browsera) -> dan u Srbiji
function toBelgradeYmd(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return belgradeYmd(new Date(value));
}

// Celi dani po srpskom vremenu, oba kraja uključena: od 00:00 prvog do 23:59:59.999 poslednjeg dana.
// Radi i za polja sa ponoći UTC (WorkOrder.date) jer je to isti kalendarski dan u Srbiji.
function belgradeDayRange(from, to) {
  const fromYmd = toBelgradeYmd(from);
  const toYmd = toBelgradeYmd(to);
  return {
    start: localToInstant(fromYmd),
    end: new Date(localToInstant(addDaysYmd(toYmd, 1)).getTime() - 1),
    fromYmd,
    toYmd
  };
}

// Ceo mesec po srpskom vremenu u kome je dati trenutak: od 1. u 00:00 do kraja poslednjeg dana
function belgradeMonthRange(date = new Date()) {
  const [y, m] = belgradeYmd(date).split('-').map(Number);
  const firstOfNext = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return {
    start: localToInstant(`${y}-${String(m).padStart(2, '0')}-01`),
    end: new Date(localToInstant(firstOfNext).getTime() - 1)
  };
}

// Zidno vreme bez zone ('YYYY-MM-DDTHH:mm' iz forme) ili ISO sa zonom -> pravi trenutak.
// Sam datum je početak tog dana u Srbiji, a sa { endOfDay: true } njegov kraj (za "do" u filterima).
function parseBelgradeDateTime(value, { endOfDay = false } = {}) {
  const match = typeof value === 'string' &&
    value.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::(\d{2})(\.\d+)?)?)?$/);
  if (!match) return new Date(value);
  if (!match[2] && endOfDay) return new Date(localToInstant(addDaysYmd(match[1], 1)).getTime() - 1);
  const seconds = Number(match[3] || 0) + Number(match[4] || 0);
  return new Date(localToInstant(match[1], match[2] || '00:00').getTime() + Math.round(seconds * 1000));
}

module.exports = {
  TZ, belgradeOffsetMinutes, localToInstant, belgradeYmd, belgradeHour, belgradeDayOfWeek, addDaysYmd,
  toBelgradeYmd, belgradeDayRange, belgradeMonthRange, parseBelgradeDateTime
};
