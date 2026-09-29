// Pravila Security modula (alarmi, smene, satnica, provere ugovora). Izmene važe od sledećeg minuta.
const express = require('express');
const SecuritySettings = require('../../models/SecuritySettings');
const { isSecurityStaff, isSecurityAdmin } = require('../../middleware/securityAuth');
const { getSettings, invalidateSettings } = require('../../services/security/settings');
const { serbianHolidays } = require('../../services/security/time');
const { ah, httpError, isHHMM } = require('./helpers');

const router = express.Router();
router.use(isSecurityStaff);

router.get('/', ah(async (req, res) => {
  const s = await getSettings();
  res.json({ ...s, history: (s.history || []).slice(-30).reverse() });
}));

router.get('/holidays', ah(async (req, res) => {
  const y = Number(req.query.year) || new Date().getFullYear();
  res.json(serbianHolidays(y).sort((a, b) => a.date.localeCompare(b.date)));
}));

const num = (v, min, max, label) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw httpError(400, `${label}: vrednost mora biti od ${min} do ${max}.`);
  return Math.round(n);
};

const LABELS = {
  'alarms.enabled': 'Alarmi uključeni', 'alarms.lateMin': 'Alarm radniku (min)', 'alarms.masterMin': 'MASTER ALARM (min)',
  'alarms.checkpointTolMin': 'Tolerancija checkpointa (min)', 'alarms.snoozeMin': 'Odlaganje (min)', 'alarms.maxSnoozes': 'Broj odlaganja',
  'alarms.noClockOutEnabled': 'Alarm za nedostajuću odjavu', 'alarms.noClockOutMin': 'Nedostajuća odjava (min)', 'alarms.earlyClockInMin': 'Prijava ranije (min)',
  'expiry.contractDays': 'Ugovor, dana pre isteka', 'expiry.licenseEnabled': 'Alarm za licence', 'expiry.licenseDays': 'Licenca, dana pre isteka',
  'expiry.dailyTime': 'Vreme dnevne provere', 'expiry.emailAdmins': 'Email adminima',
  'pay.defaultRate': 'Podrazumevana satnica', 'pay.nightPct': 'Noćni rad (%)', 'pay.holidayPct': 'Praznik (%)', 'pay.overtimePct': 'Prekovremeni (%)',
  'reports.ccCoordinator': 'Kopija izveštaja koordinatoru', 'reports.attachPdf': 'PDF u prilogu', gpsRadiusM: 'GPS radius (m)'
};

// PUT /api/security/settings  (šalju se samo polja koja se menjaju)
router.put('/', isSecurityAdmin, ah(async (req, res) => {
  const b = req.body || {};
  const doc = await SecuritySettings.findOne({ key: 'global' }) || new SecuritySettings({ key: 'global' });
  const changes = [];
  const set = (pathKey, value) => {
    const [a, c] = pathKey.split('.');
    const before = c ? doc[a][c] : doc[a];
    if (JSON.stringify(before) === JSON.stringify(value)) return;
    if (c) doc[a][c] = value; else doc[a] = value;
    changes.push(`${LABELS[pathKey] || pathKey}: ${Array.isArray(before) ? before.join(', ') : before} → ${Array.isArray(value) ? value.join(', ') : value}`);
  };
  const a = b.alarms || {};
  if (a.enabled !== undefined) set('alarms.enabled', !!a.enabled);
  if (a.lateMin !== undefined) set('alarms.lateMin', num(a.lateMin, 1, 120, 'Alarm radniku'));
  if (a.masterMin !== undefined) set('alarms.masterMin', num(a.masterMin, 2, 240, 'MASTER ALARM'));
  if (a.checkpointTolMin !== undefined) set('alarms.checkpointTolMin', num(a.checkpointTolMin, 0, 60, 'Tolerancija'));
  if (a.snoozeMin !== undefined) set('alarms.snoozeMin', num(a.snoozeMin, 1, 60, 'Odlaganje'));
  if (a.maxSnoozes !== undefined) set('alarms.maxSnoozes', num(a.maxSnoozes, 1, 5, 'Broj odlaganja'));
  if (a.noClockOutEnabled !== undefined) set('alarms.noClockOutEnabled', !!a.noClockOutEnabled);
  if (a.noClockOutMin !== undefined) set('alarms.noClockOutMin', num(a.noClockOutMin, 5, 240, 'Nedostajuća odjava'));
  if (a.earlyClockInMin !== undefined) set('alarms.earlyClockInMin', num(a.earlyClockInMin, 0, 240, 'Prijava ranije'));
  if (doc.alarms.masterMin <= doc.alarms.lateMin) throw httpError(400, 'MASTER ALARM mora da ide posle alarma radniku.');

  const e = b.expiry || {};
  const days = (v, label) => {
    const arr = (Array.isArray(v) ? v : String(v).split(',')).map((x) => num(x, 0, 365, label));
    return [...new Set(arr)].sort((x, y) => y - x);
  };
  if (e.contractDays !== undefined) set('expiry.contractDays', days(e.contractDays, 'Ugovor'));
  if (e.licenseEnabled !== undefined) set('expiry.licenseEnabled', !!e.licenseEnabled);
  if (e.licenseDays !== undefined) set('expiry.licenseDays', days(e.licenseDays, 'Licenca'));
  if (e.dailyTime !== undefined) { if (!isHHMM(e.dailyTime)) throw httpError(400, 'Neispravno vreme dnevne provere.'); set('expiry.dailyTime', e.dailyTime); }
  if (e.emailAdmins !== undefined) set('expiry.emailAdmins', !!e.emailAdmins);

  const p = b.pay || {};
  if (p.defaultRate !== undefined) set('pay.defaultRate', num(p.defaultRate, 0, 100000, 'Satnica'));
  if (p.nightPct !== undefined) set('pay.nightPct', num(p.nightPct, 0, 300, 'Noćni rad'));
  if (p.holidayPct !== undefined) set('pay.holidayPct', num(p.holidayPct, 0, 300, 'Praznik'));
  if (p.overtimePct !== undefined) set('pay.overtimePct', num(p.overtimePct, 0, 300, 'Prekovremeni'));

  const r = b.reports || {};
  if (r.ccCoordinator !== undefined) set('reports.ccCoordinator', !!r.ccCoordinator);
  if (r.attachPdf !== undefined) set('reports.attachPdf', !!r.attachPdf);
  if (b.gpsRadiusM !== undefined) set('gpsRadiusM', num(b.gpsRadiusM, 50, 5000, 'GPS radius'));

  if (changes.length) doc.history.push({ at: new Date(), byName: req.user.name, changes: changes.join('; ') });
  await doc.save();
  invalidateSettings();
  const s = await getSettings();
  res.json({ ...s, history: (s.history || []).slice(-30).reverse(), changed: changes.length });
}));

module.exports = router;
