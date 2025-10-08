const express = require('express');
const router = express.Router();
const { auth, isSupervisorOrSuperAdmin } = require('../middleware/auth');
const { AdminActivityLog, ErrorLog, PerformanceLog } = require('../models');

// ============================================
// ADMIN ACTIVITY LOGS
// ============================================

// GET /api/backend-logs/activities - Dohvati admin aktivnosti sa filterima
router.get('/activities', auth, isSupervisorOrSuperAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      category,
      action,
      userId,
      dateFrom,
      dateTo,
      search
    } = req.query;

    // Build query
    const query = {};

    if (category && category !== 'all') {
      query.category = category;
    }

    if (action && action !== 'all') {
      query.action = action;
    }

    if (userId && userId !== 'all') {
      query.userId = userId;
    }

    // Date range filter - sa preciznim timestampom (do sekunde)
    if (dateFrom || dateTo) {
      query.timestamp = {};
      if (dateFrom) {
        query.timestamp.$gte = new Date(dateFrom);
      }
      if (dateTo) {
        query.timestamp.$lte = new Date(dateTo);
      }
    }

    // Search filter - pretraži po userName, entityName
    if (search) {
      query.$or = [
        { userName: { $regex: search, $options: 'i' } },
        { entityName: { $regex: search, $options: 'i' } },
        { 'metadata.requestUrl': { $regex: search, $options: 'i' } }
      ];
    }

    // Count total documents
    const total = await AdminActivityLog.countDocuments(query);

    // Fetch paginated data
    const activities = await AdminActivityLog.find(query)
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();

    // Debug: Check if activities have details
    const updatedActivity = activities.find(a => a.details?.action === 'updated');
    if (updatedActivity) {
      console.log('🔍 [Backend API] Found updated activity:', {
        action: updatedActivity.action,
        detailsAction: updatedActivity.details?.action,
        changesLength: updatedActivity.details?.changes?.length,
        changes: updatedActivity.details?.changes,
        fullDetails: JSON.stringify(updatedActivity.details, null, 2)
      });
    }

    const bulkActivity = activities.find(a => a.details?.action === 'bulk_unassigned' || a.details?.action === 'bulk_assigned');
    if (bulkActivity) {
      console.log('🔍 [Backend API] Found bulk activity:', {
        action: bulkActivity.details?.action,
        summaryKeys: Object.keys(bulkActivity.details?.summary || {}),
        assignedItemsLength: bulkActivity.details?.assignedItems?.length,
        firstItem: bulkActivity.details?.assignedItems?.[0]
      });
    }

    res.json({
      activities,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalCount: total,
        limit: parseInt(limit),
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1
      }
    });

  } catch (error) {
    console.error('Error fetching admin activities:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju admin aktivnosti' });
  }
});

// GET /api/backend-logs/activities/stats - Statistika admin aktivnosti
router.get('/activities/stats', auth, isSupervisorOrSuperAdmin, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    const query = {};
    if (dateFrom || dateTo) {
      query.timestamp = {};
      if (dateFrom) query.timestamp.$gte = new Date(dateFrom);
      if (dateTo) query.timestamp.$lte = new Date(dateTo);
    }

    // Ukupan broj aktivnosti
    const totalActivities = await AdminActivityLog.countDocuments(query);

    // Aktivnosti po kategorijama
    const byCategory = await AdminActivityLog.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Aktivnosti po korisnicima
    const byUser = await AdminActivityLog.aggregate([
      { $match: query },
      {
        $group: {
          _id: { userId: '$userId', userName: '$userName' },
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    // Aktivnosti po akcijama (top 10)
    const byAction = await AdminActivityLog.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$action',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    // Aktivnosti po vremenima (hourly distribution)
    const hourlyDistribution = await AdminActivityLog.aggregate([
      { $match: query },
      {
        $group: {
          _id: { $hour: '$timestamp' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      totalActivities,
      byCategory,
      byUser,
      byAction,
      hourlyDistribution
    });

  } catch (error) {
    console.error('Error fetching activity stats:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju statistike aktivnosti' });
  }
});

// ============================================
// ERROR LOGS
// ============================================

// GET /api/backend-logs/errors - Dohvati error logove
router.get('/errors', auth, isSupervisorOrSuperAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      errorType,
      severity,
      resolved,
      route,
      dateFrom,
      dateTo,
      search
    } = req.query;

    // Build query
    const query = {};

    if (errorType && errorType !== 'all') {
      query.errorType = errorType;
    }

    if (severity && severity !== 'all') {
      query.severity = severity;
    }

    if (resolved !== undefined && resolved !== 'all') {
      query.resolved = resolved === 'true';
    }

    if (route) {
      query.route = { $regex: route, $options: 'i' };
    }

    // Date range filter
    if (dateFrom || dateTo) {
      query.timestamp = {};
      if (dateFrom) query.timestamp.$gte = new Date(dateFrom);
      if (dateTo) query.timestamp.$lte = new Date(dateTo);
    }

    // Search filter
    if (search) {
      query.$or = [
        { errorMessage: { $regex: search, $options: 'i' } },
        { route: { $regex: search, $options: 'i' } },
        { userName: { $regex: search, $options: 'i' } }
      ];
    }

    // Count total documents
    const total = await ErrorLog.countDocuments(query);

    // Fetch paginated data
    const errors = await ErrorLog.find(query)
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();

    res.json({
      errors,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalCount: total,
        limit: parseInt(limit),
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1
      }
    });

  } catch (error) {
    console.error('Error fetching error logs:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju error logova' });
  }
});

