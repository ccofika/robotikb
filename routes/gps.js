const express = require('express');
const router = express.Router();
const TechnicianLocation = require('../models/TechnicianLocation');
const Technician = require('../models/Technician');
const { auth } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

// ============================================
// GPS Location Tracking Routes
// ============================================

/**
 * POST /api/gps/request-locations
 * Admin zahteva GPS lokacije od svih tehničara
 * Šalje push notifikaciju svim tehničarima da pošalju svoju lokaciju
 */
router.post('/request-locations', auth, async (req, res) => {
  try {
    // Samo admin, superadmin, supervisor mogu zatražiti lokacije
    if (!['admin', 'superadmin', 'supervisor'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Nemate dozvolu za ovu akciju'
      });
    }

    console.log('=== GPS LOCATION REQUEST START ===');
    console.log(`📍 Admin ${req.user.name} zahteva GPS lokacije svih tehničara`);

    // Generisanje jedinstvenog ID-a za ovaj zahtev
    const requestId = uuidv4();

    // Dohvati sve tehničare sa validnim push tokenom
    const allTechnicians = await Technician.find({})
      .select('name pushNotificationToken pushNotificationsEnabled phoneNumber');

    console.log(`DEBUG: Ukupno tehničara u bazi: ${allTechnicians.length}`);

    // DEBUG: Prikaži sve tokene
    console.log('DEBUG: Token status za svakog tehničara:');
    allTechnicians.forEach(t => {
      const token = t.pushNotificationToken;
      let status;
      if (!token) {
        status = 'NULL/undefined';
      } else if (token === '') {
        status = 'EMPTY STRING';
      } else if (typeof token === 'string' && token.startsWith('ExponentPushToken[')) {
        status = `VALID: ${token.substring(0, 40)}...`;
      } else {
        status = `INVALID FORMAT: ${typeof token} - ${String(token).substring(0, 30)}...`;
      }
      console.log(`  - ${t.name}: ${status}`);
    });

    // Filtriraj samo one sa VALIDNIM tokenom
    const technicians = allTechnicians.filter(t => {
      const token = t.pushNotificationToken;
      const isValid = typeof token === 'string' &&
                     token.length > 0 &&
                     token.startsWith('ExponentPushToken[');
      return isValid;
    });

    console.log(`Pronađeno ${technicians.length} tehničara sa validnim push tokenom`);

    if (technicians.length === 0) {
      return res.json({
        success: true,
        requestId,
        message: 'Nema tehničara sa aktivnim push tokenima. Tehničari moraju instalirati mobilnu aplikaciju.',
        totalTechnicians: allTechnicians.length,
        successCount: 0,
        failCount: 0
      });
    }

    let successCount = 0;
    let failCount = 0;
    const errors = [];

    // Pošalji push notifikaciju svakom tehničaru
    for (const technician of technicians) {
      try {
        const pushToken = technician.pushNotificationToken;

        // Data-only notifikacija za GPS zahtev
        const message = {
          to: pushToken,
          data: {
            type: 'gps_location_request',
            action: 'send_location',
            requestId: requestId,
            timestamp: new Date().toISOString()
          },
          priority: 'high',
          // Za Android - data-only notifikacija koja budi app
          _contentAvailable: true
        };

        console.log(`Sending GPS request to ${technician.name}...`);
        const response = await axios.post('https://exp.host/--/api/v2/push/send', message, {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          timeout: 10000
        });

        const result = response.data;

        if (result.data && result.data[0] && result.data[0].status === 'ok') {
          console.log(`✅ GPS zahtev poslan: ${technician.name}`);
          successCount++;
        } else {
          const errorMsg = result.data?.[0]?.message || 'Unknown error';
          console.log(`❌ Neuspešno za ${technician.name}:`, errorMsg);
          failCount++;
          errors.push({ name: technician.name, error: errorMsg });
        }

      } catch (techError) {
        console.error(`❌ Greška za ${technician.name}:`, techError.message);
        failCount++;
        errors.push({ name: technician.name, error: techError.message });
      }
    }

    console.log(`📊 GPS zahtevi: ${successCount} uspešno, ${failCount} neuspešno`);
    console.log('=== GPS LOCATION REQUEST END ===');

    res.json({
      success: true,
      requestId,
      message: `GPS zahtev poslan. Uspešno: ${successCount}, Neuspešno: ${failCount}`,
      totalTechnicians: technicians.length,
      successCount,
      failCount,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('GPS request error:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri slanju GPS zahteva',
      error: error.message
    });
  }
});

