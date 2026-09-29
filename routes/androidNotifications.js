const express = require('express');
const router = express.Router();
const AndroidNotification = require('../models/AndroidNotification');
const Technician = require('../models/Technician');
const { auth } = require('../middleware/auth');
const SecurityWorker = require('../models/SecurityWorker');

// Robotik Security: radnik obezbeđenja nema inbox tehničara, ali ima push token
async function securityTokenRoute(req, res, register) {
  const worker = await SecurityWorker.findById(req.user.id);
  if (!worker) return res.status(403).json({ success: false, message: 'Nalog nije pronađen' });
  if (register) {
    const { pushToken } = req.body;
    if (!pushToken) return res.status(400).json({ success: false, message: 'Push token je obavezan' });
    // Isti telefon ne sme da prima alarme za dva radnika (službeni telefon koji se deli)
    await SecurityWorker.updateMany({ pushToken, _id: { $ne: worker._id } }, { $set: { pushToken: null } });
    worker.pushToken = pushToken;
    worker.pushEnabled = true;
  } else {
    worker.pushToken = null;
  }
  await worker.save();
  return res.json({ success: true, message: register ? 'Push token uspešno registrovan' : 'Push token uspešno odjavljen', pushToken: register ? worker.pushToken : undefined });
}

// GET /api/android-notifications - Sve notifikacije za trenutnog tehničara
router.get('/', auth, async (req, res) => {
  if (req.user.kind === 'security') return res.json({ success: true, notifications: [], totalCount: 0, unreadCount: 0 });
  try {
    // Proveri da li je korisnik tehničar
    const technician = await Technician.findById(req.user.id);
    if (!technician) {
      return res.status(403).json({
        success: false,
        message: 'Samo tehničari mogu pristupiti notifikacijama'
      });
    }

    // Dohvati notifikacije (poslednje 7 dana, max 50)
    const notifications = await AndroidNotification.find({
      technicianId: req.user.id
    })
      .sort({ createdAt: -1 })
      .limit(50);

    // Formatiraj notifikacije za frontend
    const formattedNotifications = notifications.map(notification => ({
      _id: notification._id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      relatedId: notification.relatedId,
      relatedData: notification.relatedData,
      isRead: notification.isRead,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
      timeAgo: notification.timeAgo,
      formattedDate: notification.formattedDate,
      pushSent: notification.pushSent
    }));

    res.json({
      success: true,
      notifications: formattedNotifications,
      totalCount: formattedNotifications.length,
      unreadCount: formattedNotifications.filter(n => !n.isRead).length
    });

  } catch (error) {
    console.error('Greška pri dohvatanju Android notifikacija:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri dohvatanju notifikacija',
      error: error.message
    });
  }
});

// GET /api/android-notifications/unread-count - Broj nepročitanih notifikacija
router.get('/unread-count', auth, async (req, res) => {
  if (req.user.kind === 'security') return res.json({ success: true, unreadCount: 0 });
  try {
    // Proveri da li je korisnik tehničar
    const technician = await Technician.findById(req.user.id);
    if (!technician) {
      return res.status(403).json({
        success: false,
        message: 'Samo tehničari mogu pristupiti notifikacijama'
      });
    }

    const unreadCount = await AndroidNotification.countDocuments({
      technicianId: req.user.id,
      isRead: false
    });

    res.json({
      success: true,
      unreadCount
    });

  } catch (error) {
    console.error('Greška pri dohvatanju broja nepročitanih notifikacija:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri dohvatanju broja nepročitanih',
      error: error.message
    });
  }
});

// PUT /api/android-notifications/:id/read - Označi notifikaciju kao pročitanu
router.put('/:id/read', auth, async (req, res) => {
  try {
    const notification = await AndroidNotification.findOne({
      _id: req.params.id,
      technicianId: req.user.id
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notifikacija nije pronađena'
      });
    }

    await notification.markAsRead();

    res.json({
      success: true,
      message: 'Notifikacija označena kao pročitana',
      notification: {
        _id: notification._id,
        isRead: notification.isRead,
        readAt: notification.readAt
      }
    });

  } catch (error) {
    console.error('Greška pri označavanju notifikacije kao pročitane:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri označavanju notifikacije',
      error: error.message
    });
  }
});

