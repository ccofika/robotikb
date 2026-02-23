const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Review = require('../models/Review');
const Notification = require('../models/Notification');
const Technician = require('../models/Technician');
const WorkOrder = require('../models/WorkOrder');
const WorkOrderEvidence = require('../models/WorkOrderEvidence');
const { auth } = require('../middleware/auth');

// ============================================================
// POST /api/reviews/webhook - Prijem review-a iz Google Apps Script
// ============================================================
router.post('/webhook', async (req, res) => {
  try {
    const { secret } = req.body;

    // Validacija webhook secret-a
    const webhookSecret = process.env.REVIEW_WEBHOOK_SECRET;
    if (!webhookSecret || secret !== webhookSecret) {
      console.log('[Reviews Webhook] Nevažeći secret key');
      return res.status(401).json({ error: 'Nevažeći secret key' });
    }

    const {
      referentniBroj,
      onTime,
      professionalism,
      cleanInstallation,
      cleanInstallationComment,
      explanation,
      serviceQuality,
      npsScore,
      comment
    } = req.body;

    // Validacija obaveznih polja
    if (!referentniBroj || !onTime || !professionalism || !cleanInstallation || !explanation || !serviceQuality || npsScore === undefined) {
      console.log('[Reviews Webhook] Nedostaju obavezna polja:', {
        referentniBroj: !!referentniBroj,
        onTime: !!onTime,
        professionalism: !!professionalism,
        cleanInstallation: !!cleanInstallation,
        explanation: !!explanation,
        serviceQuality: !!serviceQuality,
        npsScore: npsScore !== undefined
      });
      return res.status(400).json({ error: 'Nedostaju obavezna polja' });
    }

    // Pronađi radni nalog po tisJobId (referentni broj)
    const workOrder = await WorkOrder.findOne({ tisJobId: referentniBroj }).lean();
    if (!workOrder) {
      console.log('[Reviews Webhook] Radni nalog nije pronađen za referentni broj:', referentniBroj);
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }

    const technicianId = workOrder.technicianId;
    const workOrderId = workOrder._id;

    // Provera za duplikat
    const existingReview = await Review.findOne({ workOrderId }).lean();
    if (existingReview) {
      console.log('[Reviews Webhook] Review već postoji za radni nalog:', workOrderId);
      return res.status(409).json({ error: 'Review za ovaj radni nalog već postoji' });
    }

    // Dohvati ime korisnika iz WorkOrderEvidence
    let customerName = workOrder.userName || '';
    const evidence = await WorkOrderEvidence.findOne({ workOrderId }).select('customerName').lean();
    if (evidence && evidence.customerName) {
      customerName = evidence.customerName;
    }

    // Kreiranje review-a
    const review = await Review.create({
      workOrderId,
      technicianId,
      tisJobId: referentniBroj,
      customerName,
      onTime,
      professionalism: Number(professionalism),
      cleanInstallation,
      cleanInstallationComment: cleanInstallationComment || '',
      explanation,
      serviceQuality: Number(serviceQuality),
      npsScore: Number(npsScore),
      comment: comment || ''
    });

    console.log('[Reviews Webhook] Review kreiran:', review._id, 'za tehničara:', technicianId);

    // Notifikacija za loše ocene
    const profRating = Number(professionalism);
    const svcRating = Number(serviceQuality);
    const nps = Number(npsScore);

    if (profRating < 3 || svcRating < 3 || nps < 5) {
      try {
        const technician = await Technician.findById(technicianId).select('name').lean();
        const techName = technician ? technician.name : 'Nepoznat';
        const lowestRating = Math.min(profRating, svcRating);

        // Pošalji notifikaciju svim adminima
        const adminUsers = await Technician.find({ isAdmin: true }).select('_id').lean();
        for (const admin of adminUsers) {
          await Notification.createLowReviewRating(
            review._id,
            technicianId,
            techName,
            customerName || 'Nepoznat korisnik',
            lowestRating,
            admin._id
          );
        }
        console.log('[Reviews Webhook] Notifikacija za lošu ocenu poslata adminima:', adminUsers.length);
      } catch (notifError) {
        console.error('[Reviews Webhook] Greška pri slanju notifikacije:', notifError);
      }
    }

    res.status(201).json({ success: true, reviewId: review._id });

  } catch (error) {
    console.error('[Reviews Webhook] Greška:', error);
    res.status(500).json({ error: 'Greška pri čuvanju review-a' });
  }
});