/**
 * POST /api/gps/location
 * Tehničar šalje svoju GPS lokaciju (odgovor na zahtev ili manuelno)
 */
router.post('/location', auth, async (req, res) => {
  try {
    const {
      latitude,
      longitude,
      accuracy,
      altitude,
      speed,
      heading,
      deviceTimestamp,
      requestId,
      requestType = 'admin_request',
      deviceInfo
    } = req.body;

    // Validacija
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Latitude i longitude su obavezni'
      });
    }

    // Pronađi tehničara
    const technician = await Technician.findById(req.user.id);
    if (!technician) {
      return res.status(404).json({
        success: false,
        message: 'Tehničar nije pronađen'
      });
    }

    // Sačuvaj lokaciju
    const location = new TechnicianLocation({
      technicianId: req.user.id,
      latitude,
      longitude,
      accuracy,
      altitude,
      speed,
      heading,
      deviceTimestamp: deviceTimestamp ? new Date(deviceTimestamp) : null,
      requestId,
      requestType,
      deviceInfo
    });

    await location.save();

    console.log(`📍 GPS lokacija primljena od ${technician.name}: ${latitude}, ${longitude}`);

    res.json({
      success: true,
      message: 'Lokacija uspešno sačuvana',
      location: {
        _id: location._id,
        latitude: location.latitude,
        longitude: location.longitude,
        createdAt: location.createdAt
      }
    });

  } catch (error) {
    console.error('GPS location save error:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri čuvanju lokacije',
      error: error.message
    });
  }
});

/**
 * GET /api/gps/locations
 * Dohvata poslednje lokacije svih tehničara (za mapu)
 */
router.get('/locations', auth, async (req, res) => {
  try {
    // Samo admin, superadmin, supervisor mogu videti lokacije
    if (!['admin', 'superadmin', 'supervisor'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Nemate dozvolu za ovu akciju'
      });
    }

    const locations = await TechnicianLocation.getLatestLocationsForAll();

    res.json({
      success: true,
      locations,
      count: locations.length
    });

  } catch (error) {
    console.error('GPS locations fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri dohvatanju lokacija',
      error: error.message
    });
  }
});

/**
 * GET /api/gps/locations/:technicianId
 * Dohvata istoriju lokacija za jednog tehničara
 */
router.get('/locations/:technicianId', auth, async (req, res) => {
  try {
    // Samo admin, superadmin, supervisor mogu videti lokacije
    if (!['admin', 'superadmin', 'supervisor'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Nemate dozvolu za ovu akciju'
      });
    }

    const { technicianId } = req.params;
    const { limit = 50 } = req.query;

    const locations = await TechnicianLocation.find({ technicianId })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .populate('technicianId', 'name phoneNumber profileImage');

    res.json({
      success: true,
      locations,
      count: locations.length
    });

  } catch (error) {
    console.error('GPS location history fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri dohvatanju istorije lokacija',
      error: error.message
    });
  }
});

/**
 * GET /api/gps/locations/request/:requestId
 * Dohvata sve lokacije za određeni zahtev
 */
router.get('/locations/request/:requestId', auth, async (req, res) => {
  try {
    // Samo admin, superadmin, supervisor mogu videti lokacije
    if (!['admin', 'superadmin', 'supervisor'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Nemate dozvolu za ovu akciju'
      });
    }

    const { requestId } = req.params;

    const locations = await TechnicianLocation.find({ requestId })
      .populate('technicianId', 'name phoneNumber profileImage')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      requestId,
      locations,
      count: locations.length
    });

  } catch (error) {
    console.error('GPS request locations fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri dohvatanju lokacija za zahtev',
      error: error.message
    });
  }
});

/**
 * DELETE /api/gps/locations/old
 * Briše stare lokacije (starije od X dana)
 */
