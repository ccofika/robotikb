// Montaža (ne-Security deo Robotika): realistični TEST podaci za LOKALNI pre-prod, da se sve stranice Montaže
// mogu proveriti (tabele, svi statusi, modali): tehničari, oprema, materijal, osnovna oprema, korisnici, radni
// nalozi (60 dana unazad i 7 unapred), finansije, vozila, GPS, logovi, obaveštenja, ocene i kontakti.
//
// Sve je obeleženo: tehničari "TEST ...", korisnici "TEST ..." sa tisId "TEST-...", serijski brojevi "test-..."
// (aplikacija ih čuva malim slovima), materijal, osnovna oprema i vozila "TEST ...", adrese naloga "TEST ...".
// Logovi bez takve veze (backend greške i performanse, admin aktivnosti) imaju metadata.userAgent = SEED_UA.
// --reset i --only-reset brišu SAMO te zapise i ono što je vezano za njih; Security kolekcije i nalozi
// E2E Admin / E2E Superadmin / E2E Tehnicar se ne diraju.
//
// Upotreba:
//   node montaza-seed.js --reset         obriše prethodne TEST podatke i ubaci nove (isto stanje svaki put)
//   node montaza-seed.js --only-reset    samo obriše TEST podatke
//   node montaza-seed.js --e2e --reset   isto, u bazi robotik_preprod_security_e2e (instanca za testove)
// Bez --reset skripta staje ako TEST podaci već postoje.
// Piše SAMO u mongodb://127.0.0.1:27118/robotik_preprod_security(_e2e). Nalozi E2E Admin i E2E Superadmin moraju
// postojati (security.sh seed). Lozinka svih TEST naloga: Preprod123!
const path = require('path');
const fs = require('fs');

// Koren projekta: preprod-security je u <koren>/preprod-security ili u <koren>/.wt/robotikb/preprod-security
const PRE_DIR = path.resolve(__dirname, '..');
const ROOT = fs.existsSync(path.join(PRE_DIR, '..', '.wt', 'robotikb')) ? path.resolve(PRE_DIR, '..') : path.resolve(PRE_DIR, '..', '..', '..');
const B = path.join(ROOT, '.wt', 'robotikb');
const { DB_RE } = require('./instance');

const ARGS = process.argv.slice(2);
const KNOWN = ['--reset', '--only-reset', '--e2e'];
if (ARGS.some((a) => !KNOWN.includes(a))) {
  console.error(`[montaza-seed] nepoznat argument: ${ARGS.filter((a) => !KNOWN.includes(a)).join(' ')} (dozvoljeno: ${KNOWN.join(' ')})`);
  process.exit(1);
}
const ONLY_RESET = ARGS.includes('--only-reset');
const RESET = ONLY_RESET || ARGS.includes('--reset');
const DB_NAME = ARGS.includes('--e2e') ? 'robotik_preprod_security_e2e' : 'robotik_preprod_security';
// URI je upisan ovde, nikad iz env-a ni iz .env fajla (27017 je tunel ka produkciji drugog projekta)
const URI = `mongodb://127.0.0.1:27118/${DB_NAME}`;
if (!DB_RE.test(URI) || !URI.startsWith('mongodb://127.0.0.1:27118/')) {
  console.error(`[montaza-seed] STOP: ${URI} nije lokalna pre-prod baza`);
  process.exit(1);
}

const req = (m) => require(require.resolve(m, { paths: [B] }));
const mongoose = req('mongoose');
const bcrypt = req('bcrypt');
const { localToInstant, belgradeYmd, addDaysYmd } = require(path.join(B, 'utils', 'belgradeTime'));
const model = (n) => require(path.join(B, 'models', n));
const Technician = model('Technician');
const Material = model('Material');
const BasicEquipment = model('BasicEquipment');
const Equipment = model('Equipment');
const User = model('User');
const WorkOrder = model('WorkOrder');
const WorkOrderEvidence = model('WorkOrderEvidence');
const Log = model('Log');
const AdminActivityLog = model('AdminActivityLog');
const ErrorLog = model('ErrorLog');
const PerformanceLog = model('PerformanceLog');
const Notification = model('Notification');
const FinancialSettings = model('FinancialSettings');
const FinancialTransaction = model('FinancialTransaction');
const FailedFinancialTransaction = model('FailedFinancialTransaction');
const Vehicle = model('Vehicle');
const TechnicianLocation = model('TechnicianLocation');
const Review = model('Review');
const SupportCall = model('SupportCall');
const ContactEvent = model('ContactEvent');