// ============================================================
// GET /api/reviews/technician/:id - Svi review-ovi za tehničara
// ============================================================
router.get('/technician/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    const [reviews, total] = await Promise.all([
      Review.find({ technicianId: id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Review.countDocuments({ technicianId: id })
    ]);

    console.log('[Reviews] Dohvaćeno', reviews.length, 'review-ova za tehničara:', id);

    res.json({
      reviews,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });

  } catch (error) {
    console.error('[Reviews] Greška pri dohvatanju review-ova:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju review-ova' });
  }
});

// ============================================================
// GET /api/reviews/stats/:id - Statistika za jednog tehničara
// ============================================================
router.get('/stats/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    const stats = await Review.aggregate([
      { $match: { technicianId: new mongoose.Types.ObjectId(id) } },
      {
        $group: {
          _id: null,
          totalReviews: { $sum: 1 },
          avgProfessionalism: { $avg: '$professionalism' },
          avgServiceQuality: { $avg: '$serviceQuality' },
          avgNps: { $avg: '$npsScore' },
          onTimeCount: {
            $sum: { $cond: [{ $eq: ['$onTime', 'Da, tačno na vreme'] }, 1, 0] }
          },
          cleanInstallationCount: {
            $sum: { $cond: [{ $eq: ['$cleanInstallation', 'Da'] }, 1, 0] }
          },
          fullExplanationCount: {
            $sum: { $cond: [{ $eq: ['$explanation', 'Da, sve je jasno'] }, 1, 0] }
          }
        }
      }
    ]);

    if (stats.length === 0) {
      return res.json({
        totalReviews: 0,
        avgProfessionalism: 0,
        avgServiceQuality: 0,
        avgNps: 0,
        onTimePercent: 0,
        cleanInstallationPercent: 0,
        fullExplanationPercent: 0
      });
    }

    const s = stats[0];
    console.log('[Reviews Stats] Statistika za tehničara:', id, '- Ukupno review-ova:', s.totalReviews);

    res.json({
      totalReviews: s.totalReviews,
      avgProfessionalism: Math.round(s.avgProfessionalism * 10) / 10,
      avgServiceQuality: Math.round(s.avgServiceQuality * 10) / 10,
      avgNps: Math.round(s.avgNps * 10) / 10,
      onTimePercent: Math.round((s.onTimeCount / s.totalReviews) * 100),
      cleanInstallationPercent: Math.round((s.cleanInstallationCount / s.totalReviews) * 100),
      fullExplanationPercent: Math.round((s.fullExplanationCount / s.totalReviews) * 100)
    });

  } catch (error) {
    console.error('[Reviews Stats] Greška:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju statistike' });
  }
});

// ============================================================
// GET /api/reviews/stats/all - Statistika za sve tehničare
// ============================================================
router.get('/stats/all', auth, async (req, res) => {
  try {
    const stats = await Review.aggregate([
      {
        $group: {
          _id: '$technicianId',
          totalReviews: { $sum: 1 },
          avgProfessionalism: { $avg: '$professionalism' },
          avgServiceQuality: { $avg: '$serviceQuality' },
          avgNps: { $avg: '$npsScore' }
        }
      }
    ]);

    // Pretvaramo u mapu za lakši pristup na frontendu
    const statsMap = {};
    stats.forEach(s => {
      statsMap[s._id.toString()] = {
        totalReviews: s.totalReviews,
        avgProfessionalism: Math.round(s.avgProfessionalism * 10) / 10,
        avgServiceQuality: Math.round(s.avgServiceQuality * 10) / 10,
        avgNps: Math.round(s.avgNps * 10) / 10
      };
    });

    console.log('[Reviews Stats All] Dohvaćena statistika za', Object.keys(statsMap).length, 'tehničara');

    res.json(statsMap);

  } catch (error) {
    console.error('[Reviews Stats All] Greška:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju statistike' });
  }
});

// ============================================================
// DELETE /api/reviews/:id - Brisanje review-a (admin only)
// ============================================================
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    const review = await Review.findByIdAndDelete(id);

    if (!review) {
      return res.status(404).json({ error: 'Review nije pronađen' });
    }

    console.log('[Reviews] Review obrisan:', id);

    res.json({ message: 'Review je uspešno obrisan' });

  } catch (error) {
    console.error('[Reviews] Greška pri brisanju review-a:', error);
    res.status(500).json({ error: 'Greška pri brisanju review-a' });
  }
});

module.exports = router;