// PUT /api/android-notifications/mark-all-read - Označi sve notifikacije kao pročitane
router.put('/mark-all-read', auth, async (req, res) => {
  try {
    const now = new Date();
    const serbianTime = new Date(now.getTime() + (2 * 60 * 60 * 1000));

    const result = await AndroidNotification.updateMany(
      {
        technicianId: req.user.id,
        isRead: false
      },
      {
        isRead: true,
        readAt: serbianTime
      }
    );

    res.json({
      success: true,
      message: 'Sve notifikacije označene kao pročitane',
      modifiedCount: result.modifiedCount
    });

  } catch (error) {
    console.error('Greška pri označavanju svih notifikacija kao pročitane:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri označavanju svih notifikacija',
      error: error.message
    });
  }
});

// DELETE /api/android-notifications/unregister-token - Odjavi push notification token
// MORA biti IZNAD /:id rute, inače Express matchuje "unregister-token" kao :id parametar
router.delete('/unregister-token', auth, async (req, res) => {
  if (req.user.kind === 'security') return securityTokenRoute(req, res, false).catch(() => res.status(500).json({ success: false }));
  try {
    const technician = await Technician.findById(req.user.id);
    if (!technician) {
      return res.status(403).json({
        success: false,
        message: 'Tehničar nije pronađen'
      });
    }

    technician.pushNotificationToken = null;
    technician.pushNotificationsEnabled = false;
    await technician.save();

    console.log(`🔕 Push token odjavljen za tehničara ${technician.name}`);

    res.json({
      success: true,
      message: 'Push token uspešno odjavljen'
    });

  } catch (error) {
    console.error('Greška pri odjavi push tokena:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri odjavi push tokena',
      error: error.message
    });
  }
});

// DELETE /api/android-notifications/:id - Obriši notifikaciju
router.delete('/:id', auth, async (req, res) => {
  try {
    const notification = await AndroidNotification.findOneAndDelete({
      _id: req.params.id,
      technicianId: req.user.id
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notifikacija nije pronađena'
      });
    }

    res.json({
      success: true,
      message: 'Notifikacija obrisana'
    });

  } catch (error) {
    console.error('Greška pri brisanju notifikacije:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri brisanju notifikacije',
      error: error.message
    });
  }
});

// POST /api/android-notifications/debug-register - Debug endpoint za testiranje registracije
router.post('/debug-register', auth, async (req, res) => {
  console.log('=== DEBUG REGISTER CALLED ===');
  console.log('User:', req.user);
  console.log('Body:', req.body);
  console.log('Headers:', req.headers);

  res.json({
    success: true,
    message: 'Debug endpoint reached',
    user: req.user,
    body: req.body,
    timestamp: new Date().toISOString()
  });
});

