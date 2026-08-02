const express = require('express');
const router = express.Router();
const { auth, isAdmin } = require('../middleware/auth');
const PushSubscription = require('../models/PushSubscription');
const webPushService = require('../services/webPushService');

// Javni VAPID ključ — frontend ga koristi za pushManager.subscribe
router.get('/vapid-public-key', auth, (req, res) => {
  if (!webPushService.isConfigured()) {
    return res.status(503).json({ error: 'Web push nije konfigurisan na serveru' });
  }
  res.json({ publicKey: webPushService.getPublicKey() });
});

// Registruj/osveži pretplatu browsera za ulogovanog admina
router.post('/subscribe', auth, isAdmin, async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: 'Neispravna pretplata' });
    }

    await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        $set: {
          userId: req.user._id,
          userName: req.user.name || '',
          subscription,
          userAgent: (req.headers['user-agent'] || '').slice(0, 200),
          lastUsedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, new: true }
    );

    console.log(`[WebPush] Pretplata registrovana za ${req.user.name} (${req.user.role})`);
    res.json({ success: true });
  } catch (error) {
    console.error('[WebPush] Greška pri registraciji pretplate:', error.message);
    res.status(500).json({ error: 'Greška pri registraciji pretplate' });
  }
});

// Odjavi pretplatu (npr. korisnik isključi notifikacije)
router.post('/unsubscribe', auth, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      return res.status(400).json({ error: 'Endpoint je obavezan' });
    }
    await PushSubscription.deleteOne({ endpoint });
    res.json({ success: true });
  } catch (error) {
    console.error('[WebPush] Greška pri odjavi pretplate:', error.message);
    res.status(500).json({ error: 'Greška pri odjavi pretplate' });
  }
});

module.exports = router;