router.delete('/locations/old', auth, async (req, res) => {
  try {
    // Samo superadmin može brisati
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Samo superadmin može brisati stare lokacije'
      });
    }

    const { daysOld = 30 } = req.query;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(daysOld));

    const result = await TechnicianLocation.deleteMany({
      createdAt: { $lt: cutoffDate }
    });

    console.log(`🗑️ Obrisano ${result.deletedCount} starih GPS lokacija (starije od ${daysOld} dana)`);

    res.json({
      success: true,
      message: `Obrisano ${result.deletedCount} lokacija starijih od ${daysOld} dana`,
      deletedCount: result.deletedCount
    });

  } catch (error) {
    console.error('GPS old locations delete error:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri brisanju starih lokacija',
      error: error.message
    });
  }
});

// ============================================
// GPS Watchdog - Detektuje tehničare čiji je tracking prestao
// ============================================

/**
 * GET /api/gps/stale-trackers
 * Vraća tehničare koji su trebali slati lokaciju ali su prestali (tracking ubijen od OS-a)
 * Admin može ovo koristiti da vidi ko ima problem
 */
router.get('/stale-trackers', auth, async (req, res) => {
  try {
    if (!['admin', 'superadmin', 'supervisor'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Nemate dozvolu' });
    }

    const staleMinutes = parseInt(req.query.minutes) || 15;
    const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);

    // Nađi sve tehničare koji su slali background_tracking podatke
    // ali poslednji put pre više od staleMinutes minuta
    const latestLocations = await TechnicianLocation.aggregate([
      { $match: { requestType: 'background_tracking' } },
      { $sort: { createdAt: -1 } },
      { $group: {
        _id: '$technicianId',
        lastLocation: { $first: '$$ROOT' }
      }},
      { $match: { 'lastLocation.createdAt': { $lt: cutoff } } },
      { $lookup: {
        from: 'technicians',
        localField: '_id',
        foreignField: '_id',
        as: 'technician'
      }},
      { $unwind: '$technician' },
      { $project: {
        technicianId: '$_id',
        'technician.name': 1,
        'technician.phoneNumber': 1,
        'technician.pushNotificationToken': 1,
        lastLocationTime: '$lastLocation.createdAt',
        minutesSinceUpdate: {
          $divide: [
            { $subtract: [new Date(), '$lastLocation.createdAt'] },
            60000
          ]
        }
      }}
    ]);

    res.json({
      success: true,
      staleMinutes,
      staleTechnicians: latestLocations,
      count: latestLocations.length
    });

  } catch (error) {
    console.error('GPS stale trackers error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/gps/nudge-stale
 * Pošalji push notifikaciju tehničarima čiji je tracking prestao
 * da ponovo otvore app (self-heal trigger)
 */
router.post('/nudge-stale', auth, async (req, res) => {
  try {
    if (!['admin', 'superadmin', 'supervisor'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Nemate dozvolu' });
    }

    const staleMinutes = parseInt(req.body.minutes) || 15;
    const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);

    const staleTechnicians = await TechnicianLocation.aggregate([
      { $match: { requestType: 'background_tracking' } },
      { $sort: { createdAt: -1 } },
      { $group: {
        _id: '$technicianId',
        lastLocation: { $first: '$$ROOT' }
      }},
      { $match: { 'lastLocation.createdAt': { $lt: cutoff } } },
      { $lookup: {
        from: 'technicians',
        localField: '_id',
        foreignField: '_id',
        as: 'technician'
      }},
      { $unwind: '$technician' }
    ]);

    let nudged = 0;
    let failed = 0;

    for (const entry of staleTechnicians) {
      const token = entry.technician.pushNotificationToken;
      if (!token || !token.startsWith('ExponentPushToken[')) continue;

      try {
        await axios.post('https://exp.host/--/api/v2/push/send', {
          to: token,
          title: 'Praćenje lokacije',
          body: 'Otvorite aplikaciju da se praćenje lokacije nastavi.',
          data: {
            type: 'gps_tracking_nudge',
            action: 'reopen_app'
          },
          priority: 'high',
          sound: 'default',
          channelId: 'default',
        }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        });
        nudged++;
        console.log(`📍 GPS nudge sent to ${entry.technician.name}`);
      } catch (e) {
        failed++;
        console.error(`GPS nudge failed for ${entry.technician.name}:`, e.message);
      }
    }

    console.log(`📍 GPS nudge: ${nudged} sent, ${failed} failed out of ${staleTechnicians.length} stale`);

    res.json({
      success: true,
      message: `Nudge poslan za ${nudged} tehničara`,
      nudged,
      failed,
      totalStale: staleTechnicians.length
    });

  } catch (error) {
    console.error('GPS nudge error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
