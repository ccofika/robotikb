// SAMO za lokalni pre-prod i E2E testove (uključuje se sa SECURITY_TEST_HOOKS=1).
// Omogućava testu da pokrene cron odmah i da pomeri vreme smene, umesto da čeka satima.
const express = require('express');
const SecurityShift = require('../../models/SecurityShift');
const { isSecurityAdmin } = require('../../middleware/securityAuth');
const { runEngine } = require('../../services/security/alarmEngine');
const { runDailyChecks } = require('../../services/security/expiryService');
const { ah, httpError, requireId } = require('./helpers');

const router = express.Router();
router.use(isSecurityAdmin);

router.post('/run-engine', ah(async (req, res) => {
  res.json(await runEngine(req.body.at ? new Date(req.body.at) : new Date()));
}));

router.post('/run-daily', ah(async (req, res) => {
  res.json(await runDailyChecks(req.body.at ? new Date(req.body.at) : new Date()));
}));

// Pomeri smenu tako da počinje startOffsetMin minuta od sada (negativno = već je počela)
router.post('/shift-times', ah(async (req, res) => {
  requireId(req.body.shiftId, 'smena');
  const sh = await SecurityShift.findById(req.body.shiftId);
  if (!sh) throw httpError(404, 'Smena nije pronađena.');
  const start = new Date(Date.now() + Number(req.body.startOffsetMin || 0) * 60000);
  const dur = Number(req.body.durationMin || 720);
  const delta = start.getTime() - sh.plannedStart.getTime();
  sh.plannedStart = start;
  sh.plannedEnd = new Date(start.getTime() + dur * 60000);
  sh.rounds.forEach((r) => { r.dueAt = new Date(r.dueAt.getTime() + delta); });
  await sh.save();
  res.json(sh);
}));

// Virtuelni sat procesa (uključuje ga samo preprod-security/scripts/start-backend.js): { at } ili { reset: true }
const testClock = () => global.__securityTestClock || null;
router.get('/clock', (req, res) => res.json(testClock() ? testClock().state() : { installed: false }));
router.post('/clock', ah(async (req, res) => {
  const c = testClock();
  if (!c) throw httpError(501, 'Virtuelni sat nije uključen (backend nije pokrenut preko preprod-security).');
  if (req.body.reset) return res.json(c.reset());
  try { return res.json(c.set(req.body.at)); } catch (e) { throw httpError(400, e.message); }
}));

// Veštačka kašnjenja u ms za testove trka ({ raiseAlarm: 40 }, prazno telo = bez kašnjenja)
router.post('/delays', (req, res) => {
  global.__securityTestDelays = { ...(req.body || {}) };
  res.json(global.__securityTestDelays);
});

// Pomeri planirano vreme jedne tačke obilaska (offsetMin od sada)
router.post('/round-due', ah(async (req, res) => {
  requireId(req.body.shiftId, 'smena');
  const sh = await SecurityShift.findById(req.body.shiftId);
  if (!sh || !sh.rounds[req.body.index]) throw httpError(404, 'Tačka nije pronađena.');
  sh.rounds[req.body.index].dueAt = new Date(Date.now() + Number(req.body.offsetMin || 0) * 60000);
  await sh.save();
  res.json(sh);
}));

module.exports = router;
