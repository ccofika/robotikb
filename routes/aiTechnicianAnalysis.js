const express = require('express');
const router = express.Router();
const { auth, isSupervisorOrSuperAdmin } = require('../middleware/auth');
const AITechnicianAnalysis = require('../models/AITechnicianAnalysis');
const { performAITechnicianAnalysis } = require('../services/aiTechnicianAnalysisService');

/**
 * @route   POST /api/ai-technician-analysis/analyze
 * @desc    Pokreni AI analizu tehničara za određeni period (manual ili scheduled)
 * @access  Private (admin/superadmin/supervisor)
 */
router.post('/analyze', auth, isSupervisorOrSuperAdmin, async (req, res) => {
  try {

    const { periodStart, periodEnd, analysisType = 'manual' } = req.body;

    // Validacija
    if (!periodStart || !periodEnd) {
      return res.status(400).json({
        success: false,
        message: 'Nedostaju parametri: periodStart i periodEnd su obavezni'
      });
    }

    const startDate = new Date(periodStart);
    const endDate = new Date(periodEnd);

    // Proveri validnost datuma
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Nevalidni datumi'
      });
    }

    if (startDate >= endDate) {
      return res.status(400).json({
        success: false,
        message: 'Početni datum mora biti pre krajnjeg datuma'
      });
    }

    console.log(`AI Technician Analysis initiated by ${req.user.name} (${req.user.email})`);
    console.log(`Period: ${startDate.toISOString()} - ${endDate.toISOString()}`);
    console.log(`Type: ${analysisType}`);

    // Pokreni AI analizu
    const analysis = await performAITechnicianAnalysis(
      startDate,
      endDate,
      req.user._id,
      analysisType
    );

    res.json({
      success: true,
      data: analysis,
      message: 'AI analiza tehničara uspešno završena'
    });

  } catch (error) {
    console.error('Error in AI technician analysis route:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri izvršavanju AI analize tehničara',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/ai-technician-analysis/latest
 * @desc    Dohvati najnoviju AI analizu tehničara
 * @access  Private (admin/superadmin/supervisor)
 */
router.get('/latest', auth, isSupervisorOrSuperAdmin, async (req, res) => {
  try {

    const latestAnalysis = await AITechnicianAnalysis.findOne()
      .sort({ analysisDate: -1 })
      .populate('createdBy', 'name email')
      .lean();

    if (!latestAnalysis) {
      return res.json({
        success: true,
        data: null,
        message: 'Nema dostupnih AI analiza tehničara'
      });
    }

    res.json({
      success: true,
      data: latestAnalysis
    });

  } catch (error) {
    console.error('Error fetching latest technician analysis:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri dohvatanju analize',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/ai-technician-analysis/history
 * @desc    Dohvati istoriju AI analiza tehničara (paginacija)
 * @access  Private (admin/superadmin/supervisor)
 */
router.get('/history', auth, isSupervisorOrSuperAdmin, async (req, res) => {
  try {

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const analyses = await AITechnicianAnalysis.find()
      .sort({ analysisDate: -1 })
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name email')
      .lean();

    const total = await AITechnicianAnalysis.countDocuments();

    res.json({
      success: true,
      data: {
        analyses,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit
        }
      }
    });

  } catch (error) {
    console.error('Error fetching technician analysis history:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri dohvatanju istorije analiza',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/ai-technician-analysis/:id
 * @desc    Dohvati specifičnu AI analizu tehničara po ID-u
 * @access  Private (admin/superadmin/supervisor)
 */
router.get('/:id', auth, isSupervisorOrSuperAdmin, async (req, res) => {
  try {

    const analysis = await AITechnicianAnalysis.findById(req.params.id)
      .populate('createdBy', 'name email')
      .lean();

    if (!analysis) {
      return res.status(404).json({
        success: false,
        message: 'AI analiza tehničara nije pronađena'
      });
    }

    res.json({
      success: true,
      data: analysis
    });

  } catch (error) {
    console.error('Error fetching technician analysis by ID:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri dohvatanju analize',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/ai-technician-analysis/:id
 * @desc    Obriši AI analizu tehničara
 * @access  Private (admin/superadmin/supervisor)
 */
router.delete('/:id', auth, isSupervisorOrSuperAdmin, async (req, res) => {
  try {

    const analysis = await AITechnicianAnalysis.findByIdAndDelete(req.params.id);

    if (!analysis) {
      return res.status(404).json({
        success: false,
        message: 'AI analiza tehničara nije pronađena'
      });
    }

    res.json({
      success: true,
      message: 'AI analiza tehničara je uspešno obrisana'
    });

  } catch (error) {
    console.error('Error deleting technician analysis:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri brisanju analize',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/ai-technician-analysis/scheduled/trigger
 * @desc    Trigger za scheduled analizu tehničara (poziva se automatski)
 * @access  Private (samo iz scheduled job-a)
 */
router.get('/scheduled/trigger', async (req, res) => {
  try {
    // Security check - samo iz lokalnog servera ili sa API key-om
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.INTERNAL_API_KEY && req.ip !== '::1' && req.ip !== '127.0.0.1') {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    console.log('Scheduled AI technician analysis triggered at', new Date().toISOString());

    // Analiziraj od prošlog ponedeljka 00:00 do današnjeg ponedeljka 06:00
    const now = new Date();

    // End date = trenutno vreme (ponedeljak 06:00)
    const endDate = new Date(now);

    // Start date = prošli ponedeljak u 00:00
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 7); // Idi 7 dana unazad (prošli ponedeljak)
    startDate.setHours(0, 0, 0, 0); // Postavi na 00:00:00

    console.log('Analysis period:');
    console.log('  Start:', startDate.toISOString(), '(Last Monday 00:00)');
    console.log('  End:', endDate.toISOString(), '(Current Monday 06:00)');

    const analysis = await performAITechnicianAnalysis(
      startDate,
      endDate,
      null, // Nema korisnika, automatski je
      'scheduled'
    );

    res.json({
      success: true,
      data: analysis,
      message: 'Scheduled AI technician analysis completed'
    });

  } catch (error) {
    console.error('Error in scheduled technician analysis:', error);
    res.status(500).json({
      success: false,
      message: 'Error in scheduled technician analysis',
      error: error.message
    });
  }
});

module.exports = router;