// POST /api/android-notifications/register-token - Registruj push notification token
router.post('/register-token', auth, async (req, res) => {
  if (req.user.kind === 'security') return securityTokenRoute(req, res, true).catch(() => res.status(500).json({ success: false }));
  try {
    console.log('=== REGISTER PUSH TOKEN REQUEST ===');
    console.log('User from auth:', {
      id: req.user?.id,
      _id: req.user?._id,
      name: req.user?.name,
      role: req.user?.role
    });
    console.log('Body:', req.body);

    const { pushToken } = req.body;

    if (!pushToken) {
      console.log('ERROR: Push token missing in body');
      return res.status(400).json({
        success: false,
        message: 'Push token je obavezan'
      });
    }

    // Proveri da li je korisnik tehničar
    const userId = req.user.id || req.user._id;
    console.log('Looking for technician with ID:', userId);

    const technician = await Technician.findById(userId);
    console.log('Technician found:', technician ? technician.name : 'NOT FOUND');

    if (!technician) {
      console.log('ERROR: Technician not found for user ID:', userId);
      // Debug: pretraži sve tehničare
      const allTechs = await Technician.find({}).select('_id name');
      console.log('All technicians in DB:', allTechs.map(t => ({ id: t._id.toString(), name: t.name })));

      return res.status(403).json({
        success: false,
        message: 'Samo tehničari mogu registrovati push token',
        debug: {
          searchedId: userId,
          availableTechnicians: allTechs.map(t => t.name)
        }
      });
    }

    // Sačuvaj token
    const oldToken = technician.pushNotificationToken;
    technician.pushNotificationToken = pushToken;
    technician.pushNotificationsEnabled = true;
    await technician.save();

    console.log(`✅ Push token registrovan za tehničara ${technician.name}`);
    console.log(`   Old token: ${oldToken ? oldToken.substring(0, 30) + '...' : 'null'}`);
    console.log(`   New token: ${pushToken.substring(0, 30)}...`);

    res.json({
      success: true,
      message: 'Push token uspešno registrovan',
      pushToken
    });

  } catch (error) {
    console.error('=== REGISTER TOKEN ERROR ===');
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri registrovanju push tokena',
      error: error.message
    });
  }
});

// GET /api/android-notifications/debug-tokens - Debug endpoint za proveru tokena
router.get('/debug-tokens', auth, async (req, res) => {
  try {
    // Samo za superadmin/supervisor
    if (!['superadmin', 'supervisor'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Nemate pristup' });
    }

    const allTechnicians = await Technician.find({})
      .select('name phoneNumber pushNotificationToken pushNotificationsEnabled role')
      .lean();

    const stats = {
      total: allTechnicians.length,
      withValidToken: 0,
      withNullToken: 0,
      withEmptyToken: 0,
      technicians: []
    };

    allTechnicians.forEach(t => {
      const token = t.pushNotificationToken;
      let tokenStatus;

      if (token === null || token === undefined) {
        tokenStatus = 'NULL';
        stats.withNullToken++;
      } else if (token === '') {
        tokenStatus = 'EMPTY';
        stats.withEmptyToken++;
      } else if (typeof token === 'string' && token.startsWith('ExponentPushToken[')) {
        tokenStatus = 'VALID';
        stats.withValidToken++;
      } else {
        tokenStatus = 'INVALID_FORMAT';
      }

      stats.technicians.push({
        name: t.name,
        role: t.role,
        phoneNumber: t.phoneNumber || 'N/A',
        tokenStatus,
        tokenPreview: token ? token.substring(0, 40) + '...' : null,
        notificationsEnabled: t.pushNotificationsEnabled
      });
    });

    res.json(stats);

  } catch (error) {
    console.error('Debug tokens error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/android-notifications/manual-register-token - Ručna registracija tokena (za testiranje)
router.post('/manual-register-token', auth, async (req, res) => {
  try {
    // Samo za superadmin
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Samo superadmin može ručno registrovati tokene' });
    }

    const { technicianName, pushToken } = req.body;

    if (!technicianName || !pushToken) {
      return res.status(400).json({ error: 'technicianName i pushToken su obavezni' });
    }

    const technician = await Technician.findOne({ name: technicianName });
    if (!technician) {
      return res.status(404).json({ error: `Tehničar "${technicianName}" nije pronađen` });
    }

    technician.pushNotificationToken = pushToken;
    technician.pushNotificationsEnabled = true;
    await technician.save();

    console.log(`✅ Manual token registration for ${technicianName}: ${pushToken.substring(0, 30)}...`);

    res.json({
      success: true,
      message: `Token registrovan za ${technicianName}`,
      technician: {
        name: technician.name,
        tokenPreview: pushToken.substring(0, 40) + '...'
      }
    });

  } catch (error) {
    console.error('Manual register token error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