// GET /api/backend-logs/errors/stats - Statistika grešaka
router.get('/errors/stats', auth, isSupervisorOrSuperAdmin, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    const query = {};
    if (dateFrom || dateTo) {
      query.timestamp = {};
      if (dateFrom) query.timestamp.$gte = new Date(dateFrom);
      if (dateTo) query.timestamp.$lte = new Date(dateTo);
    }

    // Ukupan broj grešaka
    const totalErrors = await ErrorLog.countDocuments(query);

    // Nerazrešene greške
    const unresolvedErrors = await ErrorLog.countDocuments({ ...query, resolved: false });

    // Greške po tipu
    const byType = await ErrorLog.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$errorType',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Greške po severity-ju
    const bySeverity = await ErrorLog.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$severity',
          count: { $sum: 1 }
        }
      }
    ]);

    // Top greške (po occurences)
    const topErrors = await ErrorLog.find(query)
      .sort({ occurrences: -1 })
      .limit(10)
      .select('errorMessage route occurrences severity resolved')
      .lean();

    // Greške po rutama
    const byRoute = await ErrorLog.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$route',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    res.json({
      totalErrors,
      unresolvedErrors,
      byType,
      bySeverity,
      topErrors,
      byRoute
    });

  } catch (error) {
    console.error('Error fetching error stats:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju statistike grešaka' });
  }
});

// POST /api/backend-logs/errors/:id/resolve - Označi grešku kao rešenu
router.post('/errors/:id/resolve', auth, isSupervisorOrSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const error = await ErrorLog.findById(id);

    if (!error) {
      return res.status(404).json({ error: 'Greška nije pronađena' });
    }

    await error.markAsResolved(req.user._id, req.user.name, notes);

    res.json({
      message: 'Greška označena kao rešena',
      error
    });

  } catch (error) {
    console.error('Error resolving error log:', error);
    res.status(500).json({ error: 'Greška pri označavanju kao rešeno' });
  }
});

// ============================================
// PERFORMANCE LOGS
// ============================================

// GET /api/backend-logs/performance - Dohvati performance logove
router.get('/performance', auth, isSupervisorOrSuperAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      route,
      isSlow,
      minDuration,
      maxDuration,
      dateFrom,
      dateTo,
      search
    } = req.query;

    // Build query
    const query = {};

    if (route) {
      query.route = { $regex: route, $options: 'i' };
    }

    if (isSlow !== undefined && isSlow !== 'all') {
      query.isSlow = isSlow === 'true';
    }

    if (minDuration) {
      query.duration = { ...query.duration, $gte: parseInt(minDuration) };
    }

    if (maxDuration) {
      query.duration = { ...query.duration, $lte: parseInt(maxDuration) };
    }

    // Date range filter
    if (dateFrom || dateTo) {
      query.timestamp = {};
      if (dateFrom) query.timestamp.$gte = new Date(dateFrom);
      if (dateTo) query.timestamp.$lte = new Date(dateTo);
    }

    // Search filter
    if (search) {
      query.$or = [
        { route: { $regex: search, $options: 'i' } },
        { userName: { $regex: search, $options: 'i' } }
      ];
    }

    // Count total documents
    const total = await PerformanceLog.countDocuments(query);

    // Fetch paginated data
    const performanceLogs = await PerformanceLog.find(query)
      .sort({ duration: -1 }) // Najsporiji prvi
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();

    res.json({
      performanceLogs,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalCount: total,
        limit: parseInt(limit),
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1
      }
    });

  } catch (error) {
    console.error('Error fetching performance logs:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju performance logova' });
  }
});

