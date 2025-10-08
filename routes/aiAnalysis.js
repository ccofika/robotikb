const express = require('express');
const router = express.Router();
const { auth, isSupervisorOrSuperAdmin } = require('../middleware/auth');
const AIAnalysis = require('../models/AIAnalysis');
const { performAIAnalysis } = require('../services/aiAnalysisService');

/**
 * @route   POST /api/ai-analysis/analyze
 * @desc    Pokreni AI analizu za određeni period (manual ili scheduled)
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

    console.log(`AI Analysis initiated by ${req.user.name} (${req.user.email})`);
    console.log(`Period: ${startDate.toISOString()} - ${endDate.toISOString()}`);
    console.log(`Type: ${analysisType}`);

    // Pokreni AI analizu
    const analysis = await performAIAnalysis(
      startDate,
      endDate,
      req.user._id,
      analysisType
    );

    res.json({
      success: true,
      data: analysis,
      message: 'AI analiza uspešno završena'
    });

  } catch (error) {
    console.error('Error in AI analysis route:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri izvršavanju AI analize',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/ai-analysis/latest
 * @desc    Dohvati najnoviju AI analizu
 * @access  Private (admin/superadmin/supervisor)
 */
router.get('/latest', auth, isSupervisorOrSuperAdmin, async (req, res) => {
  try {

    const latestAnalysis = await AIAnalysis.findOne()
      .sort({ analysisDate: -1 })
      .populate('createdBy', 'name email')
      .lean();

    if (!latestAnalysis) {
      return res.json({
        success: true,
        data: null,
        message: 'Nema dostupnih AI analiza'
      });
    }

    res.json({
      success: true,
      data: latestAnalysis
    });

  } catch (error) {
    console.error('Error fetching latest analysis:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri dohvatanju analize',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/ai-analysis/history
 * @desc    Dohvati istoriju AI analiza (paginacija)
 * @access  Private (admin/superadmin/supervisor)
 */
router.get('/history', auth, isSupervisorOrSuperAdmin, async (req, res) => {
  try {

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const analyses = await AIAnalysis.find()
      .sort({ analysisDate: -1 })
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name email')
      .lean();

    const total = await AIAnalysis.countDocuments();

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
    console.error('Error fetching analysis history:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri dohvatanju istorije analiza',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/ai-analysis/:id
 * @desc    Dohvati specifičnu AI analizu po ID-u
 * @access  Private (admin/superadmin/supervisor)
 */
router.get('/:id', auth, isSupervisorOrSuperAdmin, async (req, res) => {
  try {

    const analysis = await AIAnalysis.findById(req.params.id)
      .populate('createdBy', 'name email')
      .lean();

    if (!analysis) {
      return res.status(404).json({
        success: false,
        message: 'AI analiza nije pronađena'
      });
    }

    res.json({
      success: true,
      data: analysis
    });

  } catch (error) {
    console.error('Error fetching analysis by ID:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri dohvatanju analize',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/ai-analysis/:id
 * @desc    Obriši AI analizu
 * @access  Private (admin/superadmin/supervisor)
 */
router.delete('/:id', auth, isSupervisorOrSuperAdmin, async (req, res) => {
  try {

    const analysis = await AIAnalysis.findByIdAndDelete(req.params.id);

    if (!analysis) {
      return res.status(404).json({
        success: false,
        message: 'AI analiza nije pronađena'
      });
    }

    res.json({
      success: true,
      message: 'AI analiza je uspešno obrisana'
    });

  } catch (error) {
    console.error('Error deleting analysis:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri brisanju analize',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/ai-analysis/scheduled/trigger
 * @desc    Trigger za scheduled analizu (poziva se automatski)
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

    console.log('Scheduled AI analysis triggered at', new Date().toISOString());

    // Analiziraj od prošlog dana u 12h do danas u 12h
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 1); // Idi dan unazad

    const analysis = await performAIAnalysis(
      startDate,
      endDate,
      null, // Nema korisnika, automatski je
      'scheduled'
    );

    res.json({
      success: true,
      data: analysis,
      message: 'Scheduled AI analysis completed'
    });

  } catch (error) {
    console.error('Error in scheduled analysis:', error);
    res.status(500).json({
      success: false,
      message: 'Error in scheduled analysis',
      error: error.message
    });
  }
});

module.exports = router;