const PASSWORD = 'Preprod123!';
const SEED_UA = 'TEST seed (montaza-seed.js)';
const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ---------- pomoćne funkcije ----------
// Deterministički generator: isto stanje pri svakom pokretanju (datumi su relativni u odnosu na danas)
let prng = 20261108;
const rnd = () => {
  prng = (prng + 0x6D2B79F5) | 0;
  let t = Math.imul(prng ^ (prng >>> 15), 1 | prng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const weighted = (pairs) => {
  let x = rnd() * pairs.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of pairs) { x -= w; if (x < 0) return v; }
  return pairs[pairs.length - 1][0];
};
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const oid = () => new mongoose.Types.ObjectId();
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

const NOW = new Date();
const TODAY = belgradeYmd(NOW);
const ymd = (offset) => addDaysYmd(TODAY, offset);
const at = (dayYmd, hhmm) => localToInstant(dayYmd, hhmm); // zidno vreme u Srbiji -> trenutak
const dateOnly = (dayYmd) => new Date(`${dayYmd}T00:00:00.000Z`); // kao <input type="date">: ponoć UTC
const add = (d, ms) => new Date(d.getTime() + ms);
const notAfterNow = (d, slackMin = 2) => (d < NOW ? d : new Date(NOW.getTime() - slackMin * MIN));
const maxDate = (...ds) => new Date(Math.max(...ds.filter(Boolean).map((d) => d.getTime())));
const nextFullHour = (d) => new Date(Math.ceil(d.getTime() / HOUR) * HOUR);
const dayOffsetOf = (d) => Math.round((Date.parse(belgradeYmd(d)) - Date.parse(TODAY)) / DAY);

// ---------- katalozi ----------
const TECHS = [
  // until: ugovor ističe za N dana; from: od kog dana (relativno) nije aktivan / obrisan
  { key: 'nikola', name: 'TEST Nikola Ilic', phone: '064 555 0101', gmail: 'nikola.ilic.test@gmail.com', team: 'robotik', until: 210, since: -420 },
  { key: 'marko', name: 'TEST Marko Jovanović', phone: '063 555 0102', gmail: 'marko.jovanovic.test@gmail.com', team: 'robotik', until: 24, since: -365 },
  { key: 'stefan', name: 'TEST Stefan Petrović', phone: '065 555 0103', team: 'robotik', until: null, since: -300 },
  { key: 'milos', name: 'TEST Miloš Kovačević', phone: '064 555 0104', gmail: 'milos.kovacevic.test@gmail.com', team: 'robotik', until: 150, since: -260, pay: 'plata', salary: 95000 },
  { key: 'djordje', name: 'TEST Đorđe Lukić', phone: '062 555 0105', gmail: 'djordje.lukic.test@gmail.com', team: 'mtel', until: 300, since: -240 },
  { key: 'nemanja', name: 'TEST Nemanja Pavlović', phone: '061 555 0106', team: 'mtel', until: 8, since: -200 },
  { key: 'uros', name: 'TEST Uroš Marković', phone: '060 555 0107', team: 'mtel', until: -12, since: -330, inactiveFrom: -12 },
  { key: 'dejan', name: 'TEST Dejan Stanković', phone: '064 555 0108', gmail: 'dejan.stankovic.test@gmail.com', team: 'robotik', until: 90, since: -280, deletedFrom: -9 },
];
const ROBOTIK = ['nikola', 'marko', 'stefan', 'milos', 'dejan'];
const MTEL = ['djordje', 'nemanja', 'uros'];
const ASTRA_TECHS = ['nikola', 'marko', 'stefan'];
// "Čist" nalog za pregled tehničarskog weba: bez prekoračenih naloga i bez opreme koja čeka potvrdu
const CLEAN_TECH = 'nikola';

const MATERIALS = [
  ['rg6', 'TEST Koaksijalni kabl RG6 (m)', 3000, 250],
  ['drop', 'TEST Optički drop kabl 1F (m)', 2600, 250],
  ['utp', 'TEST UTP kabl Cat6 (m)', 1500, 150],
  ['fkon', 'TEST F konektor', 1500, 80],
  ['sckon', 'TEST SC/APC konektor', 800, 30],
  ['sp2', 'TEST Spliter 1/2', 200, 8],
  ['sp4', 'TEST Spliter 1/4', 120, 6],
  ['kan', 'TEST PVC kanalica 20x10 (m)', 900, 80],
  ['tipl', 'TEST Tiplovi 6 mm', 4000, 400],
  ['vez', 'TEST Vezice 200 mm', 6000, 500],
  ['roz', 'TEST Optička rozeta', 220, 15],
  ['patch', 'TEST Patch kabl SC/APC 1 m', 300, 15],
]; // ključ, naziv, početno stanje u magacinu, pakovanje pri dopuni tehničaru

const BASIC = [
  ['merd', 'TEST Merdevine aluminijumske 3 m', 14, 8900],
  ['busi', 'TEST Bušilica Bosch GBH 2-26', 10, 15500],
  ['merac', 'TEST Optički merač snage', 6, 31000],
  ['set', 'TEST Set alata za montažu', 16, 6400],
  ['tester', 'TEST Tester koaksijalnog kabla', 8, 12500],
  ['kaciga', 'TEST Zaštitna kaciga i prsluk', 25, 2400],
];

const MODELS = {
  'HFC Modem': ['Technicolor TC4400', 'Arris TG3442', 'Hitron CODA-4582'],
  'GPON Modem': ['Huawei HG8245H', 'ZTE F670L', 'Nokia G-240W-F'],
  'STB': ['Kaon NA1170', 'Amino A140'],
  'Cam Modul': ['Neotion CI+ CAM'],
  'Smart Card': ['Nagravision smart kartica'],
  'Hybrid': ['EON Smart Box Hybrid'],
  'OTT tv po tvom': ['EON Smart Box OTT'],
  'M-HFC Modem': ['Arris TG2492'],
  'M-GPON Modem': ['Huawei EG8145V5'],
  'M-STB': ['Kaon KSTB6077'],
  'M-Cam Modul': ['SmarDTV CI+ CAM'],
  'M-Smart Card': ['Irdeto smart kartica'],
  'Astra Antena': ['Ubiquiti LiteBeam 5AC Gen2'],
  'Astra Ruter': ['MikroTik hAP ac2'],
  'Astra Stb': ['Formuler Z11 Pro'],
};
const CODES = {
  'HFC Modem': 'hfc', 'GPON Modem': 'gpon', 'STB': 'stb', 'Cam Modul': 'cam', 'Smart Card': 'sc', 'Hybrid': 'hyb',
  'OTT tv po tvom': 'ott', 'M-HFC Modem': 'mhfc', 'M-GPON Modem': 'mgpon', 'M-STB': 'mstb', 'M-Cam Modul': 'mcam',
  'M-Smart Card': 'msc', 'Astra Antena': 'aant', 'Astra Ruter': 'arut', 'Astra Stb': 'astb',
};
// Početni komplet opreme po timu (zaduženje pre perioda naloga)
const STARTER = {
  robotik: ['HFC Modem', 'GPON Modem', 'Hybrid', 'STB', 'Smart Card'],
  mtel: ['M-HFC Modem', 'M-GPON Modem', 'M-STB', 'M-Smart Card'],
  astra: ['Astra Antena', 'Astra Ruter'],
};

// Kopija mapiranja iz routes/userEquipment.js (kategorija -> tip u evidenciji naloga)
const evidenceType = (category) => {
  const c = (category || '').toLowerCase().trim();
  const direct = { ont: 'ONT/HFC', hfc: 'ONT/HFC', 'ont/hfc': 'ONT/HFC', hybrid: 'Hybrid', stb: 'STB/CAM', cam: 'STB/CAM', 'stb/cam': 'STB/CAM', kartica: 'Kartica', 'mini node': 'Mini node', mininode: 'Mini node', modem: 'ONT/HFC', router: 'Hybrid', telefon: 'STB/CAM', tv: 'STB/CAM', decoder: 'STB/CAM' };
  if (direct[c]) return direct[c];
  if (c.includes('ont') || c.includes('hfc') || c.includes('modem')) return 'ONT/HFC';
  if (c.includes('hybrid') || c.includes('router')) return 'Hybrid';
  if (c.includes('stb') || c.includes('cam') || c.includes('tv') || c.includes('decoder')) return 'STB/CAM';
  if (c.includes('kartica') || c.includes('card')) return 'Kartica';
  if (c.includes('mini') || c.includes('node')) return 'Mini node';
  return 'ONT/HFC';
};

const CS = {
  hfcZgrada: 'Priključenje korisnika na HFC KDS mreža u zgradi sa instalacijom CPE opreme (izrada kompletne instalacije od RO do korisnika sa instalacijom kompletne CPE opreme) sa isporukom materijala',
  hfcKuca: 'Priključenje korisnika na HFC KDS mreža u privatnim kućama sa instalacijom CPE opreme (izrada instalacije od PM-a do korisnika sa instalacijom kompletne CPE opreme) sa isporukom materijala',
  gponKuca: 'Priključenje korisnika na GPON mrežu u privatnim kućama (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme) sa isporukom materijala',
  gponZgrada: 'Priključenje korisnika na GPON mrežu u zgradi (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme) sa isporukom materijala',
  saMontazom: 'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji sa montažnim radovima sa isporukom materijala',
  bezMontaze: 'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji bez montažnih radova sa isporukom materijala',
  nov: 'Nov korisnik',
  astraWifi: 'Priključenje novog korisnika WiFi tehnologijom (postavljanje nosača antene, postavljanje i usmeravanje antene ka baznoj stanici sa postavljanjem napajanja za antenu, postavljanje rutera i jednog uređaja za televiziju) - ASTRA TELEKOM',
  astraDodavanje: 'Dodavanje drugog uređaja ili dorada - ASTRA TELEKOM',
  astraDemontaza: 'Demontaža postojeće opreme kod korisnika (po korisniku) - ASTRA TELEKOM',
  astraIntervencija: 'Intervencija kod korisnika - ASTRA TELEKOM',
  astraGpon: 'Priključenje korisnika GPON tehnologijom (povezivanje svih uređaja u okviru paketa) - ASTRA TELEKOM',
};
// Cene firme (RSD) i udeo tehničara
const PRICES = { hfcZgrada: 4200, hfcKuca: 5400, gponKuca: 7800, gponZgrada: 6600, saMontazom: 2600, bezMontaze: 1700, nov: 3000, astraWifi: 6200, astraDodavanje: 1500, astraDemontaza: 1100, astraIntervencija: 1600, astraGpon: 6900 };
const TECH_SHARE = { nikola: 0.52, marko: 0.5, stefan: 0.45, milos: 0.5, djordje: 0.5, nemanja: 0.46, uros: 0.45, dejan: 0.48 };
const DISCOUNTS = { 'SURČIN': 10, 'BORČA': 5, 'KRNJAČA': 5 }; // ostale opštine 0%, jedna manja opština namerno bez popusta (čeka potvrdu)

// Opštine (Područje kao u TIS izvozu), ulice, udeo kuća, težina i približne koordinate
const AREAS = [
  ['NOVI BEOGRAD', ['JURIJA GAGARINA', 'BULEVAR MIHAJLA PUPINA', 'GANDIJEVA', 'NEHRUOVA', 'OMLADINSKIH BRIGADA'], 0, 14, [44.8125, 20.417]],
  ['ZEMUN', ['UGRINOVAČKA', 'CARA DUŠANA', 'PRVOMAJSKA', 'GLAVNA'], 0.4, 12, [44.843, 20.4011]],
  ['VOŽDOVAC', ['VOJVODE STEPE', 'USTANIČKA', 'KUMODRAŠKA', 'BULEVAR OSLOBOĐENJA'], 0.3, 11, [44.77, 20.48]],
  ['ZVEZDARA', ['BULEVAR KRALJA ALEKSANDRA', 'VOLGINA', 'MITE RUŽIĆA', 'DIMITRIJA TUCOVIĆA'], 0.3, 11, [44.795, 20.508]],
  ['PALILULA', ['TAKOVSKA', 'MIJE KOVAČEVIĆA', 'VIŠNJIČKA', 'BULEVAR DESPOTA STEFANA'], 0.2, 10, [44.816, 20.488]],
  ['ČUKARICA', ['POŽEŠKA', 'RADNIČKA', 'VLADIMIRA RADOVANOVIĆA', 'TRGOVAČKA'], 0.4, 9, [44.783, 20.414]],
  ['RAKOVICA', ['PATRIJARHA DIMITRIJA', 'KRALJICE JELENE', 'PERE VELIMIROVIĆA'], 0.5, 7, [44.745, 20.44]],
  ['BORČA', ['OBROVAČKA', 'BRATSTVA I JEDINSTVA', 'ZRENJANINSKI PUT', 'IVANA MILUTINOVIĆA'], 1, 9, [44.87, 20.463]],
  ['KRNJAČA', ['PANČEVAČKI PUT', 'DUNAVSKIH PARTIZANA'], 1, 5, [44.859, 20.488]],
  ['SURČIN', ['VOJVOĐANSKA', 'MAJORA ZORANA RADOSAVLJEVIĆA'], 1, 4, [44.793, 20.28]],
  ['GROCKA', ['BULEVAR OSLOBOĐENJA', 'SMEDEREVSKI PUT'], 1, 2, [44.672, 20.718]],
  ['MIRIJEVO', ['MATEJE BANA', 'MIRIJEVSKI VENAC'], 0, 6, [44.793, 20.532]],
];
const FIRST = ['MILAN', 'NIKOLA', 'DRAGAN', 'ZORAN', 'DEJAN', 'IVAN', 'MARKO', 'LAZAR', 'VLADIMIR', 'GORAN', 'NENAD', 'BOJAN', 'SRĐAN', 'ALEKSANDAR', 'MILOŠ', 'JELENA', 'MILICA', 'IVANA', 'SNEŽANA', 'DRAGANA', 'MARIJA', 'ANA', 'TIJANA', 'JOVANA', 'SANJA', 'BRANKA', 'MIRJANA', 'KATARINA', 'VESNA'];
const LAST = ['JOVANOVIĆ', 'PETROVIĆ', 'NIKOLIĆ', 'MARKOVIĆ', 'ĐORĐEVIĆ', 'STOJANOVIĆ', 'ILIĆ', 'STANKOVIĆ', 'PAVLOVIĆ', 'MILOŠEVIĆ', 'TODOROVIĆ', 'KOSTIĆ', 'POPOVIĆ', 'ŽIVKOVIĆ', 'RISTIĆ', 'SIMIĆ', 'LAZIĆ', 'RADOVANOVIĆ', 'VASIĆ', 'MITROVIĆ'];

const PACKAGES = {
  HFC: ['2025v1_Super PLAN 2 S (Net 400 + TV)', '2025v1_Super PLAN 3 M (Net 600 + TV + Fix)', 'Kabl TV Osnovni paket', '2025v1_Net 300 (samostalni internet)'],
  GPON: ['2025v1_GPON Super PLAN 1 L (Net 1000 + IPTV)', '2025v1_GPON Net 500 + Fix', '2025v1_GPON Super PLAN 2 (Net 600 + IPTV)'],
  VDSL: ['VDSL Net 100 + IPTV', 'VDSL Net 50'],
  other: ['ASTRA WiFi 50/10 + TV', 'ASTRA WiFi 30/5', 'ASTRA Net 100 + TV'],
};
const DETAILS = { nov: 'Nov korisnik', zamena: 'Zamena uređaja', dodatni: 'Dodatni uređaj', interv: 'Intervencija', demont: 'Demontaža', prenos: 'Prenos usluge' };
const DONE_COMMENTS = {
  nov: ['Instalacija završena, svi uređaji rade.', 'Povučen kabl od RO do stana, postavljena kanalica kroz hodnik.', 'Korisnik zadovoljan, objašnjeno korišćenje daljinskog i aplikacije.', 'Signal na modemu u redu (DS 3 dBmV, US 42 dBmV).', 'Optika izmerena -19,2 dBm na ONT-u.', ''],
  zamena: ['Zamenjen neispravan modem, usluga radi.', 'Stari uređaj se gasio, zamenjen novim.', 'Zamenjen uređaj, slika i ton u redu.', ''],
  dodatni: ['Postavljen dodatni uređaj u spavaćoj sobi.', 'Dodat uređaj, razvedeno preko splitera.', ''],
  interv: ['Zamenjen F konektor na zidnoj utičnici, signal stabilan.', 'Problem bio u spliteru, zamenjen.', 'Resetovan i ponovo podešen ruter, WiFi radi.', 'Prekid kabla u podrumu, nastavljeno.', ''],
  demont: ['Demontirana oprema, korisnik raskinuo ugovor.', 'Preuzeti svi uređaji od korisnika.'],
  prenos: ['Usluga preneta na novu lokaciju u istom stanu.', 'Premešten modem u dnevnu sobu, nova instalacija kabla.', ''],
};
const CANCEL_COMMENTS = [
  'Korisnik nije kod kuće, ne javlja se na telefon.',
  'Pogrešna adresa u nalogu, korisnik se odselio.',
  'Nema signala na RO, potrebna intervencija mreže.',
  'Korisnik otkazao uslugu telefonom.',
  'Korisniku ne odgovara vreme, traži novi nalog.',
  'Nema tehničkih uslova u zgradi (nema slobodnog porta u RO).',
];
const POSTPONE_COMMENTS = ['Korisnik nije kod kuće, dogovoren novi termin.', 'Korisnik traži termin posle 16h.', 'Nema pristupa podrumu, upravnik zgrade dolazi sutra.', 'Kiša, rad na krovu nije bezbedan.'];
const RETURN_COMMENTS = ['Nedostaje fotografija postavljenog modema i nalepnice sa serijskim brojem.', 'Pogrešno upisan serijski broj uređaja.', 'Nije upisan utrošeni kabl.', 'Nedostaje fotografija merenja signala.'];
const DEFECT_REASONS = ['Uređaj se ne pali', 'Gubi sinhronizaciju, restartuje se', 'Pregoreo posle udara groma', 'Ne radi WiFi modul'];
const OLD_DEVICES = { 'HFC Modem': 'Stari modem korisnika (Cisco EPC3925)', 'M-HFC Modem': 'Stari modem korisnika (Cisco EPC3928)', 'STB': 'Stari STB korisnika', 'M-STB': 'Stari STB korisnika', 'Astra Ruter': 'Stari ruter korisnika (TP-Link)' };

// ---------- brisanje TEST podataka ----------
async function resetTestData() {
  const db = mongoose.connection.db;
  const idsOf = async (col, filter) => (await db.collection(col).find(filter, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
  const techIds = await idsOf('technicians', { name: /^TEST / });
  const woIds = await idsOf('workorders', { $or: [{ tisId: /^TEST-/ }, { address: /^TEST / }] });
  const eqIds = await idsOf('equipment', { serialNumber: /^test-/i });
  const userIds = await idsOf('users', { tisId: /^TEST-/ });
  const matIds = await idsOf('materials', { type: /^TEST / });
  const beIds = await idsOf('basicequipments', { type: /^TEST / });
  const vehIds = await idsOf('vehicles', { name: /^TEST / });
  const reviewIds = await idsOf('reviews', { $or: [{ technicianId: { $in: techIds } }, { workOrderId: { $in: woIds } }] });
  const logIds = await idsOf('logs', { $or: [{ workOrderId: { $in: woIds } }, { performedBy: { $in: techIds } }] });
  const entityIds = [...techIds, ...woIds, ...eqIds, ...userIds, ...matIds, ...beIds, ...vehIds];
  const byWoOrTech = { $or: [{ workOrderId: { $in: woIds } }, { technicianId: { $in: techIds } }] };
  const plan = [
    ['workorderevidences', { $or: [{ workOrderId: { $in: woIds } }, { tisId: /^TEST-/ }] }],
    ['financialtransactions', { $or: [{ workOrderId: { $in: woIds } }, { 'technicians.technicianId': { $in: techIds } }] }],
    ['failedfinancialtransactions', { workOrderId: { $in: woIds } }],
    ['logs', { _id: { $in: logIds } }],
    ['adminactivitylogs', { $or: [{ entityId: { $in: entityIds } }, { userId: { $in: techIds } }, { 'metadata.userAgent': SEED_UA }] }],
    ['errorlogs', { $or: [{ 'metadata.userAgent': SEED_UA }, { userId: { $in: techIds } }] }],
    ['performancelogs', { $or: [{ 'metadata.userAgent': SEED_UA }, { userId: { $in: techIds } }] }],
    ['notifications', { $or: [{ workOrderId: { $in: woIds } }, { technicianId: { $in: techIds } }, { employmentTechnicianId: { $in: techIds } }, { vehicleId: { $in: vehIds } }, { reviewId: { $in: reviewIds } }, { logId: { $in: logIds } }, { recipientId: { $in: techIds } }] }],
    ['androidnotifications', { technicianId: { $in: techIds } }],
    ['reviews', { _id: { $in: reviewIds } }],
    ['supportcalls', byWoOrTech],
    ['contactevents', byWoOrTech],
    ['callrecordings', byWoOrTech],
    ['technicianlocations', { technicianId: { $in: techIds } }],
    ['dismissedworkorders', { workOrderId: { $in: woIds } }],
    ['workorders', { _id: { $in: woIds } }],
    ['equipment', { _id: { $in: eqIds } }],
    ['users', { _id: { $in: userIds } }],
    ['materials', { _id: { $in: matIds } }],
    ['basicequipments', { _id: { $in: beIds } }],
    ['vehicles', { _id: { $in: vehIds } }],
    ['technicians', { _id: { $in: techIds } }],
  ];
  const deleted = {};
  for (const [col, filter] of plan) {
    const n = (await db.collection(col).deleteMany(filter)).deletedCount;
    if (n) deleted[col] = n;
  }
  // Cene TEST tehničara iz finansijskih postavki (opšte cene i popusti po opštinama ostaju kao podešavanje)
  if (techIds.length) {
    const r = await db.collection('financialsettings').updateMany({}, { $pull: { technicianPrices: { technicianId: { $in: techIds } } } });
    if (r.modifiedCount) deleted['financialsettings (cene TEST tehničara)'] = r.modifiedCount;
  }
  return deleted;
}

// ---------- seed ----------
async function seed() {
  const admins = await Technician.find({ name: { $in: ['E2E Admin', 'E2E Superadmin'] }, deletedAt: null }).lean();
  const ADMIN = admins.find((a) => a.name === 'E2E Admin');
  const SUPER = admins.find((a) => a.name === 'E2E Superadmin');
  if (!ADMIN || !SUPER) throw new Error('nalozi E2E Admin i E2E Superadmin ne postoje (prvo security.sh seed)');
  const hash = await bcrypt.hash(PASSWORD, 10);

  const out = { technicians: [], materials: [], basic: [], users: [], workorders: [], evidences: [], logs: [], adminLogs: [], errorLogs: [], perfLogs: [], notifications: [], transactions: [], failed: [], vehicles: [], locations: [], reviews: [], supportCalls: [], contactEvents: [] };

  const adminLog = (who, t, action, category, extra = {}) => out.adminLogs.push({
    userId: who._id, userName: who.name, userRole: who.role, action, category, timestamp: t, createdAt: t, updatedAt: t,
    entityType: extra.entityType, entityId: extra.entityId, entityName: extra.entityName, details: extra.details,
    metadata: { ipAddress: '127.0.0.1', userAgent: SEED_UA, requestDuration: int(35, 950), requestMethod: extra.method || 'POST', requestUrl: extra.url || '' },
  });

  // ----- tehničari i supervizor -----
  const T = {};
  for (const def of TECHS) {
    const created = at(ymd(def.since), '10:00');
    const off = def.inactiveFrom ?? def.deletedFrom;
    T[def.key] = {
      _id: oid(), key: def.key, team: def.team, name: def.name, password: hash, role: 'technician', isAdmin: false,
      gmail: def.gmail || '', phoneNumber: def.phone, profileImage: '', paymentType: def.pay || 'po_statusu', monthlySalary: def.salary || 0,
      pushNotificationToken: null, pushNotificationsEnabled: true, isActive: off === undefined,
      employedUntil: def.until === null ? null : dateOnly(ymd(def.until)),
      deletedAt: def.deletedFrom !== undefined ? at(ymd(def.deletedFrom), '10:20') : null,
      materials: [], basicEquipment: [], equipment: [], documents: [],
      createdAt: created, updatedAt: off !== undefined ? at(ymd(off), '10:20') : created,
      offFrom: off,
    };
    adminLog(SUPER, created, 'technician_add', 'technicians', { entityType: 'technician', entityId: T[def.key]._id, entityName: def.name, details: { after: { name: def.name }, action: 'created' }, url: '/api/technicians' });
  }
  const SUP = {
    _id: oid(), name: 'TEST Supervizor', password: hash, role: 'supervisor', isAdmin: true, gmail: 'supervizor.test@robotik.local',
    phoneNumber: '064 555 0199', paymentType: 'po_statusu', isActive: true, materials: [], basicEquipment: [], equipment: [], documents: [],
    createdAt: at(ymd(-120), '09:00'), updatedAt: at(ymd(-120), '09:00'),
  };
  adminLog(SUPER, SUP.createdAt, 'technician_add', 'technicians', { entityType: 'technician', entityId: SUP._id, entityName: SUP.name, details: { after: { name: SUP.name }, action: 'created' }, url: '/api/technicians' });
  const avail = (k, d) => T[k].offFrom === undefined || d < T[k].offFrom;
  const verifiers = [ADMIN, ADMIN, ADMIN, SUPER, SUP];

  // ----- materijal i osnovna oprema (magacin + zaduženja) -----
  const MAT = {};
  const matCreated = at(ymd(-70), '09:30');
  for (const [key, type, qty, pack] of MATERIALS) {
    MAT[key] = { _id: oid(), key, type, quantity: qty, pack, createdAt: matCreated, updatedAt: matCreated };
    adminLog(ADMIN, add(matCreated, int(1, 40) * 1000), 'material_add', 'materials', { entityType: 'material', entityId: MAT[key]._id, entityName: type, details: { after: { type, quantity: qty }, action: 'created' }, url: '/api/materials' });
  }
  const techMat = (t, key) => t.materials.find((m) => String(m.materialId) === String(MAT[key]._id));
  const giveMaterial = (t, key, qty, when, who = ADMIN) => {
    const m = MAT[key];
    qty = Math.min(qty, m.quantity);
    if (qty <= 0) return 0;
    m.quantity -= qty;
    m.updatedAt = maxDate(m.updatedAt, when);
    const cur = techMat(t, key);
    if (cur) cur.quantity += qty; else t.materials.push({ _id: oid(), materialId: m._id, quantity: qty });
    adminLog(who, when, 'material_assign_to_tech', 'technicians', { entityType: 'technician', entityId: t._id, entityName: `${m.type} (${qty} kom) → Tehničar: ${t.name}`, details: { after: { materialId: String(m._id), quantity: qty }, action: 'created' }, url: `/api/technicians/${t._id}/materials` });
    return qty;
  };
  const BE = {};
  const beCreated = at(ymd(-70), '09:45');
  for (const [key, type, qty, price] of BASIC) {
    BE[key] = { _id: oid(), type, serialNumber: '', quantity: qty, price, createdAt: beCreated, updatedAt: beCreated };
    adminLog(ADMIN, add(beCreated, int(1, 40) * 1000), 'basic_equipment_add', 'equipment', { entityType: 'equipment', entityId: BE[key]._id, entityName: type, details: { after: { type, quantity: qty, price }, action: 'created' }, url: '/api/basic-equipment' });
  }
  const giveBasic = (t, key, qty, when) => {
    const be = BE[key];
    be.quantity -= qty;
    be.updatedAt = maxDate(be.updatedAt, when);
    t.basicEquipment.push({ _id: oid(), basicEquipmentId: be._id, quantity: qty });
    adminLog(ADMIN, when, 'basic_equipment_assign_to_tech', 'technicians', { entityType: 'technician', entityId: t._id, entityName: `${be.type} (${qty} kom) → Tehničar: ${t.name}`, details: { after: { basicEquipmentId: String(be._id), quantity: qty }, action: 'created' }, url: `/api/technicians/${t._id}/basic-equipment` });
  };
  for (const k of [...ROBOTIK, ...MTEL]) {
    const t = T[k];
    const when = at(ymd(-66), '08:00');
    let i = 0;
    const core = t.team === 'robotik' ? [['rg6', 300], ['drop', 250], ['fkon', 80], ['kan', 80], ['tipl', 400], ['vez', 500]] : [['rg6', 250], ['drop', 300], ['sckon', 40], ['roz', 15], ['tipl', 400], ['vez', 500]];
    for (const [key, qty] of core) giveMaterial(t, key, qty, add(when, (i++) * 70000));
    if (k === 'uros') continue; // Uroš je vratio osnovnu opremu kad je postao neaktivan
    for (const [key, qty] of [['set', 1], ['busi', 1], t.team === 'robotik' ? ['merd', 1] : ['merac', 1]]) giveBasic(t, key, qty, add(when, (i++) * 70000));
  }

  // ----- oprema -----
  const EQ = [];
  const stock = {}; // kategorija -> komadi u magacinu
  const inv = {}; // tehničar -> potvrđeni komadi kod njega
  const atUser = {}; // tisId -> instalirani komadi
  const UPLOADS = [-70, -28, -6].map((d) => at(ymd(d), '09:10'));
  const serialSeq = {};
  const newItem = (category, createdAt, extra = {}) => {
    const code = extra.code || CODES[category];
    serialSeq[code] = (serialSeq[code] || 24000 + int(0, 900)) + int(1, 9);
    const it = {
      _id: oid(), category, description: extra.description || pick(MODELS[category]), serialNumber: `test-${code}-${serialSeq[code]}`,
      location: 'magacin', status: 'available', assignedTo: null, assignedAt: null, assignedBy: null, assignedByName: '', assignedToUser: null,
      installedAt: null, removedAt: null, awaitingConfirmation: false, confirmationStatus: 'pending', rejectionReason: '', confirmationDate: null,
      createdAt, updatedAt: createdAt, upload: extra.upload,
    };
    EQ.push(it);
    return it;
  };
  const uploadFor = (t) => [...UPLOADS].reverse().find((u) => u < add(t, -30 * MIN)) || UPLOADS[0];
  // Komad iz magacina koji je tu bio pre zaduženja; ako ga nema, dolazi iz uvoza pre tog trenutka
  const fromStock = (category, t) => {
    const list = stock[category] || (stock[category] = []);
    const i = list.findIndex((it) => it.updatedAt < add(t, -30 * MIN));
    if (i >= 0) return list.splice(i, 1)[0];
    const u = uploadFor(t);
    return newItem(category, add(u, int(1, 59) * 1000), { upload: u });
  };
  const toTech = (it, t, when, who) => Object.assign(it, {
    location: `tehnicar-${t._id}`, status: 'pending_confirmation', assignedTo: t._id, assignedAt: when, assignedBy: who._id, assignedByName: who.name,
    assignedToUser: null, awaitingConfirmation: true, confirmationStatus: 'pending', updatedAt: when,
  });
  const confirm = (it, t, when) => {
    Object.assign(it, { status: 'assigned', awaitingConfirmation: false, confirmationStatus: 'confirmed', confirmationDate: when, updatedAt: when });
    (inv[t.key] || (inv[t.key] = [])).push(it);
  };
  const assignLog = (t, items, when, who) => adminLog(who, when, 'equipment_assign_to_tech', 'technicians', {
    entityType: 'technician', entityId: t._id, entityName: `${items.length} opreme → Tehničar: ${t.name}`, url: `/api/technicians/${t._id}/equipment`,
    details: { action: 'bulk_assigned', summary: { totalProcessed: items.length, assignedCount: items.length, technicianName: t.name }, assignedItems: items.map((it) => ({ category: it.category, description: it.description, serialNumber: it.serialNumber, status: 'pending_confirmation', location: `tehnicar-${t._id}` })) },
  });
  // Zaduženje sa magacina; potvrda tehničara posle 10 do 90 min (ili ostaje da čeka potvrdu)
  const assign = (t, categories, when, { confirmed = true, who = ADMIN } = {}) => {
    const items = categories.map((c) => toTech(fromStock(c, when), t, when, who));
    assignLog(t, items, when, who);
    if (confirmed) { const c = notAfterNow(add(when, int(10, 90) * MIN)); items.forEach((it) => confirm(it, t, c)); }
    return items;
  };
  for (const k of [...ROBOTIK, ...MTEL]) {
    const t = T[k];
    assign(t, [...STARTER[t.team], ...(ASTRA_TECHS.includes(k) ? STARTER.astra : [])], at(ymd(-65), '09:30'));
  }
  // Uređaj iz tehničarevog inventara; ako ga nema, admin ga ujutru zaduži (2-3 komada te kategorije)
  const deviceFor = (t, category, when) => {
    const list = inv[t.key] || (inv[t.key] = []);
    let i = list.findIndex((it) => it.category === category && it.removedAt); // prvo vraćeni sa terena (istorija)
    if (i < 0) i = list.findIndex((it) => it.category === category);
    if (i < 0) {
      const morning = at(belgradeYmd(when), '07:30');
      assign(t, Array(int(2, 3)).fill(category), morning < add(when, -40 * MIN) ? morning : add(when, -40 * MIN));
      i = list.findIndex((it) => it.category === category);
    }
    return list.splice(i, 1)[0];
  };

  // ----- korisnici -----
  const users = [];
  const usedTis = new Set();
  const newUser = (team, technology, createdAt) => {
    const [area, streets, houseShare, , geo] = weighted(AREAS.map((a) => [a, a[3]]));
    const house = chance(houseShare);
    let tisId;
    do tisId = `TEST-${int(904000, 989999)}`; while (usedTis.has(tisId));
    usedTis.add(tisId);
    const name = `TEST ${pick(FIRST)} ${pick(LAST)}`;
    const u = {
      _id: oid(), tisId, name, address: `TEST BEOGRAD,${area},${pick(streets)} ${int(1, 160)}${house ? '' : `/${int(1, 48)}`}`,
      phone: `06${pick([0, 1, 2, 3, 4, 5, 9])}${int(1000000, 9999999)}`, workOrders: [], createdAt, updatedAt: createdAt,
      area, geo, house, team, technology, pkg: pick(PACKAGES[technology]), canceledNov: false, served: false,
    };
    users.push(u);
    atUser[tisId] = [];
    return u;
  };
  // Korisnik sa uslugom od ranije (oprema instalirana pre perioda naloga, bez naloga u sistemu)
  const preexistingUser = (team) => {
    const technology = team === null ? 'other' : weighted([['HFC', 60], ['GPON', 40]]);
    const u = newUser(team, technology, at(ymd(int(-180, -95)), '11:00'));
    u.served = true;
    const installer = T[pick(team === 'mtel' ? MTEL : team === null ? ASTRA_TECHS : ROBOTIK)];
    const cats = team === null ? ['Astra Antena', 'Astra Ruter'] : team === 'mtel' ? [technology === 'HFC' ? 'M-HFC Modem' : 'M-GPON Modem', 'M-STB'] : [technology === 'HFC' ? 'HFC Modem' : 'GPON Modem', pick(['Hybrid', 'STB', 'OTT tv po tvom'])];
    for (const c of cats) {
      const it = newItem(c, add(u.createdAt, -12 * DAY));
      Object.assign(it, {
        location: `user-${u.tisId}`, status: 'installed', assignedTo: installer._id, assignedAt: add(u.createdAt, -6 * DAY), assignedBy: ADMIN._id, assignedByName: ADMIN.name,
        assignedToUser: u.tisId, installedAt: add(u.createdAt, DAY), confirmationStatus: 'confirmed', confirmationDate: add(u.createdAt, -6 * DAY + HOUR), updatedAt: add(u.createdAt, DAY),
      });
      atUser[u.tisId].push(it);
    }
    return u;
  };

  // ----- radni nalozi -----
  const TIMES = ['08:00', '08:30', '09:00', '10:00', '10:30', '11:00', '12:00', '13:00', '13:30', '14:00', '15:00', '16:00', '17:00', '18:00'];
  const slots = [];
  for (let d = -60; d <= 7; d++) {
    const day = ymd(d);
    const sunday = new Date(`${day}T00:00:00Z`).getUTCDay() === 0;
    let n = d === 0 ? 7 : d === 1 ? int(4, 5) : d > 0 ? int(2, 3) : d >= -10 ? int(4, 5) : d >= -21 ? int(3, 4) : int(1, 2);
    if (sunday && d !== 0 && d !== 1) n = chance(0.4) ? 1 : 0;
    for (const time of shuffle(TIMES).slice(0, n).sort()) slots.push({ d, day, time, ap: at(day, time) });
  }
  // Odloženi nalozi koji sada čekaju: prvi termin juče, odloženi za sutra u isto vreme (do 48 h, kao u aplikaciji)
  const odlozeniSlots = new Set(slots.filter((s) => s.d === 1).slice(0, 2));

  const W = []; // radni nalozi sa pomoćnim poljima
  const importDayOf = (d) => Math.min(d - 1 - ((d + 60) % 3), -1); // uvoz iz Excel-a svaka 3 dana, poslednji juče
  const statsAnomaly = { done: false };
  for (const [slotIdx, s] of slots.entries()) {
    const odlozen = odlozeniSlots.has(s);
    const tim = weighted([['robotik', 55], ['mtel', 30], [null, 15]]);
    const astra = tim === null;
    let kind = astra ? weighted([['nov', 28], ['dodatni', 20], ['interv', 37], ['demont', 15]]) : weighted([['nov', 22], ['zamena', 12], ['dodatni', 15], ['interv', 30], ['demont', 6], ['prenos', 13]]);
    if (odlozen) kind = 'nov';

    // tehničari
    const pool = (tim === 'mtel' ? MTEL : astra ? ASTRA_TECHS : ROBOTIK).filter((k) => avail(k, s.d));
    const unassigned = !odlozen && (s.d > 0 ? chance(0.3) : s.d === 0 ? false : slotIdx % 45 === 20); // u prošlosti tačno nekoliko nedodeljenih
    const techs = [];
    if (!unassigned && pool.length) {
      techs.push(pick(pool));
      const rest = pool.filter((k) => k !== techs[0]);
      if (rest.length && chance(0.3)) techs.push(pick(rest));
    }

    // prvi termin (odložen nalog je prvobitno bio dan ranije, odložene sada čekaju od juče)
    let origDay = s.day;
    let postponed = null;
    if (odlozen) origDay = ymd(s.d - 2);
    else if (techs.length && s.d <= 0 && s.d > -60 && chance(0.12)) origDay = ymd(s.d - 1);
    if (origDay !== s.day) {
      const fromAp = at(origDay, s.time);
      postponed = { fromDay: origDay, fromAp, at: add(fromAp, int(10, 40) * MIN), comment: pick(POSTPONE_COMMENTS) };
    }
    const importDay = importDayOf(dayOffsetOf(at(origDay, '12:00')));
    const createdAt = add(at(ymd(importDay), '07:40'), int(0, 50) * 1000);

    // korisnik
    let user = null;
    let duplicateOf = 0;
    if (kind === 'nov') {
      const retry = !astra && s.d > -12 && users.find((u) => u.canceledNov && !u.served && u.team === tim && !u.retried);
      if (retry && chance(0.8)) { user = retry; retry.retried = true; duplicateOf = 1; }
      else user = newUser(tim, astra ? 'other' : weighted([['HFC', 55], ['GPON', 38], ['VDSL', 7]]), createdAt);
    } else {
      const cands = users.filter((u) => u.team === tim && u.served && atUser[u.tisId].length > 0);
      user = cands.length && chance(0.93) ? pick(cands) : preexistingUser(tim);
    }
    const technology = user.technology;

    // status
    const dur = int(50, 150) * MIN;
    let status;
    if (odlozen || (postponed && s.ap > NOW)) status = 'odlozen';
    else if (!techs.length || add(s.ap, dur) > NOW) status = 'nezavrsen';
    else if (s.d === 0) status = weighted([['zavrsen', 75], ['otkazan', 10], ['nezavrsen', 15]]);
    else status = weighted([['zavrsen', 84], ['otkazan', 13], ['nezavrsen', 3]]);
    // zaboravljen (prekoračen) nalog ostaje samo kod aktivnih tehničara, nikad kod "čistog" naloga
    if (status === 'nezavrsen' && add(s.ap, DAY) <= NOW && techs.some((k) => k === CLEAN_TECH || !avail(k, 0))) status = 'zavrsen';
    if (kind === 'nov' && status === 'otkazan') user.canceledNov = true;

    const tisJobId = String(int(629000000, 679999999));
    const type = kind === 'dodatni' ? (astra ? 'ASTRA dodatni TV uređaj' : technology === 'HFC' ? 'Dodatni STB/CA - Kabl TV' : 'Dodatni IPTV STB') : user.pkg;
    const w = {
      _id: oid(), kind, s, user, techs, status, dur, postponed, createdAt, duplicateOf,
      doc: {
        date: dateOnly(s.day), originalDate: dateOnly(origDay), time: s.time, municipality: user.area, address: user.address, type,
        details: DETAILS[kind], comment: '', status, technology, tim, tisId: user.tisId,
        userName: user.name, userPhone: user.phone, customerEmail: '', tisJobId, additionalJobs: chance(0.3) ? `${tisJobId},${type}` : '',
        images: [], verified: false, reviewEmailSentAt: null, missingPhotosComment: '', postponeHistory: [], cancelHistory: [], rejectionHistory: [],
        rejectionPenaltyCount: 0, rejectionPenaltyPercent: 0, penaltyCycle: 0, penaltyAdjustments: [], complaints: [], user: user._id,
        equipment: [], materials: [], installedEquipment: [], adminEditLog: [], voiceRecordings: [], isOverdue: false,
        appointmentDateTime: s.ap, reminderSentForAppointment: null, reminderSentAt: null, customerCallAttemptedAt: null, customerCallSource: '',
        uncontactedAlertSentForAppointment: null, duplicateAddressFlagged: duplicateOf > 0, duplicateAddressCanceledCount: duplicateOf,
        duplicateAddressCheckedAt: duplicateOf ? createdAt : null, createdAt,
      },
      ev: { installedEquipment: [], removedEquipment: [] },
      logs: [],
    };
    if (techs[0]) w.doc.technicianId = T[techs[0]]._id;
    if (techs[1]) w.doc.technician2Id = T[techs[1]]._id;
    user.workOrders.push(w._id);
    user.updatedAt = maxDate(user.updatedAt, createdAt);
    W.push(w);

    const t1 = techs[0] ? T[techs[0]] : null;
    const woInfo = { municipality: user.area, address: user.address, type, tisId: user.tisId, userName: user.name };
    const log = (t, when, action, description, extra = {}) => out.logs.push({ action, description, performedBy: t._id, performedByName: t.name, workOrderId: w._id, workOrderInfo: woInfo, timestamp: when, createdAt: when, updatedAt: when, metadata: {}, ...extra });
    const statusLog = (t, when, from, to) => log(t, when, to === 'zavrsen' ? 'workorder_finished' : to === 'odlozen' ? 'workorder_postponed' : 'workorder_cancelled',
      to === 'zavrsen' ? 'Završio/završila radni nalog' : to === 'odlozen' ? 'Odložio/odložila radni nalog' : 'Otkazao/otkazala radni nalog', { statusChange: { oldStatus: from, newStatus: to } });
    w.log = log;

    // odlaganje (zapis kako bi ga uneo tehničar: od starog na novi termin)
    if (postponed && t1) {
      w.doc.postponeHistory.push({ _id: oid(), postponedAt: postponed.at, fromDate: dateOnly(postponed.fromDay), fromTime: s.time, toDate: dateOnly(s.day), toTime: s.time, comment: postponed.comment, postponedBy: t1._id });
      w.doc.prvoMenjanjeStatusa = postponed.at;
      statusLog(t1, postponed.at, 'nezavrsen', 'odlozen');
      if (status === 'odlozen') Object.assign(w.doc, { postponedUntil: s.ap, statusChangedAt: postponed.at, statusChangedBy: t1._id });
      else Object.assign(w.doc, { statusChangedAt: notAfterNow(nextFullHour(s.ap)), statusChangedBy: t1._id }); // planer ga je u termin vratio u nezavršene
    }

    if (status === 'otkazan') {
      const ct = add(s.ap, int(10, 40) * MIN);
      const c = pick(CANCEL_COMMENTS);
      w.doc.cancelHistory.push({ _id: oid(), canceledAt: ct, comment: c, canceledBy: t1._id });
      Object.assign(w.doc, { statusChangedAt: ct, statusChangedBy: t1._id, prvoMenjanjeStatusa: w.doc.prvoMenjanjeStatusa || ct });
      if (chance(0.5)) { w.doc.comment = c; log(t1, add(ct, -MIN), 'comment_added', 'Dodao/dodala komentar na radni nalog', { commentText: c }); }
      statusLog(t1, ct, 'nezavrsen', 'otkazan');
    }

    if (status === 'nezavrsen' && add(s.ap, DAY) <= NOW) {
      // planer označava nezavršene naloge starije od 24 h kao prekoračene
      Object.assign(w.doc, { isOverdue: true, overdueMarkedAt: notAfterNow(nextFullHour(add(s.ap, DAY))) });
    }

    if (status === 'zavrsen') {
      const done = add(s.ap, dur);
      w.done = done;
      // utrošeni materijal (tehničar 1, poslednja stavka drugog tehničara ako ih je dvoje)
      const mats = [];
      const m = (key, qty) => mats.push([key, qty]);
      const tech = technology;
      if (kind === 'nov' || kind === 'prenos') {
        if (tech === 'HFC') { m('rg6', int(15, 45)); m('fkon', int(2, 6)); if (chance(0.5)) m('kan', int(2, 10)); if (chance(0.5)) m('tipl', int(6, 20)); if (chance(0.3)) m('sp2', 1); }
        else if (tech === 'GPON') { m('drop', int(20, 80)); m('sckon', int(1, 2)); m('roz', 1); if (chance(0.5)) m('patch', 1); if (chance(0.4)) m('kan', int(2, 8)); }
        else if (tech === 'VDSL') { m('utp', int(5, 20)); m('tipl', int(4, 10)); }
        else { m('utp', int(10, 30)); m('vez', int(6, 14)); }
      } else if (kind === 'dodatni') {
        if (tech === 'HFC') { m('rg6', int(5, 15)); m('fkon', 2); if (chance(0.5)) m('sp4', 1); } else m('utp', int(5, 15));
      } else if ((kind === 'zamena' || kind === 'interv') && chance(0.6)) {
        if (tech === 'HFC') { m('fkon', 2); m('rg6', int(2, 6)); } else if (tech === 'GPON') m('patch', 1); else m('utp', int(2, 6));
      }
      // jedna velika potrošnja kabla (anomalija na stranici Logovi)
      if (!statsAnomaly.done && tech === 'HFC' && kind === 'nov' && s.d >= -10 && s.d < 0) { mats[0][1] = 165; statsAnomaly.done = true; statsAnomaly.w = w; }
      let mt = add(done, -(mats.length + 3) * 2 * MIN);
      mats.forEach(([key, qty], idx) => {
        const t = idx === mats.length - 1 && techs[1] ? T[techs[1]] : t1;
        let cur = techMat(t, key);
        if (!cur || cur.quantity < qty) {
          const morning = at(belgradeYmd(done), '07:20');
          giveMaterial(t, key, Math.max(MAT[key].pack, qty), morning < mt ? morning : add(mt, -30 * MIN));
          cur = techMat(t, key);
        }
        if (!cur || cur.quantity < qty) return;
        cur.quantity -= qty;
        if (cur.quantity === 0) t.materials.splice(t.materials.indexOf(cur), 1);
        w.doc.materials.push({ _id: oid(), material: MAT[key]._id, quantity: qty, technicianId: t._id });
        mt = add(mt, 2 * MIN);
        const l = log(t, mt, 'material_added', `Dodao/dodala materijal: ${MAT[key].type} (količina: ${qty})`, { materialDetails: { materialId: MAT[key]._id, materialType: MAT[key].type, quantity: qty } });
        if (statsAnomaly.w === w && idx === 0) statsAnomaly.logIndex = l - 1;
      });
      // oprema
      const install = (category) => {
        const it = deviceFor(t1, category, done);
        Object.assign(it, { location: `user-${user.tisId}`, status: 'installed', assignedToUser: user.tisId, installedAt: mt, updatedAt: mt });
        atUser[user.tisId].push(it);
        w.doc.installedEquipment.push({ _id: oid(), equipmentId: it._id, installedAt: mt, technicianId: t1._id });
        w.doc.equipment.push(it._id);
        w.ev.installedEquipment.push({ _id: oid(), equipmentType: evidenceType(category), serialNumber: it.serialNumber, condition: 'N', installedAt: mt, notes: `Instalirano od tehničara - ${it.description}` });
        log(t1, mt, 'equipment_added', `Dodao/dodala opremu: ${it.category} - ${it.description} (S/N: ${it.serialNumber})`, { equipmentDetails: { equipmentId: it._id, equipmentType: it.category, serialNumber: it.serialNumber, description: it.description } });
        mt = add(mt, MIN);
        return it;
      };
      const removeFromUser = (it, working, reason) => {
        atUser[user.tisId].splice(atUser[user.tisId].indexOf(it), 1);
        if (working) {
          // kao "ukloni po serijskom broju": uređaj ide tehničaru
          Object.assign(it, { location: `tehnicar-${t1._id}`, status: 'assigned', assignedTo: t1._id, assignedToUser: null, assignedAt: mt, assignedBy: t1._id, assignedByName: `${t1.name} (preuzeto od korisnika)`, removedAt: mt, updatedAt: mt });
          (inv[t1.key] || (inv[t1.key] = [])).push(it);
        } else {
          Object.assign(it, { location: 'defective', status: 'defective', assignedTo: null, assignedToUser: null, assignedAt: null, assignedBy: null, assignedByName: '', removedAt: mt, updatedAt: mt });
        }
        w.ev.removedEquipment.push({ _id: oid(), equipmentType: evidenceType(it.category), serialNumber: it.serialNumber, condition: working ? 'N' : 'R', removedAt: mt, reason: working ? (kind === 'demont' ? 'Prekid usluge' : 'Zamena') : 'Kvar', notes: working ? `Uklonjeno od tehničara - ${it.category}` : reason });
        log(t1, mt, 'equipment_removed', `Uklonio/uklonila opremu: ${it.category} - ${it.description} (S/N: ${it.serialNumber})${working ? ' - oprema ispravna' : ' - oprema neispravna'}`,
          { equipmentDetails: { equipmentId: it._id, equipmentType: it.category, serialNumber: it.serialNumber, description: it.description, isWorking: working, removalReason: working ? `Uklonjeno po serijskom broju: ${it.category}` : reason } });
        mt = add(mt, MIN);
      };
      const modemCat = astra ? 'Astra Ruter' : tim === 'mtel' ? (tech === 'GPON' ? 'M-GPON Modem' : 'M-HFC Modem') : (tech === 'GPON' ? 'GPON Modem' : 'HFC Modem');
      if (kind === 'nov') {
        const cats = astra ? ['Astra Antena', 'Astra Ruter', ...(chance(0.4) ? ['Astra Stb'] : [])]
          : tim === 'mtel' ? (tech === 'VDSL' ? ['M-STB'] : [modemCat, ...weighted([[['M-STB'], 50], [['M-Cam Modul', 'M-Smart Card'], 25], [[], 25]])])
            : tech === 'VDSL' ? ['OTT tv po tvom'] : tech === 'GPON' ? [modemCat, ...weighted([[['OTT tv po tvom'], 45], [['Hybrid'], 30], [[], 25]])]
              : [modemCat, ...weighted([[['Hybrid'], 35], [['STB', 'Cam Modul', 'Smart Card'], 20], [['Cam Modul', 'Smart Card'], 20], [[], 25]])];
        cats.forEach(install);
        user.served = true;
      } else if (kind === 'dodatni') {
        install(astra ? 'Astra Stb' : tim === 'mtel' ? 'M-STB' : tech === 'HFC' ? pick(['STB', 'Hybrid']) : 'OTT tv po tvom');
      } else if (kind === 'zamena' || (kind === 'interv' && chance(0.2))) {
        const cur = atUser[user.tisId];
        const old = cur.find((it) => /Modem|Ruter/.test(it.category)) || cur[0];
        if (old) {
          const working = chance(0.4);
          const cat = old.category;
          removeFromUser(old, working, pick(DEFECT_REASONS));
          install(cat);
        } else if (OLD_DEVICES[modemCat]) {
          // uređaj korisnika koji nije u sistemu (preuzet sa terena, kao u aplikaciji)
          const it = newItem(modemCat, mt, { code: 'old', description: OLD_DEVICES[modemCat] });
          Object.assign(it, { location: `tehnicar-${t1._id}`, status: 'assigned', assignedTo: t1._id, assignedAt: mt, assignedBy: t1._id, assignedByName: `${t1.name} (preuzeto od korisnika)`, removedAt: mt });
          (inv[t1.key] || (inv[t1.key] = [])).push(it);
          w.ev.removedEquipment.push({ _id: oid(), equipmentType: evidenceType(modemCat), serialNumber: it.serialNumber, condition: 'N', removedAt: mt, reason: 'Zamena', notes: `Uklonjeno od tehničara - ${modemCat}` });
          log(t1, mt, 'equipment_removed', `Uklonio/uklonila opremu: ${it.category} - ${it.description} (S/N: ${it.serialNumber}) - oprema ispravna`, { equipmentDetails: { equipmentId: it._id, equipmentType: it.category, serialNumber: it.serialNumber, description: it.description, isWorking: true, removalReason: `Uklonjeno po serijskom broju: ${modemCat}` } });
          mt = add(mt, MIN);
          install(modemCat);
        }
      } else if (kind === 'demont') {
        [...atUser[user.tisId]].forEach((it) => removeFromUser(it, true));
        user.served = false;
      }
      const comment = pick(DONE_COMMENTS[kind]);
      if (comment) { w.doc.comment = comment; log(t1, add(done, -MIN), 'comment_added', 'Dodao/dodala komentar na radni nalog', { commentText: comment }); }
      if (chance(0.06)) w.doc.missingPhotosComment = 'Korisnik nije dozvolio fotografisanje unutar stana.';
      statusLog(t1, done, 'nezavrsen', 'zavrsen');
      Object.assign(w.doc, { statusChangedAt: done, statusChangedBy: t1._id, prvoMenjanjeStatusa: w.doc.prvoMenjanjeStatusa || done });
    }
  }

  // ----- verifikacija, vraćanja na ispravku -----
  // tačno tri skorašnja završena naloga su trenutno vraćena tehničaru (aktivni tehničari, bez "čistog" naloga)
  W.filter((w) => w.status === 'zavrsen' && w.s.d >= -6 && w.s.d < 0 && w.techs.every((k) => k !== CLEAN_TECH && avail(k, 0))).slice(-3).forEach((w) => { w.status = 'vracen'; });
  const penaltyFor = (n) => (n <= 0 ? 0 : n > 5 ? 100 : n * 10);
  const reject = (w, when, who, comment, applied) => {
    const before = w.doc.rejectionPenaltyPercent;
    if (applied) w.doc.rejectionPenaltyCount += 1;
    const after = applied ? penaltyFor(w.doc.rejectionPenaltyCount) : before;
    const ts = w.techs.map((k) => T[k]);
    w.doc.rejectionHistory.push({ _id: oid(), rejectedAt: when, rejectedBy: who._id, rejectedByName: who.name, comment, source: 'manual', penaltyApplied: applied, penaltyPercentBefore: before, penaltyPercentAfter: after, cycle: 0, technicianIds: ts.map((t) => t._id), technicianNames: ts.map((t) => t.name) });
    Object.assign(w.doc, { adminComment: comment, rejectionPenaltyPercent: after });
    const changes = ['Radni nalog vraćen kao neispravno popunjen', `Razlog: ${comment}`, applied ? `Umanjenje zarade: ${before}% → ${after}%` : `Bez umanjenja zarade (trenutni minus: ${after}%)`];
    adminLog(who, when, 'workorder_edit', 'workorders', { entityType: 'workorder', entityId: w._id, entityName: w.doc.tisJobId, method: 'PUT', url: `/api/workorders/${w._id}/return-incorrect`, details: { action: 'updated', changes, changeCount: changes.length, summary: applied ? `Vraćen kao neispravno popunjen, minus ${after}%` : 'Vraćen kao neispravno popunjen' } });
  };
  for (const w of W.filter((x) => x.done)) {
    const t1 = T[w.techs[0]];
    const age = NOW - w.done;
    w.lastDone = w.done;
    if (w.status === 'vracen') {
      const r = add(w.done, int(2, 16) * HOUR);
      if (r < add(NOW, -10 * MIN)) {
        reject(w, r, pick(verifiers), pick(RETURN_COMMENTS), chance(0.8));
        w.doc.status = 'nezavrsen';
        if (add(w.s.ap, DAY) <= NOW) Object.assign(w.doc, { isOverdue: true, overdueMarkedAt: notAfterNow(nextFullHour(maxDate(add(w.s.ap, DAY), r))) });
        continue;
      }
      w.status = 'zavrsen';
      w.doc.status = 'zavrsen';
    }
    let lastDone = w.done;
    let verified = age > 2 * DAY ? chance(0.88) : age > 12 * HOUR ? chance(0.4) : false;
    if (verified && age > 4 * DAY && chance(0.15)) {
      // vraćen na ispravku pa ispravljen (jednom ili dvaput)
      const rounds = chance(0.2) ? 2 : 1;
      for (let i = 0; i < rounds; i++) {
        const r = add(lastDone, int(3, 18) * HOUR);
        const fix = add(r, int(2, 20) * HOUR);
        if (fix > add(NOW, -3 * HOUR)) break;
        reject(w, r, pick(verifiers), pick(RETURN_COMMENTS), chance(0.85));
        w.log(t1, fix, 'workorder_finished', 'Završio/završila radni nalog', { statusChange: { oldStatus: 'nezavrsen', newStatus: 'zavrsen' } });
        lastDone = fix;
      }
      Object.assign(w.doc, { statusChangedAt: lastDone });
    }
    if (verified) {
      const v = add(lastDone, int(2, 40) * HOUR);
      if (v > add(NOW, -5 * MIN)) verified = false;
      else Object.assign(w.doc, { verified: true, verifiedAt: v });
    }
    w.lastDone = lastDone;
  }

  // ----- status usluge (customerStatus) i evidencija -----
  const csOf = (w) => {
    const tech = w.doc.technology;
    if (w.doc.tim === null) return CS[{ nov: 'astraWifi', dodatni: 'astraDodavanje', demont: 'astraDemontaza' }[w.kind] || 'astraIntervencija'];
    if (w.kind === 'nov') return tech === 'GPON' ? (w.user.house ? CS.gponKuca : CS.gponZgrada) : tech === 'VDSL' ? CS.saMontazom : (w.user.house ? CS.hfcKuca : CS.hfcZgrada);
    return ['dodatni', 'prenos'].includes(w.kind) ? CS.saMontazom : CS.bezMontaze;
  };
  let novKorisnikUsed = false;
  for (const w of W) {
    const real = csOf(w);
    let cs = CS.hfcZgrada; // podrazumevano kad aplikacija napravi evidenciju
    if (w.doc.verified) cs = real;
    else if (w.doc.status === 'zavrsen') {
      if (!novKorisnikUsed && w.kind === 'nov') { cs = CS.nov; novKorisnikUsed = true; } else if (chance(0.5)) cs = real;
    }
    w.cs = cs;
    const st = { zavrsen: 'ZAVRŠENO', otkazan: 'OTKAZANO', odlozen: 'ODLOŽENO' }[w.doc.status] || 'U TOKU';
    out.evidences.push({
      workOrderId: w._id, tisJobId: w.doc.tisJobId, tisId: w.doc.tisId, customerName: w.doc.userName, customerStatus: cs, userPhone: w.doc.userPhone, customerEmail: '',
      municipality: w.doc.municipality, address: w.doc.address, technician1: w.techs[0] ? T[w.techs[0]].name : '', technician2: w.techs[1] ? T[w.techs[1]].name : '',
      status: st, executionDate: w.doc.status === 'zavrsen' ? w.lastDone || w.done : w.doc.date, notes: w.doc.comment || '', orderType: w.doc.type,
      servicePackage: w.doc.additionalJobs || '', installedEquipment: w.ev.installedEquipment, removedEquipment: w.ev.removedEquipment, changeHistory: [],
      technology: w.doc.technology, verified: w.doc.verified, verifiedAt: w.doc.verifiedAt, createdAt: w.createdAt, updatedAt: maxDate(w.createdAt, w.doc.statusChangedAt, w.doc.verifiedAt),
    });
    if (w.doc.verified) {
      const who = pick(verifiers);
      if (cs !== CS.hfcZgrada && chance(0.2)) {
        const ch = [`Promenjen Status korisnika: ${CS.hfcZgrada} → ${cs}`];
        adminLog(who, add(w.doc.verifiedAt, -int(1, 4) * MIN), 'workorder_edit', 'workorders', { entityType: 'workorder', entityId: w._id, entityName: w.doc.tisJobId, method: 'PUT', url: `/api/workorders/${w._id}/customer-status`, details: { action: 'updated', changes: ch, changeCount: 1, summary: ch[0] } });
      }
      adminLog(who, w.doc.verifiedAt, 'workorder_edit', 'workorders', { entityType: 'workorder', entityId: w._id, entityName: w.doc.tisJobId, method: 'PUT', url: `/api/workorders/${w._id}/verify`, details: { action: 'updated', changes: ['Verifikovan radni nalog', `Status korisnika: ${cs}`], changeCount: 2, summary: `Verifikovan sa statusom: ${cs}` } });
    }
  }

  // ----- admin izmene na nalogu (stranica za izmenu): dodat zaboravljeni uređaj i ispravljen materijal -----
  const editable = W.filter((w) => w.doc.verified && w.kind === 'nov' && w.doc.tim === 'robotik' && dayOffsetOf(w.done) > -20).slice(0, 2);
  editable.forEach((w, i) => {
    const t1 = T[w.techs[0]];
    const when = add(w.doc.verifiedAt, -12 * MIN);
    const wInfo = { _id: w._id, tisId: w.doc.tisId, userName: w.doc.userName, address: w.doc.address, municipality: w.doc.municipality, type: w.doc.type, date: w.doc.date };
    if (i === 0 && w.doc.installedEquipment.length > 1) {
      const it = EQ.find((e) => String(e._id) === String(w.doc.installedEquipment[w.doc.installedEquipment.length - 1].equipmentId));
      w.doc.adminEditLog.push({ _id: oid(), action: 'added', equipmentCategory: it.category, equipmentDescription: it.description, equipmentSerialNumber: it.serialNumber, technicianName: t1.name, technicianId: t1._id, adminName: SUPER.name, timestamp: when });
      adminLog(SUPER, when, 'edit_equipment_add', 'edit', { entityType: 'WorkOrder', entityId: w._id, entityName: `Radni nalog ${w.doc.tisId} - ${w.doc.userName}`, url: `/api/workorders/${w._id}/edit/add-equipment`, details: { action: 'added', workOrder: wInfo, equipment: { _id: it._id, category: it.category, description: it.description, serialNumber: it.serialNumber } } });
    } else if (w.doc.materials.length) {
      const mItem = w.doc.materials[0];
      const mat = Object.values(MAT).find((x) => String(x._id) === String(mItem.material));
      w.doc.adminEditLog.push({ _id: oid(), action: 'material_added', materialType: mat.type, materialQuantity: 5, technicianName: t1.name, technicianId: t1._id, adminName: SUPER.name, timestamp: when });
      adminLog(SUPER, when, 'edit_material_add', 'edit', { entityType: 'WorkOrder', entityId: w._id, entityName: `Radni nalog ${w.doc.tisId} - ${w.doc.userName}`, url: `/api/workorders/${w._id}/edit/add-materials`, details: { action: 'added', workOrder: wInfo, material: { _id: mat._id, type: mat.type, quantity: 5 } } });
    }
  });

  // ----- kraj perioda: zaduženja koja čekaju potvrdu, odbijena oprema, razduženje neaktivnog tehničara -----
  const pendingAt = notAfterNow(NOW > at(TODAY, '08:40') ? at(TODAY, '08:10') : at(ymd(-1), '16:30'));
  for (const [k, cats] of [['marko', ['HFC Modem', 'Hybrid', 'Smart Card']], ['stefan', ['GPON Modem', 'OTT tv po tvom']], ['milos', ['HFC Modem', 'STB']], ['djordje', ['M-HFC Modem', 'M-STB', 'M-STB']], ['nemanja', ['M-GPON Modem', 'M-Smart Card']]]) {
    assign(T[k], cats, add(pendingAt, int(0, 20) * MIN), { confirmed: false });
  }
  for (const [k, cat, d, reason] of [['stefan', 'GPON Modem', -20, 'Kutija oštećena, uređaj se ne pali.'], ['djordje', 'M-GPON Modem', -15, 'Pogrešan model, nije za ovu mrežu.']]) {
    const when = at(ymd(d), '10:00');
    const [it] = assign(T[k], [cat], when, { confirmed: false });
    Object.assign(it, { awaitingConfirmation: false, confirmationStatus: 'rejected', status: 'available', location: 'magacin', assignedTo: null, assignedAt: null, assignedBy: null, assignedByName: '', rejectionReason: reason, confirmationDate: add(when, 75 * MIN), updatedAt: add(when, 75 * MIN) });
    (stock[cat] || (stock[cat] = [])).push(it);
  }
  {
    const t = T.uros;
    const when = at(ymd(-12), '11:00');
    const items = (inv.uros || []).splice(0);
    items.forEach((it) => Object.assign(it, { assignedTo: null, location: 'magacin', status: 'available', assignedAt: null, assignedBy: null, assignedByName: '', updatedAt: when }));
    items.forEach((it) => (stock[it.category] || (stock[it.category] = [])).push(it));
    if (items.length) adminLog(ADMIN, when, 'equipment_unassign_from_tech', 'technicians', { entityType: 'technician', entityId: t._id, entityName: `${items.length} opreme → Od tehničara: ${t.name}`, url: `/api/technicians/${t._id}/equipment/return`, details: { action: 'bulk_unassigned', summary: { totalProcessed: items.length, unassignedCount: items.length, technicianName: t.name }, assignedItems: items.map((it) => ({ category: it.category, description: it.description, serialNumber: it.serialNumber, status: 'available', location: 'magacin' })) } });
  }
  // magacin: svaka kategorija ima bar nekoliko komada na stanju
  for (const [cat, min] of [['HFC Modem', 4], ['GPON Modem', 4], ['STB', 2], ['Hybrid', 3], ['OTT tv po tvom', 2], ['Cam Modul', 2], ['Smart Card', 2], ['M-HFC Modem', 3], ['M-GPON Modem', 3], ['M-STB', 3], ['M-Smart Card', 1], ['Astra Antena', 1], ['Astra Ruter', 1], ['Astra Stb', 1]]) {
    const list = stock[cat] || (stock[cat] = []);
    while (list.length < min) list.push(newItem(cat, add(UPLOADS[2], int(60, 3600) * 1000), { upload: UPLOADS[2] }));
  }
  // Excel uvozi opreme (admin log po uvozu)
  for (const u of UPLOADS) {
    const items = EQ.filter((it) => it.upload === u);
    if (items.length) adminLog(ADMIN, add(u, 2 * MIN), 'equipment_bulk_add', 'equipment', { entityName: `${items.length} komada opreme`, url: '/api/equipment/upload', details: { action: 'bulk_created', summary: { totalProcessed: items.length, addedCount: items.length, duplicatesCount: 0, errorsCount: 0 }, addedItems: items.map((it) => ({ category: it.category, description: it.description, serialNumber: it.serialNumber, location: 'magacin', status: 'available' })), duplicates: [], errors: [] } });
  }
  // Excel uvozi naloga (admin log po uvozu)
  const imports = new Map();
  for (const w of W) { const k = w.createdAt.toISOString().slice(0, 13); (imports.get(k) || imports.set(k, []).get(k)).push(w); }
  for (const ws of imports.values()) {
    const t = maxDate(...ws.map((w) => w.createdAt));
    const newUsers = ws.filter((w) => w.kind === 'nov' && !w.duplicateOf).length;
    const noTim = ws.filter((w) => w.doc.tim === null).length;
    adminLog(chance(0.8) ? ADMIN : SUPER, add(t, 20 * 1000), 'workorder_bulk_add', 'workorders', { entityName: `${ws.length} radnih naloga`, url: '/api/workorders/upload', details: { action: 'bulk_created', summary: { totalProcessed: ws.length, addedCount: ws.length, duplicatesCount: 0, errorsCount: 0, newUsersCount: newUsers, existingUsersCount: ws.length - newUsers, timWarningsCount: noTim, timSummary: null }, addedItems: ws.map((w) => ({ address: w.doc.address, type: w.doc.type, tisId: w.doc.tisId })), duplicates: [], errors: [] } });
  }
  // brisanje i deaktivacija tehničara (log)
  adminLog(ADMIN, T.dejan.deletedAt, 'technician_delete', 'technicians', { entityType: 'technician', entityId: T.dejan._id, entityName: T.dejan.name, method: 'DELETE', url: `/api/technicians/${T.dejan._id}`, details: { before: { name: T.dejan.name }, action: 'deleted' } });
  adminLog(SUPER, at(ymd(-30), '12:15'), 'technician_edit', 'technicians', { entityType: 'technician', entityId: T.marko._id, entityName: T.marko.name, method: 'PUT', url: `/api/technicians/${T.marko._id}`, details: { after: { name: T.marko.name, gmail: T.marko.gmail, phoneNumber: T.marko.phoneNumber, employedUntil: ymd(24) }, action: 'updated' } });

  // ----- finansije -----
  const curSettings = await FinancialSettings.findOne().lean();
  const prices = {};
  for (const [k, v] of Object.entries(PRICES)) prices[CS[k]] = (curSettings && curSettings.pricesByCustomerStatus && curSettings.pricesByCustomerStatus[CS[k]]) || v;
  const areasUsed = [...new Set(W.map((w) => w.doc.municipality))].sort();
  // Opština bez potvrđenog popusta: ona sa najmanje (bar 2) verifikovanih naloga (stavke "Potvrdi popust" na stranici Finansije)
  const verifiedIn = (a) => W.filter((w) => w.doc.verified && w.doc.municipality === a).length;
  const PENDING_AREA = (areasUsed.map((a) => [a, verifiedIn(a)]).filter(([, n]) => n >= 2).sort((x, y) => x[1] - y[1] || x[0].localeCompare(y[0]))[0] || ['GROCKA'])[0];
  const discounts = ((curSettings && curSettings.discountsByMunicipality) || []).filter((d) => d.municipality !== PENDING_AREA).map((d) => ({ municipality: d.municipality, discountPercent: d.discountPercent }));
  for (const a of areasUsed) if (a !== PENDING_AREA && !discounts.some((d) => d.municipality === a)) discounts.push({ municipality: a, discountPercent: DISCOUNTS[a] || 0 });
  const techPrices = {};
  for (const def of TECHS) {
    techPrices[def.key] = {};
    for (const [k, v] of Object.entries(PRICES)) techPrices[def.key][CS[k]] = Math.round((v * TECH_SHARE[def.key]) / 10) * 10;
  }
  // Stefanu namerno fali cena za jedan tip usluge (stavka "nedostaje cena tehničara" na stranici Finansije)
  const stefanCs = W.filter((w) => w.doc.verified && w.techs.includes('stefan')).map((w) => w.cs);
  const rare = [...new Set(stefanCs)].sort((a, b) => stefanCs.filter((x) => x === a).length - stefanCs.filter((x) => x === b).length)[0];
  if (rare) delete techPrices.stefan[rare];
  const settingsTechPrices = [...((curSettings && curSettings.technicianPrices) || [])];
  for (const def of TECHS) settingsTechPrices.push({ technicianId: T[def.key]._id, pricesByCustomerStatus: techPrices[def.key] });
  const discountOf = (m) => discounts.find((d) => d.municipality === m);

  const monthly = {}; // plata: zarađeno ka plati po mesecu
  const verifiedWos = W.filter((w) => w.doc.verified).sort((a, b) => a.doc.statusChangedAt - b.doc.statusChangedAt);
  for (const w of verifiedWos) {
    const ts = w.techs.map((k) => T[k]);
    const techNames = ts.map((t) => t.name);
    const fail = (failureReason, failureMessage, field, description, extra = {}) => out.failed.push({
      workOrderId: w._id, failureReason, failureMessage, missingFields: [{ field, description }], attemptCount: 1, lastAttemptAt: w.doc.verifiedAt, resolved: false,
      workOrderDetails: { tisJobId: w.doc.tisJobId, address: w.doc.address, municipality: w.doc.municipality, technicianNames: techNames, customerStatus: w.cs, status: 'zavrsen', verified: true },
      requiresAdminAction: failureReason === 'PENDING_DISCOUNT_CONFIRMATION', createdAt: w.doc.verifiedAt, updatedAt: w.doc.verifiedAt, ...extra,
    });
    const basePrice = prices[w.cs] || 0;
    const pct = w.doc.rejectionPenaltyPercent || 0;
    const entries = [];
    let missing = null;
    for (const t of ts) {
      if (t.paymentType === 'plata') { entries.push({ t, plata: true }); continue; }
      const p = techPrices[t.key][w.cs];
      if (!p) { missing = t; break; }
      const net = round2((p * (100 - pct)) / 100);
      entries.push({ t, gross: round2(p), net, penaltyAmount: round2(p - net) });
    }
    if (missing) { fail('MISSING_TECHNICIAN_PRICING', `Cena za tehničara "${missing.name}" nije postavljena za tip usluge: ${w.cs}`, 'technicianPrices', `Potrebno je postaviti cenu za tehničara "${missing.name}" za tip usluge "${w.cs}" u Finansije sekciji`); continue; }
    const disc = discountOf(w.doc.municipality);
    if (!disc) {
      fail('PENDING_DISCOUNT_CONFIRMATION', `Popust za opštinu "${w.doc.municipality}" nije potvrđen od strane administratora`, 'municipalDiscount', `Potrebno je potvrditi popust za opštinu "${w.doc.municipality}"`, { pendingDiscountConfirmation: { municipality: w.doc.municipality, suggestedDiscount: 0 } });
      continue;
    }
    const discount = disc.discountPercent;
    const finalPrice = basePrice * (1 - discount / 100);
    let remaining = finalPrice;
    let total = 0;
    const technicians = [];
    for (const e of entries.filter((x) => !x.plata)) {
      remaining -= e.gross;
      total += e.net;
      technicians.push({ technicianId: e.t._id, name: e.t.name, earnings: e.net, grossEarnings: e.gross, penaltyPercent: pct, penaltyAmount: e.penaltyAmount, paymentType: 'po_statusu' });
    }
    for (const e of entries.filter((x) => x.plata)) {
      const month = belgradeYmd(w.doc.statusChangedAt).slice(0, 7);
      const key = `${e.t.key}-${month}`;
      const prev = monthly[key] || 0;
      const toSalary = e.t.monthlySalary - prev;
      let earned = 0;
      if (toSalary > 0 && remaining > 0) earned = Math.min(remaining, toSalary);
      remaining -= earned;
      const net = round2((earned * (100 - pct)) / 100);
      const penaltyAmount = round2(round2(earned) - net);
      total += penaltyAmount > 0 ? net : earned;
      monthly[key] = prev + (penaltyAmount > 0 ? net : earned);
      technicians.push({ technicianId: e.t._id, name: e.t.name, earnings: penaltyAmount > 0 ? net : earned, grossEarnings: round2(earned), penaltyPercent: pct, penaltyAmount, paymentType: 'plata', salaryDetails: { monthlySalary: e.t.monthlySalary, earnedTowardsSalary: penaltyAmount > 0 ? net : earned, previouslyEarned: prev, exceededSalary: toSalary <= 0, excessAmount: 0 } });
    }
    out.transactions.push({
      workOrderId: w._id, entryType: 'standard', customerStatus: w.cs, municipality: w.doc.municipality, basePrice, discountPercent: discount, discountAmount: basePrice * (discount / 100),
      finalPrice, technicians, totalTechnicianEarnings: total, companyProfit: finalPrice - total, rejectionPenaltyPercent: pct, rejectionCount: w.doc.rejectionPenaltyCount || 0,
      tisJobId: w.doc.tisJobId, verifiedAt: w.doc.statusChangedAt, createdAt: w.doc.verifiedAt, updatedAt: w.doc.verifiedAt,
    });
  }

  // ----- ocene korisnika -----
  const reviewable = shuffle(W.filter((w) => w.doc.verified && w.doc.verifiedAt < add(NOW, -DAY))).slice(0, 26);
  // loše ocene su skorije (obaveštenja starija od 30 dana briše TTL indeks)
  const badOnes = reviewable.filter((w) => w.doc.verifiedAt > add(NOW, -20 * DAY)).slice(0, 2);
  reviewable.forEach((w) => {
    const bad = badOnes.includes(w);
    const created = notAfterNow(add(w.doc.verifiedAt, int(2, 30) * HOUR));
    const prof = bad ? 2 : weighted([[5, 60], [4, 30], [3, 10]]);
    const r = {
      _id: oid(), workOrderId: w._id, technicianId: T[w.techs[0]]._id, tisJobId: w.doc.tisJobId, customerName: w.doc.userName,
      onTime: bad ? 'Ne, termin je pomeren' : weighted([['Da, tačno na vreme', 75], ['Sa malim zakašnjenjem', 25]]), professionalism: prof,
      cleanInstallation: bad ? 'Ne' : (chance(0.92) ? 'Da' : 'Ne'), cleanInstallationComment: bad ? 'Ostala prašina od bušenja i komadi kabla u hodniku.' : '',
      explanation: bad ? 'Ne, nisu mi pružene informacije' : weighted([['Da, sve je jasno', 80], ['Delimično', 20]]), serviceQuality: bad ? 1 : Math.max(3, prof - int(0, 1)),
      npsScore: bad ? int(1, 3) : int(7, 10), comment: bad ? 'Tehničar kasnio dva sata i nije se javio.' : pick(['Brzo i profesionalno.', 'Sve pohvale, ljubazan tehničar.', 'Instalacija uredna.', '', '']),
      createdAt: created, updatedAt: created,
    };
    out.reviews.push(r);
    w.review = r;
  });

  // ----- pozivi korisniku i podrški (vremenska linija na nalogu) -----
  const SUPPORT_PHONES = { administrative: '011 555 0100', super: '064 555 0200', marko: '064 555 0300', ana: '064 555 0400' };
  const contactWos = shuffle(W.filter((w) => w.techs.length && w.s.ap < NOW && w.s.d >= -10)).slice(0, 14);
  contactWos.forEach((w, i) => {
    const ap = w.doc.appointmentDateTime;
    const rem = add(ap, -30 * MIN);
    for (const k of w.techs) out.contactEvents.push({ workOrderId: w._id, eventType: 'reminder_sent', at: rem, technicianId: T[k]._id, technicianName: T[k].name, source: '', backfilled: false, createdAt: rem, updatedAt: rem });
    Object.assign(w.doc, { reminderSentAt: rem, reminderSentForAppointment: ap });
    const t1 = T[w.techs[0]];
    if (i % 4 !== 3) {
      const c = add(ap, -int(5, 25) * MIN);
      const source = pick(['banner', 'order_card', 'detail_screen', 'notification_action']);
      out.contactEvents.push({ workOrderId: w._id, eventType: 'customer_call', at: c, technicianId: t1._id, technicianName: t1.name, source, backfilled: false, createdAt: c, updatedAt: c });
      Object.assign(w.doc, { customerCallAttemptedAt: c, customerCallSource: source });
    } else {
      const a = add(ap, -15 * MIN);
      out.contactEvents.push({ workOrderId: w._id, eventType: 'uncontacted_alert', at: a, technicianName: w.techs.map((k) => T[k].name).join(', '), source: '', backfilled: false, createdAt: a, updatedAt: a });
      Object.assign(w.doc, { uncontactedAlertSentForAppointment: ap });
      w.uncontactedAlert = a;
    }
    if (i % 2 === 0) {
      const type = pick(['administrative', 'super', 'marko', 'ana']);
      const c = notAfterNow(add(ap, int(10, 60) * MIN));
      out.supportCalls.push({ technicianId: t1._id, technicianName: t1.name, workOrderId: w._id, supportType: type, phoneNumber: SUPPORT_PHONES[type], source: pick(['detail_screen', 'order_card', 'banner']), calledAt: c, createdAt: c, updatedAt: c });
    }
  });

  // ----- obaveštenja (zvonce) za admin naloge -----
  const recipients = [ADMIN, SUPER, SUP];
  const notify = (base, created, readAfterHours = 24) => {
    for (const r of recipients) {
      const isRead = created < add(NOW, -readAfterHours * HOUR) && chance(0.85);
      out.notifications.push({ ...base, recipientId: r._id, isRead, readAt: isRead ? notAfterNow(add(created, int(10, 300) * MIN)) : undefined, createdAt: created, expiresAt: add(created, 30 * DAY) });
    }
  };
  for (const w of W.filter((x) => x.done && x.lastDone && x.lastDone > add(NOW, -7 * DAY))) {
    const t1 = T[w.techs[0]];
    notify({ title: 'Novi radni nalog za verifikaciju', message: `Tehničar ${t1.name} je završio radni nalog koji čeka verifikaciju.`, type: 'work_order_verification', priority: 'high', targetPage: '/work-orders-by-technician', targetTab: 'verification', targetId: String(w._id), workOrderId: w._id, technicianId: t1._id, technicianName: t1.name, createdBy: t1._id }, w.lastDone, w.doc.verified ? 0 : 48);
  }
  for (const w of W.filter((x) => x.uncontactedAlert)) {
    notify({ title: 'Korisnik nije kontaktiran', message: `Tehničar ${w.techs.map((k) => T[k].name).join(', ')} nije pozvao korisnika ${w.doc.userName} (${w.doc.address}) - termin u ${w.doc.time}. Podsetnik je poslat pre više od 15 minuta.`, type: 'customer_not_contacted', priority: 'high', targetPage: '/work-orders-by-technician', targetId: String(w._id), workOrderId: w._id }, w.uncontactedAlert);
  }
  for (const w of W.filter((x) => x.duplicateOf)) {
    notify({ title: 'Nalog na adresi otkazanog naloga', message: `Novi radni nalog (TIS ${w.doc.tisId}) je na adresi "${w.doc.address}" na kojoj postoji ranije otkazan nalog.`, type: 'duplicate_address', priority: 'medium', targetPage: `/work-orders/${w._id}`, targetId: String(w._id), workOrderId: w._id }, add(w.createdAt, MIN));
  }
  for (const r of out.reviews.filter((x) => x.professionalism <= 2)) {
    const t = Object.values(T).find((x) => String(x._id) === String(r.technicianId));
    notify({ title: 'Loša ocena korisnika', message: `Korisnik "${r.customerName}" je dao ocenu ${r.professionalism}/5 tehničaru ${t.name}.`, type: 'low_review_rating', priority: 'high', targetPage: '/technicians', targetId: String(t._id), reviewId: r._id, technicianId: t._id, technicianName: t.name, reviewRating: r.professionalism, customerName: r.customerName }, add(r.createdAt, MIN));
  }
  const nine = NOW > at(TODAY, '09:00') ? at(TODAY, '09:00') : at(ymd(-1), '09:00');
  for (const k of ['marko', 'nemanja']) {
    const t = T[k];
    notify({ title: 'Isticanje ugovora tehničara', message: `Ugovor tehničara "${t.name}" ističe ${t.employedUntil.toLocaleDateString('sr-RS', { timeZone: 'Europe/Belgrade' })}.`, type: 'technician_employment_expiry', priority: 'high', targetPage: '/technicians', targetId: String(t._id), employmentTechnicianId: t._id, employmentTechnicianName: t.name, employmentExpiryDate: t.employedUntil }, nine, 6);
  }

  // ----- vozila -----
  const VEHICLES = [
    ['TEST Kombi 1 - Doblo', 'BG 1234-TE', 'Fiat', 'Doblo Cargo', 2019, 156, 187400, 'active', T.nikola.name],
    ['TEST Kombi 2 - Kangoo', 'BG 2345-TE', 'Renault', 'Kangoo Express', 2021, 12, 96500, 'active', T.marko.name],
    ['TEST Kombi 3 - Berlingo', 'BG 3456-TE', 'Citroën', 'Berlingo', 2020, -4, 143200, 'active', T.djordje.name],
    ['TEST Kombi 4 - Partner', 'BG 4567-TE', 'Peugeot', 'Partner', 2018, 64, 212900, 'maintenance', ''],
    ['TEST Kombi 5 - Caddy', 'BG 5678-TE', 'Volkswagen', 'Caddy Cargo', 2022, 240, 58300, 'active', `${T.nemanja.name}, ${T.stefan.name}`],
    ['TEST Putničko - Logan', 'BG 6789-TE', 'Dacia', 'Logan MCV', 2016, 25, 254100, 'inactive', ''],
  ];
  const SERVICE_TYPES = [['regular', 'Redovan servis, ulje i filteri'], ['oil_change', 'Zamena ulja i filtera ulja'], ['brake_check', 'Zamena prednjih pločica'], ['repair', 'Zamena kvačila'], ['inspection', 'Tehnički pregled'], ['other', 'Zamena guma (zimske)']];
  for (const [name, plate, brand, mdl, year, regDays, mileage, status, assignedTo] of VEHICLES) {
    const created = at(ymd(-int(200, 400)), '10:00');
    const services = [];
    let km = mileage - int(18000, 30000);
    for (const dd of [-int(300, 340), -int(170, 220), -int(40, 90), ...(chance(0.5) ? [-int(3, 20)] : [])]) {
      const [st, comment] = pick(SERVICE_TYPES);
      const parts = st === 'inspection' ? 0 : int(30, 400) * 100;
      const labor = int(20, 120) * 100;
      km += int(4000, 9000);
      const d = dateOnly(ymd(dd));
      services.push({ _id: oid(), date: d, partsPrice: parts, laborPrice: labor, price: parts + labor, comment, mileage: Math.min(km, mileage), nextServiceDue: st === 'regular' ? dateOnly(ymd(dd + 365)) : undefined, serviceType: st, createdAt: add(d, 10 * HOUR), updatedAt: add(d, 10 * HOUR) });
    }
    const v = {
      _id: oid(), name, licensePlate: plate, brand, model: mdl, year, registrationExpiry: dateOnly(ymd(regDays)), registrationRenewalDate: dateOnly(ymd(regDays - 365)),
      insuranceExpiry: dateOnly(ymd(regDays)), inspectionExpiry: dateOnly(ymd(regDays - 2)), mileage, status, services, assignedTo,
      notes: status === 'maintenance' ? 'U servisu do kraja nedelje (kvačilo).' : status === 'inactive' ? 'Rezervno vozilo, koristi se po potrebi.' : '', createdAt: created, updatedAt: services.length ? add(services[services.length - 1].date, 11 * HOUR) : created,
    };
    out.vehicles.push(v);
    adminLog(ADMIN, created, 'vehicle_add', 'vehicles', { entityType: 'vehicle', entityId: v._id, entityName: plate, url: '/api/vehicles', details: { after: { name, licensePlate: plate, brand, model: mdl, year }, action: 'created' } });
    if (regDays <= 30) {
      notify({ title: 'Isticanje registracije vozila', message: `Registracija vozila "${name}" (${plate}) ističe ${v.registrationExpiry.toLocaleDateString('sr-RS', { timeZone: 'Europe/Belgrade' })}.`, type: 'vehicle_registration_expiry', priority: 'high', targetPage: '/vehicle-fleet', targetId: String(v._id), vehicleId: v._id, vehicleName: name, licensePlate: plate, expiryDate: v.registrationExpiry }, nine, 6);
    }
  }

  // ----- anomalija materijala (Logovi > validacija materijala) -----
  if (statsAnomaly.logIndex !== undefined) {
    const l = out.logs[statsAnomaly.logIndex];
    l._id = oid();
    const t = Object.values(T).find((x) => String(x._id) === String(l.performedBy));
    notify({ title: 'Nova anomalija za validaciju materijala', message: `Tehničar ${t.name} prijavio anomaliju materijala "${l.materialDetails.materialType}" u radnom nalogu.`, type: 'material_anomaly', priority: 'medium', targetPage: '/logs', targetTab: 'material-validation', targetId: String(l._id), logId: l._id, technicianId: t._id, technicianName: t.name, workOrderId: l.workOrderId, materialName: l.materialDetails.materialType, anomalyType: 'high', createdBy: t._id }, add(l.timestamp, MIN));
  }

  // ----- GPS lokacije (poslednja lokacija različite starosti, staza kroz dan) -----
  const gpsPlan = [['nikola', 2], ['marko', 9], ['stefan', 26], ['milos', 47], ['djordje', 4], ['nemanja', 190], ['uros', 12 * 24 * 60], ['dejan', 9 * 24 * 60]];
  for (const [k, ageMin] of gpsPlan) {
    const t = T[k];
    const last = add(NOW, -ageMin * MIN);
    const area = pick(AREAS);
    let [lat, lng] = area[4];
    const points = ageMin > 600 ? 3 : int(14, 30);
    for (let i = points - 1; i >= 0; i--) {
      const created = add(last, -i * int(12, 20) * MIN);
      lat += (rnd() - 0.5) * 0.006;
      lng += (rnd() - 0.5) * 0.008;
      const reqType = i === 0 && k === 'marko' ? 'admin_request' : 'background_tracking';
      out.locations.push({
        technicianId: t._id, latitude: Math.round(lat * 1e6) / 1e6, longitude: Math.round(lng * 1e6) / 1e6, accuracy: int(4, 30), altitude: int(80, 140),
        speed: round2(rnd() * 12), heading: int(0, 359), deviceTimestamp: add(created, -int(2, 20) * 1000), requestType: reqType,
        requestId: reqType === 'admin_request' ? `req-${created.getTime()}` : undefined, deviceInfo: { batteryLevel: int(18, 98), isCharging: chance(0.2), networkType: pick(['4G', '4G', '5G', 'WIFI']) },
        createdAt: created, updatedAt: created,
      });
    }
  }

  // ----- backend greške i performanse (stranica Backend logovi) -----
  const ERRORS = [
    ['ServerError', 'queryDate is not defined', 500, '/api/technicians/:id/recordings', 'GET', 'high'],
    ['CastError', 'Cast to ObjectId failed for value "undefined" (type string) at path "_id" for model "WorkOrder"', 400, '/api/workorders/:id', 'GET', 'low'],
    ['ValidationError', 'WorkOrderEvidence validation failed: customerStatus: `` is not a valid enum value for path `customerStatus`.', 400, '/api/workorders/:id/customer-status', 'PUT', 'medium'],
    ['NotFoundError', 'Oprema nije pronađena', 404, '/api/user-equipment', 'POST', 'low'],
    ['UnauthorizedError', 'jwt expired', 401, '/api/technicians/:id/equipment', 'GET', 'low'],
    ['MongoError', 'E11000 duplicate key error collection: equipment index: serialNumber_1 dup key', 500, '/api/equipment/upload', 'POST', 'medium'],
    ['ExternalServiceError', 'Request failed with status code 429 (Cloudinary upload)', 502, '/api/workorders/:id/images', 'POST', 'high'],
    ['DatabaseError', 'connection 3 to 127.0.0.1:27118 timed out', 500, '/api/logs/dashboard/technician-comparison-optimized', 'GET', 'critical'],
  ];
  const actors = [ADMIN, SUPER, SUP, T.nikola, T.marko, T.djordje, T.stefan];
  for (let i = 0; i < 32; i++) {
    const [errorType, errorMessage, statusCode, route, method, severity] = ERRORS[i % ERRORS.length];
    const who = pick(actors);
    const ts = add(NOW, -int(20, 10 * 24 * 60) * MIN);
    const resolved = ts < add(NOW, -2 * DAY) && chance(0.5);
    out.errorLogs.push({
      errorType, errorMessage, errorStack: `${errorType}: ${errorMessage}\n    at ${route.replace(/\/:id.*$/, '')} (routes)`, statusCode, route, method,
      userId: who._id, userName: who.name, userRole: who.role, requestData: { body: {}, params: route.includes(':id') ? { id: String(pick(W)._id) } : {}, query: {} },
      metadata: { ipAddress: '127.0.0.1', userAgent: SEED_UA, requestDuration: int(15, 3000) }, severity, occurrences: int(1, 7), resolved,
      resolvedBy: resolved ? SUPER._id : undefined, resolvedByName: resolved ? SUPER.name : undefined, resolvedAt: resolved ? add(ts, int(1, 30) * HOUR) : undefined,
      notes: resolved ? 'Provereno, ponovljeno ručno bez greške.' : '', timestamp: ts, createdAt: ts, updatedAt: ts,
    });
  }
  const PERF_ROUTES = [['/api/workorders', 'GET'], ['/api/workorders/verification', 'GET'], ['/api/equipment/display', 'GET'], ['/api/technicians', 'GET'], ['/api/users', 'GET'], ['/api/finances/reports', 'GET'], ['/api/logs/technicians', 'GET'], ['/api/workorders/:id/technician-update', 'PUT'], ['/api/user-equipment', 'POST'], ['/api/workorders/:id/used-materials', 'POST'], ['/api/gps/location', 'POST'], ['/api/notifications/unread', 'GET']];
  for (let i = 0; i < 56; i++) {
    const [route, method] = PERF_ROUTES[i % PERF_ROUTES.length];
    const slow = i % 7 === 3;
    const who = pick(actors);
    const ts = add(NOW, -int(5, (slow ? 25 : 6) * 24 * 60) * MIN);
    const statusCode = slow ? 200 : weighted([[200, 85], [304, 5], [400, 5], [500, 5]]);
    out.perfLogs.push({
      route, method, duration: slow ? int(2100, 6800) : int(25, 950), statusCode, userId: who._id, userName: who.name, userRole: who.role,
      queryCount: int(1, 14), cacheHit: chance(0.2), responseSize: int(400, 480000), memoryUsage: { heapUsed: int(-2000000, 9000000), heapTotal: int(90, 160) * 1000000, external: int(2, 6) * 1000000 },
      cpuUsage: { user: int(2000, 400000), system: int(500, 60000) }, isSlow: slow, hasError: statusCode >= 400,
      metadata: { ipAddress: '127.0.0.1', userAgent: SEED_UA, requestSize: method === 'GET' ? 0 : int(200, 4000) }, timestamp: ts, createdAt: ts, updatedAt: ts,
    });
  }

  // ----- konačna polja naloga, korisnika i opreme -----
  for (const w of W) {
    w.doc._id = w._id;
    w.doc.updatedAt = maxDate(w.createdAt, w.doc.statusChangedAt, w.doc.verifiedAt, w.doc.overdueMarkedAt, ...w.doc.rejectionHistory.map((r) => r.rejectedAt));
    out.workorders.push(w.doc);
  }
  for (const u of users) out.users.push({ _id: u._id, tisId: u.tisId, name: u.name, address: u.address, phone: u.phone, workOrders: u.workOrders, createdAt: u.createdAt, updatedAt: u.updatedAt });
  for (const k of Object.keys(T)) { const t = T[k]; out.technicians.push({ ...t, key: undefined, team: undefined, offFrom: undefined, updatedAt: maxDate(t.updatedAt, at(ymd(-1), '18:00')) }); }
  out.technicians.push(SUP);
  out.materials = Object.values(MAT).map(({ _id, type, quantity, createdAt, updatedAt }) => ({ _id, type, quantity, createdAt, updatedAt }));
  out.basic = Object.values(BE);
  const equipment = EQ.map(({ upload, ...it }) => it);

  // ----- upis -----
  const ins = async (M, docs) => (docs.length ? (await M.insertMany(docs, { ordered: true })).length : 0);
  const counts = {};
  counts.technicians = await ins(Technician, out.technicians);
  counts.materials = await ins(Material, out.materials);
  counts.basicequipments = await ins(BasicEquipment, out.basic);
  counts.equipment = await ins(Equipment, equipment);
  counts.users = await ins(User, out.users);
  counts.workorders = await ins(WorkOrder, out.workorders);
  counts.workorderevidences = await ins(WorkOrderEvidence, out.evidences);
  counts.logs = await ins(Log, out.logs);
  counts.financialtransactions = await ins(FinancialTransaction, out.transactions);
  counts.failedfinancialtransactions = await ins(FailedFinancialTransaction, out.failed);
  if (curSettings) await FinancialSettings.updateOne({ _id: curSettings._id }, { $set: { pricesByCustomerStatus: prices, discountsByMunicipality: discounts, technicianPrices: settingsTechPrices } });
  else await FinancialSettings.create({ pricesByCustomerStatus: prices, discountsByMunicipality: discounts, technicianPrices: settingsTechPrices });
  counts['financialsettings (cene TEST tehničara)'] = TECHS.length;
  counts.vehicles = await ins(Vehicle, out.vehicles);
  counts.technicianlocations = await ins(TechnicianLocation, out.locations);
  counts.reviews = await ins(Review, out.reviews);
  counts.supportcalls = await ins(SupportCall, out.supportCalls);
  counts.contactevents = await ins(ContactEvent, out.contactEvents);
  counts.adminactivitylogs = await ins(AdminActivityLog, out.adminLogs);
  counts.errorlogs = await ins(ErrorLog, out.errorLogs);
  counts.performancelogs = await ins(PerformanceLog, out.perfLogs);
  counts.notifications = await ins(Notification, out.notifications);

  // kratak pregled stanja
  const by = (arr, f) => arr.reduce((acc, x) => { const k = f(x); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  const summary = {
    nalozi: by(out.workorders, (w) => w.status),
    timovi: by(out.workorders, (w) => w.tim || 'bez tima'),
    verifikovani: out.workorders.filter((w) => w.verified).length,
    cekajuVerifikaciju: out.workorders.filter((w) => w.status === 'zavrsen' && !w.verified).length,
    vraceniNaIspravku: out.workorders.filter((w) => w.rejectionHistory.length).length,
    prekoraceni: out.workorders.filter((w) => w.isOverdue).length,
    nedodeljeni: out.workorders.filter((w) => !w.technicianId).length,
    oprema: by(equipment, (e) => (e.location.startsWith('tehnicar-') ? `kod tehničara (${e.status})` : e.location.startsWith('user-') ? 'kod korisnika' : e.location)),
  };
  return { counts, summary };
}

(async () => {
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 5000 });
  const c = mongoose.connection;
  if (c.host !== '127.0.0.1' || Number(c.port) !== 27118 || c.name !== DB_NAME) throw new Error(`neočekivana veza ${c.host}:${c.port}/${c.name}`);
  console.log(`[montaza-seed] baza ${c.host}:${c.port}/${c.name}`);
  const existing = await Technician.countDocuments({ name: /^TEST / });
  if (RESET) {
    const deleted = await resetTestData();
    console.log('[montaza-seed] obrisano:', Object.keys(deleted).length ? deleted : 'ništa (nije bilo TEST podataka)');
  } else if (existing) {
    throw new Error(`TEST podaci već postoje (${existing} TEST tehničara). Pokreni sa --reset (ili --only-reset za samo brisanje).`);
  }
  if (!ONLY_RESET) {
    const { counts, summary } = await seed();
    console.log('[montaza-seed] ubačeno:', counts);
    console.log('[montaza-seed] pregled:', JSON.stringify(summary, null, 1));
  }
  await mongoose.disconnect();
})().catch(async (e) => {
  console.error('[montaza-seed] greška:', e && e.message ? e.message : e);
  if (e && e.errors) console.error(Object.values(e.errors).slice(0, 5).map((x) => x.message || x));
  if (e && e.writeErrors) console.error(e.writeErrors.slice(0, 3).map((x) => x.errmsg || x.err || x));
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