// GET /api/backend-logs/performance/stats - Statistika performansi
router.get('/performance/stats', auth, isSupervisorOrSuperAdmin, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    const query = {};
    if (dateFrom || dateTo) {
      query.timestamp = {};
      if (dateFrom) query.timestamp.$gte = new Date(dateFrom);
      if (dateTo) query.timestamp.$lte = new Date(dateTo);
    }

    // Ukupan broj logova
    const totalLogs = await PerformanceLog.countDocuments(query);

    // Broj sporih requesta
    const slowRequests = await PerformanceLog.countDocuments({ ...query, isSlow: true });

    // Average response time
    const avgResponseTime = await PerformanceLog.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          avgDuration: { $avg: '$duration' },
          maxDuration: { $max: '$duration' },
          minDuration: { $min: '$duration' }
        }
      }
    ]);

    // Najsporiji endpoint-i
    const slowestEndpoints = await PerformanceLog.getSlowEndpoints(10);

    // Performance po rutama
    const byRoute = await PerformanceLog.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$route',
          avgDuration: { $avg: '$duration' },
          maxDuration: { $max: '$duration' },
          count: { $sum: 1 }
        }
      },
      { $sort: { avgDuration: -1 } },
      { $limit: 10 }
    ]);

    res.json({
      totalLogs,
      slowRequests,
      avgResponseTime: avgResponseTime[0] || { avgDuration: 0, maxDuration: 0, minDuration: 0 },
      slowestEndpoints,
      byRoute
    });

  } catch (error) {
    console.error('Error fetching performance stats:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju statistike performansi' });
  }
});

// ============================================
// DASHBOARD STATS
// ============================================

// GET /api/backend-logs/dashboard - Kombinovana statistika za dashboard
router.get('/dashboard', auth, isSupervisorOrSuperAdmin, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    const query = {};
    if (dateFrom || dateTo) {
      query.timestamp = {};
      if (dateFrom) query.timestamp.$gte = new Date(dateFrom);
      if (dateTo) query.timestamp.$lte = new Date(dateTo);
    }

    // Paralelno dohvatanje svih statistika
    const [
      totalActivities,
      totalErrors,
      unresolvedErrors,
      slowRequests,
      avgResponseTime
    ] = await Promise.all([
      AdminActivityLog.countDocuments(query),
      ErrorLog.countDocuments(query),
      ErrorLog.countDocuments({ ...query, resolved: false }),
      PerformanceLog.countDocuments({ ...query, isSlow: true }),
      PerformanceLog.aggregate([
        { $match: query },
        { $group: { _id: null, avgDuration: { $avg: '$duration' } } }
      ])
    ]);

    res.json({
      totalActivities,
      totalErrors,
      unresolvedErrors,
      slowRequests,
      avgResponseTime: avgResponseTime[0]?.avgDuration || 0
    });

  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju dashboard statistike' });
  }
});

// GET /api/backend-logs/categories - Dohvati sve dostupne kategorije i akcije
router.get('/categories', auth, isSupervisorOrSuperAdmin, async (req, res) => {
  try {
    const categories = await AdminActivityLog.distinct('category');
    const actions = await AdminActivityLog.distinct('action');
    const users = await AdminActivityLog.aggregate([
      {
        $group: {
          _id: { userId: '$userId', userName: '$userName' }
        }
      }
    ]);

    res.json({
      categories,
      actions,
      users: users.map(u => ({ id: u._id.userId, name: u._id.userName }))
    });

  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju kategorija' });
  }
});

module.exports = router;
