const express = require('express');
const router = express.Router();
const AndroidNotification = require('../models/AndroidNotification');
const Technician = require('../models/Technician');
const { auth } = require('../middleware/auth');

// GET /api/android-notifications - Sve notifikacije za trenutnog tehničara
router.get('/', auth, async (req, res) => {
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

// POST /api/android-notifications/register-token - Registruj push notification token
router.post('/register-token', auth, async (req, res) => {
  try {
    const { pushToken } = req.body;

    if (!pushToken) {
      return res.status(400).json({
        success: false,
        message: 'Push token je obavezan'
      });
    }

    // Proveri da li je korisnik tehničar
    const technician = await Technician.findById(req.user.id);
    if (!technician) {
      return res.status(403).json({
        success: false,
        message: 'Samo tehničari mogu registrovati push token'
      });
    }

    // Sačuvaj token
    technician.pushNotificationToken = pushToken;
    technician.pushNotificationsEnabled = true;
    await technician.save();

    console.log(`✅ Push token registrovan za tehničara ${technician.name}: ${pushToken}`);

    res.json({
      success: true,
      message: 'Push token uspešno registrovan',
      pushToken
    });

  } catch (error) {
    console.error('Greška pri registrovanju push tokena:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri registrovanju push tokena',
      error: error.message
    });
  }
});

// DELETE /api/android-notifications/unregister-token - Odjavi push notification token
router.delete('/unregister-token', auth, async (req, res) => {
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

    console.log(`🔕 Push token odjav ljen za tehničara ${technician.name}`);

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

module.exports = router;
