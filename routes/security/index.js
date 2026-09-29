// Robotik Security API: /api/security/*
const express = require('express');
const { auth } = require('../../middleware/auth');

const router = express.Router();
router.use(auth);

router.use('/facilities', require('./facilities'));
router.use('/tags', require('./tags'));
router.use('/workers', require('./workers'));
router.use('/shifts', require('./shifts'));
router.use('/alarms', require('./alarms'));
router.use('/tasks', require('./tasks'));
router.use('/reports', require('./reports'));
router.use('/timesheets', require('./timesheets'));
router.use('/settings', require('./settings'));
router.use('/live', require('./live'));
router.use('/me', require('./me'));

// Pomoćne rute samo za lokalni pre-prod i E2E testove (nikad u produkciji)
if (process.env.SECURITY_TEST_HOOKS === '1') {
  router.use('/_test', require('./testHooks'));
  console.log('⚠️  Security test hooks su uključeni (SECURITY_TEST_HOOKS=1)');
}

module.exports = router;
