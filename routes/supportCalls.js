const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { auth } = require('../middleware/auth');
const SupportCall = require('../models/SupportCall');
const WorkOrder = require('../models/WorkOrder');

// Dozvoljeni tipovi poziva — mora da prati enum u models/SupportCall.js
// i SUPPORT_LINES u mobilnoj aplikaciji
const SUPPORT_TYPES = ['administrative', 'super', 'marko', 'ana'];

// Ponovljeni klik na isto dugme za isti nalog unutar ovog prozora se računa
// kao isti poziv i ne upisuje se ponovo
const DEDUP_WINDOW_MS = 60 * 1000;

// Dozvoljeno odstupanje sata uređaja unapred; sve preko toga se svodi na
// vreme servera (offline sinhronizacija legitimno šalje vremena iz prošlosti)
const MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;

// POST - Zabeleži klik na dugme podrške (zove mobilna app; tehničar iz tokena)
router.post('/', auth, async (req, res) => {
  try {
    const { workOrderId, supportType, phoneNumber, source, calledAt } = req.body || {};

    if (!workOrderId || !mongoose.Types.ObjectId.isValid(workOrderId)) {
      return res.status(400).json({ error: 'Neispravan ID radnog naloga' });
    }
    if (!SUPPORT_TYPES.includes(supportType)) {
      return res.status(400).json({ error: 'Neispravan tip podrške' });
    }

    const workOrderExists = await WorkOrder.exists({ _id: workOrderId });
    if (!workOrderExists) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }

    // Vreme klika: sa uređaja ako je validno i nije u budućnosti, inače server
    let callTime = new Date();
    if (calledAt) {
      const parsed = new Date(calledAt);
      if (!Number.isNaN(parsed.getTime()) && parsed.getTime() <= Date.now() + MAX_FUTURE_SKEW_MS) {
        callTime = parsed;
      }
    }

    // Dedup: BILO KOJI zabeležen poziv istog tehničara, naloga i tipa u
    // prozoru ±60s oko novog vremena — ne samo najnoviji. Time offline
    // retry koji stigne van redosleda (npr. izgubljen odgovor pa resend
    // starog calledAt posle novijeg klika) ne pravi duplikat.
    const duplicate = await SupportCall.findOne({
      technicianId: req.user._id,
      workOrderId,
      supportType,
      calledAt: {
        $gte: new Date(callTime.getTime() - DEDUP_WINDOW_MS),
        $lte: new Date(callTime.getTime() + DEDUP_WINDOW_MS)
      }
    }).sort({ calledAt: -1 }).lean();

    if (duplicate) {
      return res.json({ success: true, deduped: true, call: duplicate });
    }

    const call = await SupportCall.create({
      technicianId: req.user._id,
      technicianName: req.user.name || '',
      workOrderId,
      supportType,
      phoneNumber: typeof phoneNumber === 'string' ? phoneNumber.slice(0, 20) : '',
      source: typeof source === 'string' ? source.slice(0, 40) : '',
      calledAt: callTime
    });

    res.status(201).json({ success: true, deduped: false, call });
  } catch (error) {
    console.error('[SupportCall] Greška pri beleženju poziva podrške:', error);
    res.status(500).json({ error: 'Greška pri beleženju poziva podrške' });
  }
});

// GET - Objedinjeni timeline kontakata za jedan radni nalog (hronološki):
// pozivi podršci (SupportCall) + pozivi korisniku, podsetnici i alerti (ContactEvent).
// Svaka stavka nosi eventType: 'support_call' | 'customer_call' | 'reminder_sent' | 'uncontacted_alert'.
router.get('/workorder/:workOrderId', auth, async (req, res) => {
  try {
    const { workOrderId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(workOrderId)) {
      return res.status(400).json({ error: 'Neispravan ID radnog naloga' });
    }

    const ContactEvent = require('../models/ContactEvent');
    const [calls, events] = await Promise.all([
      SupportCall.find({ workOrderId })
        .sort({ calledAt: 1 })
        .populate('technicianId', 'name')
        .lean(),
      ContactEvent.find({ workOrderId })
        .sort({ at: 1 })
        .lean()
    ]);

    const timeline = [
      ...calls.map(c => ({ ...c, eventType: 'support_call', at: c.calledAt })),
      ...events.map(e => ({ ...e, eventType: e.eventType }))
    ].sort((a, b) => new Date(a.at) - new Date(b.at));

    res.json(timeline);
  } catch (error) {
    console.error('[SupportCall] Greška pri dohvatanju poziva za nalog:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju poziva podrške' });
  }
});

// GET - Zbirni pregled po tehničaru (broj poziva po tipu + poslednji poziv)
router.get('/technician/:technicianId/summary', auth, async (req, res) => {
  try {
    const { technicianId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(technicianId)) {
      return res.status(400).json({ error: 'Neispravan ID tehničara' });
    }

    const byType = await SupportCall.aggregate([
      { $match: { technicianId: new mongoose.Types.ObjectId(technicianId) } },
      { $group: { _id: '$supportType', count: { $sum: 1 }, lastCalledAt: { $max: '$calledAt' } } }
    ]);

    // Svaki tip uvek postoji u odgovoru (nula ako nema poziva), pa frontend
    // ne mora da proverava da li ključ postoji
    const summary = { total: 0, lastCalledAt: null };
    SUPPORT_TYPES.forEach(type => { summary[type] = 0; });
    byType.forEach(row => {
      summary[row._id] = row.count;
      summary.total += row.count;
      if (!summary.lastCalledAt || row.lastCalledAt > summary.lastCalledAt) {
        summary.lastCalledAt = row.lastCalledAt;
      }
    });

    res.json(summary);
  } catch (error) {
    console.error('[SupportCall] Greška pri dohvatanju summary-ja:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju pregleda poziva podrške' });
  }
});

module.exports = router;
