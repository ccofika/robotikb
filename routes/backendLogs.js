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

    // Debug: Check edit activities
    const editActivity = activities.find(a => a.category === 'edit');
    if (editActivity) {
      console.log('🔍 [Backend API] Found edit activity:', {
        action: editActivity.action,
        category: editActivity.category,
        detailsAction: editActivity.details?.action,
        hasEquipment: !!editActivity.details?.equipment,
        hasMaterial: !!editActivity.details?.material,
        equipment: editActivity.details?.equipment,
        material: editActivity.details?.material,
        fullDetails: JSON.stringify(editActivity.details, null, 2)
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

// ============================================
// EXPORT ACTIVITIES TO EXCEL
// ============================================

// GET /api/backend-logs/export-activities - Export admin aktivnosti u Excel
router.get('/export-activities', auth, isSupervisorOrSuperAdmin, async (req, res) => {
  try {
    const { Technician } = require('../models');

    const {
      dateFrom,
      dateTo,
      category,
      subcategory,
      entityFilter
    } = req.query;

    console.log('📊 [Export] Request params:', { dateFrom, dateTo, category, subcategory, entityFilter });

    // Helper funkcija za dohvatanje imena tehničara iz ID-a
    const getTechnicianName = async (technicianId) => {
      if (!technicianId) return '';
      try {
        const tech = await Technician.findById(technicianId).select('name').lean();
        return tech?.name || '';
      } catch (error) {
        return '';
      }
    };

    // Build query
    const query = {};

    // Date range filter
    if (dateFrom || dateTo) {
      query.timestamp = {};
      if (dateFrom) query.timestamp.$gte = new Date(dateFrom);
      if (dateTo) query.timestamp.$lte = new Date(dateTo);
    }

    // Category filter
    if (category && category !== 'all') {
      query.category = category;
    }

    // Subcategory (action) filter
    if (subcategory && subcategory !== 'all') {
      query.action = subcategory;
    }

    // Entity filter - zavisi od kategorije i podkategorije
    if (entityFilter) {
      // Za zaduženje/razduženje opreme (category=technicians) - filter po imenu tehničara
      if ((category === 'technicians' || category === 'all') && (subcategory === 'equipment_assign_to_tech' || subcategory === 'equipment_unassign_from_tech' || subcategory === 'all')) {
        query['details.summary.technicianName'] = { $regex: entityFilter, $options: 'i' };
      }
      // Za opremu - dodavanje/izmena/brisanje - filter po serijskom broju
      else if (category === 'equipment' && (subcategory === 'equipment_add' || subcategory === 'equipment_edit' || subcategory === 'equipment_delete' || subcategory === 'equipment_bulk_add' || subcategory === 'all')) {
        query.$or = [
          { 'details.after.serialNumber': { $regex: entityFilter, $options: 'i' } },
          { 'details.before.serialNumber': { $regex: entityFilter, $options: 'i' } },
          { 'details.addedItems.serialNumber': { $regex: entityFilter, $options: 'i' } },
          { entityName: { $regex: entityFilter, $options: 'i' } }
        ];
      }
      // Za materijale - filter po tipu
      else if (category === 'materials' || (category === 'technicians' && subcategory === 'material_assign_to_tech')) {
        query.$or = [
          { 'details.after.type': { $regex: entityFilter, $options: 'i' } },
          { 'details.before.type': { $regex: entityFilter, $options: 'i' } },
          { entityName: { $regex: entityFilter, $options: 'i' } }
        ];
      }
      // Za tehničare - filter po imenu
      else if (category === 'technicians' && (subcategory === 'technician_add' || subcategory === 'technician_edit' || subcategory === 'technician_delete' || subcategory === 'all')) {
        query.entityName = { $regex: entityFilter, $options: 'i' };
      }
      // Za radne naloge - filter po TIS Job ID
      else if (category === 'workorders') {
        query.$or = [
          { 'details.after.tisJobId': { $regex: entityFilter, $options: 'i' } },
          { 'details.before.tisJobId': { $regex: entityFilter, $options: 'i' } },
          { entityName: { $regex: entityFilter, $options: 'i' } }
        ];
      }
      // Za korisnike - filter po imenu
      else if (category === 'users') {
        query.entityName = { $regex: entityFilter, $options: 'i' };
      }
    }

    console.log('📊 [Export] Query:', JSON.stringify(query, null, 2));

    // Fetch all matching activities (no pagination for export)
    const activities = await AdminActivityLog.find(query)
      .sort({ timestamp: -1 })
      .lean();

    console.log('📊 [Export] Found activities:', activities.length);

    // Generiši Excel fajl
    const xlsx = require('xlsx');
    const workbook = xlsx.utils.book_new();

    // Pripremi podatke za Excel - svaki komad opreme u posebnom redu
    const excelData = [];

    for (const activity of activities) {
      // Bulk assigned/unassigned - svaki komad opreme u posebnom redu
      if (activity.details?.action === 'bulk_assigned' || activity.details?.action === 'bulk_unassigned') {
        const items = activity.details.assignedItems || [];

        // Ako nema stavki u assignedItems, prikaži samo summary
        if (items.length === 0) {
          excelData.push({
            'Vreme': new Date(activity.timestamp).toLocaleString('sr-RS', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            }),
            'Admin': activity.userName,
            'Akcija': activity.details.action === 'bulk_assigned' ? 'Zaduženje opreme' : 'Razduženje opreme',
            'Ime Tehničara': activity.details.summary?.technicianName || '',
            'Broj Stavki': activity.details.summary?.assignedCount || activity.details.summary?.unassignedCount || 0,
            'Kategorija': '',
            'Model/Opis': '',
            'Serijski Broj': '',
            'Status': '',
            'Lokacija': '',
            'Napomena': 'Detalji nisu dostupni (stariji log)',
            'Trajanje (ms)': activity.metadata?.requestDuration || ''
          });
        } else {
          // Prikaži svaki komad opreme u posebnom redu
          items.forEach(item => {
            excelData.push({
              'Vreme': new Date(activity.timestamp).toLocaleString('sr-RS', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              }),
              'Admin': activity.userName,
              'Akcija': activity.details.action === 'bulk_assigned' ? 'Zaduženje opreme' : 'Razduženje opreme',
              'Ime Tehničara': activity.details.summary?.technicianName || '',
              'Kategorija': item.category || '',
              'Model/Opis': item.description || '',
              'Serijski Broj': item.serialNumber || '',
              'Status': item.status || '',
              'Lokacija': item.location || '',
              'Trajanje (ms)': activity.metadata?.requestDuration || ''
            });
          });
        }
      }
      // Bulk created - svaki komad opreme u posebnom redu
      else if (activity.details?.action === 'bulk_created') {
        const items = activity.details.addedItems || [];

        if (items.length === 0) {
          excelData.push({
            'Vreme': new Date(activity.timestamp).toLocaleString('sr-RS', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            }),
            'Admin': activity.userName,
            'Akcija': 'Bulk dodavanje opreme',
            'Broj Stavki': activity.details.summary?.addedCount || 0,
            'Kategorija': '',
            'Model/Opis': '',
            'Serijski Broj': '',
            'Status': '',
            'Lokacija': '',
            'Napomena': 'Detalji nisu dostupni (stariji log)',
            'Trajanje (ms)': activity.metadata?.requestDuration || ''
          });
        } else {
          items.forEach(item => {
            excelData.push({
              'Vreme': new Date(activity.timestamp).toLocaleString('sr-RS', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              }),
              'Admin': activity.userName,
              'Akcija': 'Bulk dodavanje opreme',
              'Kategorija': item.category || '',
              'Model/Opis': item.description || '',
              'Serijski Broj': item.serialNumber || '',
              'Status': item.status || '',
              'Lokacija': item.location || '',
              'Trajanje (ms)': activity.metadata?.requestDuration || ''
            });
          });
        }
      }
      // Single equipment operations
      else if ((activity.category === 'equipment' || activity.action.includes('equipment')) && (activity.details?.after || activity.details?.before)) {
        const data = activity.details.after || activity.details.before;
        excelData.push({
          'Vreme': new Date(activity.timestamp).toLocaleString('sr-RS', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          }),
          'Admin': activity.userName,
          'Akcija': activity.action === 'equipment_add' ? 'Dodavanje opreme' :
                    activity.action === 'equipment_edit' ? 'Izmena opreme' :
                    activity.action === 'equipment_delete' ? 'Brisanje opreme' :
                    activity.action === 'basic_equipment_add' ? 'Dodavanje osnovne opreme' :
                    activity.action === 'basic_equipment_edit' ? 'Izmena osnovne opreme' :
                    activity.action === 'basic_equipment_delete' ? 'Brisanje osnovne opreme' : activity.action,
          'Kategorija': data.category || data.type || '',
          'Model/Opis': data.description || '',
          'Serijski Broj': data.serialNumber || '',
          'Status': data.status || '',
          'Lokacija': data.location || '',
          'Promene': activity.details?.changes ? activity.details.changes.join('; ') : '',
          'Trajanje (ms)': activity.metadata?.requestDuration || ''
        });
      }
      // Materials operations
      else if (activity.category === 'materials' || activity.action.includes('material')) {
        const data = activity.details?.after || activity.details?.before || {};

        // Za zaduženje materijala tehničaru, izvuci ime tehničara iz entityName
        let technicianName = '';
        if (activity.action === 'material_assign_to_tech' && activity.entityName) {
          const match = activity.entityName.match(/→ Tehničar: (.+)$/);
          technicianName = match ? match[1] : '';
        }

        excelData.push({
          'Vreme': new Date(activity.timestamp).toLocaleString('sr-RS', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          }),
          'Admin': activity.userName,
          'Akcija': activity.action === 'material_add' ? 'Dodavanje materijala' :
                    activity.action === 'material_edit' ? 'Izmena materijala' :
                    activity.action === 'material_delete' ? 'Brisanje materijala' :
                    activity.action === 'material_assign_to_tech' ? 'Zaduženje materijala' : activity.action,
          'Tip Materijala': data.type || activity.entityName?.split(' (')[0] || '',
          'Količina': data.quantity || '',
          'Ime Tehničara': technicianName,
          'Promene': activity.details?.changes ? activity.details.changes.join('; ') : '',
          'Trajanje (ms)': activity.metadata?.requestDuration || ''
        });
      }
      // Technicians operations (dodavanje/izmena/brisanje tehničara, ne zaduženje opreme/materijala)
      else if (activity.category === 'technicians' && (activity.action === 'technician_add' || activity.action === 'technician_edit' || activity.action === 'technician_delete')) {
        const data = activity.details?.after || activity.details?.before || {};
        excelData.push({
          'Vreme': new Date(activity.timestamp).toLocaleString('sr-RS', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          }),
          'Admin': activity.userName,
          'Akcija': activity.action === 'technician_add' ? 'Dodavanje tehničara' :
                    activity.action === 'technician_edit' ? 'Izmena tehničara' :
                    activity.action === 'technician_delete' ? 'Brisanje tehničara' : activity.action,
          'Ime Tehničara': activity.entityName || data.name || '',
          'Email': data.gmail || '',
          'Telefon': data.phoneNumber || '',
          'Status': data.isActive !== undefined ? (data.isActive ? 'Aktivan' : 'Neaktivan') : '',
          'Promene': activity.details?.changes ? activity.details.changes.join('; ') : '',
          'Trajanje (ms)': activity.metadata?.requestDuration || ''
        });
      }
      // Work orders operations
      else if (activity.category === 'workorders' || activity.action.includes('workorder')) {
        const data = activity.details?.after || activity.details?.before || {};

        // Za bulk dodavanje radnih naloga
        if (activity.details?.action === 'bulk_created' && activity.details?.addedItems) {
          const items = activity.details.addedItems || [];

          // Collect all technician IDs for batch lookup
          const techIds = items.map(item => item.technicianId).filter(Boolean);
          const techNames = {};

          // Batch lookup technician names
          if (techIds.length > 0) {
            const technicians = await Technician.find({ _id: { $in: techIds } }).select('_id name').lean();
            technicians.forEach(tech => {
              techNames[tech._id.toString()] = tech.name;
            });
          }

          items.forEach(item => {
            const technicianName = item.technicianName ||
                                   (item.technicianId ? techNames[item.technicianId.toString()] || '' : '');

            excelData.push({
              'Vreme': new Date(activity.timestamp).toLocaleString('sr-RS', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              }),
              'Admin/Tehničar': activity.userName,
              'Akcija': 'Bulk dodavanje radnih naloga',
              'TIS Job ID': item.tisJobId || '',
              'Adresa': item.address || '',
              'Opština': item.municipality || '',
              'Datum Naloga': item.date ? new Date(item.date).toLocaleDateString('sr-RS') : '',
              'Status': item.status || '',
              'Dodeljen Tehničar': technicianName,
              'Trajanje (ms)': activity.metadata?.requestDuration || ''
            });
          });
        } else {
          // Single workorder operacije
          const technicianName = data.technicianName ||
                                 (data.technicianId ? await getTechnicianName(data.technicianId) : '');

          excelData.push({
            'Vreme': new Date(activity.timestamp).toLocaleString('sr-RS', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            }),
            'Admin/Tehničar': activity.userName,
            'Akcija': activity.action === 'workorder_add' ? 'Dodavanje radnog naloga' :
                      activity.action === 'workorder_edit' ? 'Izmena radnog naloga' :
                      activity.action === 'workorder_delete' ? 'Brisanje radnog naloga' :
                      activity.action === 'workorder_bulk_add' ? 'Bulk dodavanje radnih naloga' : activity.action,
            'TIS Job ID': data.tisJobId || activity.entityName || '',
            'Adresa': data.address || '',
            'Opština': data.municipality || '',
            'Datum Naloga': data.date ? new Date(data.date).toLocaleDateString('sr-RS') : '',
            'Status': data.status || '',
            'Dodeljen Tehničar': technicianName,
            'Promene': activity.details?.changes ? activity.details.changes.join('; ') : '',
            'Trajanje (ms)': activity.metadata?.requestDuration || ''
          });
        }
      }
      // Users operations
      else if (activity.category === 'users' || activity.action.includes('user')) {
        const data = activity.details?.after || activity.details?.before || {};
        excelData.push({
          'Vreme': new Date(activity.timestamp).toLocaleString('sr-RS', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          }),
          'Admin': activity.userName,
          'Akcija': activity.action === 'user_add' ? 'Dodavanje korisnika' :
                    activity.action === 'user_edit' ? 'Izmena korisnika' :
                    activity.action === 'user_delete' ? 'Brisanje korisnika' : activity.action,
          'Ime Korisnika': activity.entityName || data.name || '',
          'Email': data.email || '',
          'Rola': data.role || '',
          'Promene': activity.details?.changes ? activity.details.changes.join('; ') : '',
          'Trajanje (ms)': activity.metadata?.requestDuration || ''
        });
      }
      // Vehicles operations
      else if (activity.category === 'vehicles' || activity.action.includes('vehicle')) {
        const data = activity.details?.after || activity.details?.before || {};
        excelData.push({
          'Vreme': new Date(activity.timestamp).toLocaleString('sr-RS', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          }),
          'Admin': activity.userName,
          'Akcija': activity.action === 'vehicle_add' ? 'Dodavanje vozila' :
                    activity.action === 'vehicle_edit' ? 'Izmena vozila' :
                    activity.action === 'vehicle_delete' ? 'Brisanje vozila' : activity.action,
          'Marka/Model': data.make ? `${data.make} ${data.model || ''}` : (activity.entityName || ''),
          'Registracija': data.plateNumber || '',
          'VIN': data.vin || '',
          'Godina': data.year || '',
          'Promene': activity.details?.changes ? activity.details.changes.join('; ') : '',
          'Trajanje (ms)': activity.metadata?.requestDuration || ''
        });
      }
      // Generic fallback za ostale kategorije
      else {
        excelData.push({
          'Vreme': new Date(activity.timestamp).toLocaleString('sr-RS', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          }),
          'Korisnik': activity.userName,
          'Akcija': activity.action,
          'Kategorija': activity.category,
          'Entitet': activity.entityName || '',
          'Detalji': JSON.stringify(activity.details || {}),
          'Trajanje (ms)': activity.metadata?.requestDuration || ''
        });
      }
    }

    console.log('📊 [Export] Generated Excel rows:', excelData.length);

    // Kreiraj worksheet
    const worksheet = xlsx.utils.json_to_sheet(excelData);

    // Dodaj worksheet u workbook
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Admin Aktivnosti');

    // Generiši buffer
    const excelBuffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Postavi headers za download
    const fileName = `admin-aktivnosti-${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    // Pošalji fajl
    res.send(excelBuffer);

  } catch (error) {
    console.error('❌ Error exporting activities:', error);
    res.status(500).json({ error: 'Greška pri exportovanju aktivnosti' });
  }
});

module.exports = router;
