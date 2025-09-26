const express = require('express');
const router = express.Router();
const { Log, Technician, WorkOrder, DismissedWorkOrder, FinancialTransaction, FinancialSettings } = require('../models');
const mongoose = require('mongoose');
const fetch = require('node-fetch');
const geocodingService = require('../services/geocodingService');

// Helper funkcija za formatiranje datuma za srpsko vreme
const formatSerbianDateTime = (date) => {
  const serbianDate = new Date(date);
  return serbianDate.toLocaleString('sr-RS', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Europe/Belgrade'
  });
};

// GET - Dohvati sve logove grupisane po tehničarima
router.get('/technicians', async (req, res) => {
  try {
    const { search, action, dateFrom, dateTo, page = 1, limit = 50 } = req.query;
    
    // Izgradi filter
    let filter = {};
    
    if (search) {
      filter.$or = [
        { performedByName: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { 'workOrderInfo.userName': { $regex: search, $options: 'i' } },
        { 'workOrderInfo.address': { $regex: search, $options: 'i' } },
        { 'workOrderInfo.municipality': { $regex: search, $options: 'i' } },
        { 'workOrderInfo.tisId': { $regex: search, $options: 'i' } }
      ];
    }
    
    if (action && action !== 'all') {
      filter.action = action;
    }
    
    if (dateFrom || dateTo) {
      filter.timestamp = {};
      if (dateFrom) {
        filter.timestamp.$gte = new Date(dateFrom);
      }
      if (dateTo) {
        filter.timestamp.$lte = new Date(dateTo);
      }
    }
    
    // Pagination
    const skip = (page - 1) * limit;
    
    // Dohvati logove
    const logs = await Log.find(filter)
      .populate('performedBy', 'name')
      .populate('workOrderId', 'municipality address type userName tisId')
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    // Grupiši po tehničarima
    const technicianGroups = {};
    
    logs.forEach(log => {
      const technicianId = log.performedBy?._id?.toString() || 'unknown';
      const technicianName = log.performedByName || 'Nepoznat tehničar';
      
      if (!technicianGroups[technicianId]) {
        technicianGroups[technicianId] = {
          technicianId,
          technicianName,
          logs: []
        };
      }
      
      // Dodaj formatiran datum
      log.formattedTimestamp = formatSerbianDateTime(log.timestamp);
      technicianGroups[technicianId].logs.push(log);
    });
    
    // Konvertuj u niz
    const result = Object.values(technicianGroups);
    
    // Dohvati ukupan broj logova za pagination
    const totalCount = await Log.countDocuments(filter);
    
    res.json({
      data: result,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    console.error('Greška pri dohvatanju logova tehničara:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju logova tehničara' });
  }
});

// GET - Dohvati sve logove grupisane po korisnicima
router.get('/users', async (req, res) => {
  try {
    const { search, action, dateFrom, dateTo, page = 1, limit = 50 } = req.query;
    
    // Izgradi filter
    let filter = {};
    
    if (search) {
      filter.$or = [
        { 'workOrderInfo.userName': { $regex: search, $options: 'i' } },
        { 'workOrderInfo.address': { $regex: search, $options: 'i' } },
        { 'workOrderInfo.municipality': { $regex: search, $options: 'i' } },
        { 'workOrderInfo.tisId': { $regex: search, $options: 'i' } },
        { performedByName: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (action && action !== 'all') {
      filter.action = action;
    }
    
    if (dateFrom || dateTo) {
      filter.timestamp = {};
      if (dateFrom) {
        filter.timestamp.$gte = new Date(dateFrom);
      }
      if (dateTo) {
        filter.timestamp.$lte = new Date(dateTo);
      }
    }
    
    // Pagination
    const skip = (page - 1) * limit;
    
    // Dohvati logove
    const logs = await Log.find(filter)
      .populate('performedBy', 'name')
      .populate('workOrderId', 'municipality address type userName tisId')
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    // Grupiši po korisnicima
    const userGroups = {};
    
    logs.forEach(log => {
      const userName = log.workOrderInfo?.userName || 'Nepoznat korisnik';
      const userKey = `${userName}_${log.workOrderInfo?.tisId || 'no-tis'}`;
      
      if (!userGroups[userKey]) {
        userGroups[userKey] = {
          userName,
          tisId: log.workOrderInfo?.tisId || '',
          logs: []
        };
      }
      
      // Dodaj formatiran datum
      log.formattedTimestamp = formatSerbianDateTime(log.timestamp);
      userGroups[userKey].logs.push(log);
    });
    
    // Konvertuj u niz
    const result = Object.values(userGroups);
    
    // Dohvati ukupan broj logova za pagination
    const totalCount = await Log.countDocuments(filter);
    
    res.json({
      data: result,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    console.error('Greška pri dohvatanju logova korisnika:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju logova korisnika' });
  }
});

// GET - Dohvati sve dostupne akcije za filter
router.get('/actions', async (req, res) => {
  try {
    const actions = await Log.distinct('action');
    
    const actionLabels = {
      'material_added': 'Dodavanje materijala',
      'material_removed': 'Uklanjanje materijala',
      'equipment_added': 'Dodavanje opreme',
      'equipment_removed': 'Uklanjanje opreme',
      'comment_added': 'Dodavanje komentara',
      'workorder_finished': 'Završavanje radnog naloga',
      'workorder_postponed': 'Odlagar radnog naloga',
      'workorder_cancelled': 'Otkazivanje radnog naloga',
      'workorder_status_changed': 'Promena statusa',
      'image_added': 'Dodavanje slike',
      'image_removed': 'Uklanjanje slike',
      'workorder_created': 'Kreiranje radnog naloga',
      'workorder_assigned': 'Dodela radnog naloga',
      'workorder_updated': 'Ažuriranje radnog naloga'
    };
    
    const result = actions.map(action => ({
      value: action,
      label: actionLabels[action] || action
    }));
    
    res.json(result);
  } catch (error) {
    console.error('Greška pri dohvatanju akcija:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju akcija' });
  }
});

// GET - Dohvati statistike
router.get('/statistics', async (req, res) => {
  try {
    const totalLogs = await Log.countDocuments();
    const todayLogs = await Log.countDocuments({
      timestamp: {
        $gte: new Date(new Date().setHours(0, 0, 0, 0)),
        $lt: new Date(new Date().setHours(23, 59, 59, 999))
      }
    });
    
    const actionStats = await Log.aggregate([
      {
        $group: {
          _id: '$action',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    const technicianStats = await Log.aggregate([
      {
        $group: {
          _id: '$performedBy',
          name: { $first: '$performedByName' },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 10
      }
    ]);
    
    res.json({
      totalLogs,
      todayLogs,
      topActions: actionStats.slice(0, 5),
      topTechnicians: technicianStats
    });
  } catch (error) {
    console.error('Greška pri dohvatanju statistika:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju statistika' });
  }
});

// GET - Dashboard KPI data with filters
router.get('/dashboard/kpi', async (req, res) => {
  try {
    const { period, technician, municipality, action } = req.query;
    
    // Build filter based on query parameters
    const filter = buildDashboardFilter(period, technician, municipality, action);
    
    // Total actions count
    const totalActions = await Log.countDocuments(filter);
    
    // Completed work orders count
    const completedWorkOrders = await Log.countDocuments({
      ...filter,
      action: 'workorder_finished'
    });
    
    // Active technicians count (unique performedByName)
    const activeTechnicians = await Log.distinct('performedByName', filter);
    const activeTechniciansCount = activeTechnicians.length;
    
    // Average response time (from workorder_created to workorder_finished)
    const responseTimeStats = await Log.aggregate([
      { $match: filter },
      {
        $facet: {
          created: [
            { $match: { action: 'workorder_created' } },
            { $group: { _id: '$workOrderId', createdAt: { $first: '$timestamp' } } }
          ],
          finished: [
            { $match: { action: 'workorder_finished' } },
            { $group: { _id: '$workOrderId', finishedAt: { $first: '$timestamp' } } }
          ]
        }
      },
      {
        $project: {
          responseTimes: {
            $map: {
              input: '$finished',
              as: 'finished',
              in: {
                $let: {
                  vars: {
                    created: {
                      $arrayElemAt: [
                        {
                          $filter: {
                            input: '$created',
                            cond: { $eq: ['$$this._id', '$$finished._id'] }
                          }
                        },
                        0
                      ]
                    }
                  },
                  in: {
                    $subtract: ['$$finished.finishedAt', '$$created.createdAt']
                  }
                }
              }
            }
          }
        }
      },
      {
        $unwind: '$responseTimes'
      },
      {
        $group: {
          _id: null,
          avgResponseTime: { $avg: '$responseTimes' }
        }
      }
    ]);
    
    const avgResponseTime = responseTimeStats.length > 0 
      ? Math.round(responseTimeStats[0].avgResponseTime / (1000 * 60 * 60)) // Convert to hours
      : 0;
    
    res.json({
      totalActions,
      completedWorkOrders,
      activeTechniciansCount,
      avgResponseTime
    });
  } catch (error) {
    console.error('Greška pri dohvatanju KPI podataka:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju KPI podataka' });
  }
});

// GET - Dashboard charts data
router.get('/dashboard/charts', async (req, res) => {
  try {
    const { period, technician, municipality, action } = req.query;
    const filter = buildDashboardFilter(period, technician, municipality, action);
    
    // Most frequent actions distribution (Doughnut chart)
    const actionsDistribution = await Log.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$action',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 8 }
    ]);
    
    // Work order status breakdown (Pie chart)
    const statusBreakdown = await Log.aggregate([
      { 
        $match: { 
          ...filter, 
          action: 'workorder_status_changed',
          'statusChange.newStatus': { $exists: true }
        } 
      },
      {
        $group: {
          _id: '$statusChange.newStatus',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);
    
    // Technician productivity comparison (Bar chart)
    const technicianProductivity = await Log.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$performedByName',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);
    
    // Materials usage by municipality (Radar chart)
    const municipalityMaterials = await Log.aggregate([
      { 
        $match: { 
          ...filter, 
          action: { $in: ['material_added', 'material_removed'] },
          'workOrderInfo.municipality': { $exists: true, $ne: '' }
        } 
      },
      {
        $group: {
          _id: '$workOrderInfo.municipality',
          materialAdded: {
            $sum: { $cond: [{ $eq: ['$action', 'material_added'] }, 1, 0] }
          },
          materialRemoved: {
            $sum: { $cond: [{ $eq: ['$action', 'material_removed'] }, 1, 0] }
          }
        }
      },
      { $sort: { materialAdded: -1 } },
      { $limit: 8 }
    ]);
    
    // Activity timeline over time (Line chart)
    const periodGrouping = getPeriodGrouping(period);
    const activityTimeline = await Log.aggregate([
      { $match: filter },
      {
        $group: {
          _id: periodGrouping,
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id': 1 } }
    ]);
    
    res.json({
      actionsDistribution,
      statusBreakdown,
      technicianProductivity,
      municipalityMaterials,
      activityTimeline
    });
  } catch (error) {
    console.error('Greška pri dohvatanju podataka za grafike:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju podataka za grafike' });
  }
});

// GET - Dashboard tables data
router.get('/dashboard/tables', async (req, res) => {
  try {
    const { period, technician, municipality, action } = req.query;
    const filter = buildDashboardFilter(period, technician, municipality, action);
    
    // Top 10 most active technicians
    const topTechnicians = await Log.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$performedByName',
          totalActions: { $sum: 1 },
          completedWorkOrders: {
            $sum: { $cond: [{ $eq: ['$action', 'workorder_finished'] }, 1, 0] }
          },
          materialsAdded: {
            $sum: { $cond: [{ $eq: ['$action', 'material_added'] }, 1, 0] }
          },
          equipmentAdded: {
            $sum: { $cond: [{ $eq: ['$action', 'equipment_added'] }, 1, 0] }
          },
          lastActivity: { $max: '$timestamp' }
        }
      },
      { $sort: { totalActions: -1 } },
      { $limit: 10 }
    ]);
    
    // Recent actions feed (last 20)
    const recentActions = await Log.find(filter)
      .populate('performedBy', 'name')
      .populate('workOrderId', 'municipality address type userName tisId')
      .sort({ timestamp: -1 })
      .limit(20)
      .lean();
    
    // Format recent actions
    recentActions.forEach(log => {
      log.formattedTimestamp = formatSerbianDateTime(log.timestamp);
    });
    
    // Get dismissed work orders to exclude them
    const dismissedWorkOrders = await DismissedWorkOrder.find({}).select('workOrderId').lean();
    const dismissedWorkOrderIds = dismissedWorkOrders.map(item => item.workOrderId);

    // Problematic work orders (postponed/cancelled) - with full WorkOrder data, excluding dismissed ones
    const problematicWorkOrdersAgg = await Log.aggregate([
      { 
        $match: { 
          ...filter, 
          action: { $in: ['workorder_postponed', 'workorder_cancelled'] },
          // Exclude dismissed work orders
          workOrderId: { $nin: dismissedWorkOrderIds }
        } 
      },
      {
        $group: {
          _id: '$workOrderId',
          workOrderInfo: { $first: '$workOrderInfo' },
          actions: { $push: { action: '$action', timestamp: '$timestamp', performedByName: '$performedByName' } },
          lastAction: { $last: '$action' },
          lastTimestamp: { $max: '$timestamp' }
        }
      },
      { $sort: { lastTimestamp: -1 } },
      { $limit: 15 }
    ]);
    
    // Populate full WorkOrder data including tisJobId
    const problematicWorkOrders = await Promise.all(
      problematicWorkOrdersAgg.map(async (item) => {
        if (item._id && mongoose.Types.ObjectId.isValid(item._id)) {
          const workOrder = await WorkOrder.findById(item._id).lean();
          return {
            ...item,
            workOrderFull: workOrder || null,
            // Include tisJobId and other important fields directly
            tisJobId: workOrder?.tisJobId || null,
            status: workOrder?.status || 'nezavrsen',
            type: workOrder?.type || null,
            municipality: workOrder?.municipality || item.workOrderInfo?.municipality,
            address: workOrder?.address || item.workOrderInfo?.address,
            userName: workOrder?.userName || item.workOrderInfo?.userName,
            tisId: workOrder?.tisId || item.workOrderInfo?.tisId
          };
        }
        return item;
      })
    );
    
    res.json({
      topTechnicians,
      recentActions, 
      problematicWorkOrders
    });
  } catch (error) {
    console.error('Greška pri dohvatanju podataka za tabele:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju podataka za tabele' });
  }
});

// GET - Dashboard filter options
router.get('/dashboard/filters', async (req, res) => {
  try {
    // Get all unique technicians
    const technicians = await Log.distinct('performedByName');
    
    // Get all unique municipalities
    const municipalities = await Log.distinct('workOrderInfo.municipality', {
      'workOrderInfo.municipality': { $exists: true, $ne: '' }
    });
    
    // Get all action types
    const actions = await Log.distinct('action');
    
    const actionLabels = {
      'material_added': 'Dodavanje materijala',
      'material_removed': 'Uklanjanje materijala',
      'equipment_added': 'Dodavanje opreme',
      'equipment_removed': 'Uklanjanje opreme',
      'comment_added': 'Dodavanje komentara',
      'workorder_finished': 'Završavanje radnog naloga',
      'workorder_postponed': 'Odlaganje radnog naloga',
      'workorder_cancelled': 'Otkazivanje radnog naloga',
      'workorder_status_changed': 'Promena statusa',
      'image_added': 'Dodavanje slike',
      'image_removed': 'Uklanjanje slike',
      'workorder_created': 'Kreiranje radnog naloga',
      'workorder_assigned': 'Dodela radnog naloga',
      'workorder_updated': 'Ažuriranje radnog naloga'
    };
    
    const formattedActions = actions.map(action => ({
      value: action,
      label: actionLabels[action] || action
    }));
    
    res.json({
      technicians: technicians.filter(t => t && t.trim() !== '').sort(),
      municipalities: municipalities.filter(m => m && m.trim() !== '').sort(),
      actions: formattedActions
    });
  } catch (error) {
    console.error('Greška pri dohvatanju opcija za filtere:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju opcija za filtere' });
  }
});

// GET - Map data for dashboard
router.get('/dashboard/map-data', async (req, res) => {
  try {
    const { startDate, endDate, technician, municipality } = req.query;
    
    // Build filter
    const filter = {};
    
    if (startDate && endDate) {
      filter.timestamp = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    if (technician && technician !== 'all') {
      filter.performedByName = technician;
    }
    
    if (municipality && municipality !== 'all') {
      filter['workOrderInfo.municipality'] = municipality;
    }
    
    // Only get logs with addresses
    filter['workOrderInfo.address'] = { $exists: true, $ne: '' };
    
    // Get logs with location data
    const logs = await Log.find(filter)
      .select('performedByName workOrderInfo timestamp action workOrderId')
      .sort({ performedByName: 1, timestamp: 1 })
      .lean();
    
    // Group by technician and add coordinates
    const mapData = {};
    
    // Process addresses with geocoding
    const processedLogs = await Promise.all(
      logs.map(async (log) => {
        const coords = await getCoordinatesForAddress(log.workOrderInfo.address);
        return {
          ...log,
          coordinates: coords
        };
      })
    );

    // Group by technician
    processedLogs.forEach(log => {
      const technicianName = log.performedByName;
      
      if (!mapData[technicianName]) {
        mapData[technicianName] = {
          technician: technicianName,
          locations: []
        };
      }
      
      mapData[technicianName].locations.push({
        workOrderId: log.workOrderId,
        address: log.workOrderInfo.address,
        coordinates: log.coordinates,
        timestamp: log.timestamp,
        action: log.action,
        formattedTime: formatSerbianDateTime(log.timestamp)
      });
    });
    
    res.json(Object.values(mapData));
  } catch (error) {
    console.error('Greška pri dohvatanju podataka za mapu:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju podataka za mapu' });
  }
});

// GET - Travel analytics for dashboard
router.get('/dashboard/travel-analytics', async (req, res) => {
  try {
    const { startDate, endDate, technician } = req.query;
    
    // Build filter
    const filter = {};
    
    if (startDate && endDate) {
      filter.timestamp = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    if (technician && technician !== 'all') {
      filter.performedByName = technician;
    }
    
    // Get work order creation and completion logs
    const workOrderLogs = await Log.find({
      ...filter,
      action: { $in: ['workorder_created', 'workorder_finished'] },
      'workOrderInfo.address': { $exists: true, $ne: '' }
    }).sort({ performedByName: 1, timestamp: 1 }).lean();
    
    // Group by technician and calculate travel times
    const technicianData = {};
    
    workOrderLogs.forEach(log => {
      const technicianName = log.performedByName;
      
      if (!technicianData[technicianName]) {
        technicianData[technicianName] = {
          workOrders: []
        };
      }
      
      const existingWO = technicianData[technicianName].workOrders.find(
        wo => wo.workOrderId.toString() === log.workOrderId.toString()
      );
      
      if (existingWO) {
        if (log.action === 'workorder_finished') {
          existingWO.finishedAt = log.timestamp;
        }
      } else if (log.action === 'workorder_created') {
        technicianData[technicianName].workOrders.push({
          workOrderId: log.workOrderId,
          address: log.workOrderInfo.address,
          createdAt: log.timestamp,
          finishedAt: null
        });
      }
    });
    
    // Calculate travel times and completion times
    const analytics = [];
    
    for (const technicianName of Object.keys(technicianData)) {
      const workOrders = technicianData[technicianName].workOrders
        .filter(wo => wo.finishedAt) // Only completed work orders
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      
      const routes = [];
      let totalTravelTime = 0;
      let totalCompletionTime = 0;
      let travelCount = 0;
      
            for (let i = 1; i < workOrders.length; i++) {
        const previousWO = workOrders[i - 1];
        const currentWO = workOrders[i];
        
        // Check if they're on the same day
        const prevDay = new Date(previousWO.finishedAt).toDateString();
        const currDay = new Date(currentWO.createdAt).toDateString();
        
        if (prevDay === currDay) {
          const travelTime = new Date(currentWO.createdAt) - new Date(previousWO.finishedAt);
          const travelMinutes = Math.round(travelTime / (1000 * 60));
          
          if (travelMinutes > 0 && travelMinutes < 300) { // Only reasonable travel times (0-5h)
            try {
              const [fromCoords, toCoords] = await Promise.all([
                getCoordinatesForAddress(previousWO.address),
                getCoordinatesForAddress(currentWO.address)
              ]);

              routes.push({
                from: {
                  address: previousWO.address,
                  coordinates: fromCoords,
                  time: formatSerbianDateTime(previousWO.finishedAt).split(' ')[1]
                },
                to: {
                  address: currentWO.address,
                  coordinates: toCoords,
                  time: formatSerbianDateTime(currentWO.createdAt).split(' ')[1]
                },
                travelTime: `${travelMinutes} min`,
                workOrderIds: [previousWO.workOrderId, currentWO.workOrderId]
              });
              
              totalTravelTime += travelMinutes;
              travelCount++;
            } catch (error) {
              console.error('Error geocoding route addresses:', error);
              // Skip this route if geocoding fails
            }
          }
        }
      }
      
      // Calculate average completion time
      workOrders.forEach(wo => {
        if (wo.finishedAt) {
          const completionTime = new Date(wo.finishedAt) - new Date(wo.createdAt);
          totalCompletionTime += completionTime;
        }
      });
      
      const avgTravelTime = travelCount > 0 ? Math.round(totalTravelTime / travelCount) : 0;
      const avgCompletionTime = workOrders.length > 0 ? 
        Math.round(totalCompletionTime / (workOrders.length * 1000 * 60 * 60 * 100)) / 100 : 0;
      
      analytics.push({
        technician: technicianName,
        routes,
        averageTravelTime: `${avgTravelTime} min`,
        averageCompletionTime: `${avgCompletionTime}h`,
        totalRoutes: routes.length,
        totalWorkOrders: workOrders.length
      });
    }
    
    res.json(analytics);
  } catch (error) {
    console.error('Greška pri dohvatanju analize putovanja:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju analize putovanja' });
  }
});

// TEST endpoint for geocoding
router.get('/test-geocoding', async (req, res) => {
  try {
    const { address, clear } = req.query;
    
    if (!address) {
      return res.status(400).json({ error: 'Address parameter is required' });
    }
    
    // Clear cache if requested
    if (clear === 'true') {
      console.log(`🗑️ Clearing cache for testing`);
      geocodeCache.clear();
    }
    
    console.log(`\n🧪 === TESTING GEOCODING FOR: "${address}" ===`);
    
    const startTime = Date.now();
    const coordinates = await getCoordinatesForAddress(address);
    const endTime = Date.now();
    
    const result = {
      originalAddress: address,
      coordinates: coordinates,
      processingTime: `${endTime - startTime}ms`,
      cacheSize: geocodeCache.size,
      message: 'Geocoding test completed - check server logs for details',
      googleMapsUrl: `https://www.google.com/maps?q=${coordinates.lat},${coordinates.lng}`
    };
    
    console.log(`🧪 TEST RESULT:`, result);
    
    res.json(result);
    
  } catch (error) {
    console.error('Geocoding test error:', error);
    res.status(500).json({ error: 'Geocoding test failed', details: error.message });
  }
});

// BULK TEST endpoint for multiple addresses
router.post('/test-geocoding-bulk', async (req, res) => {
  try {
    const { addresses } = req.body;
    
    if (!addresses || !Array.isArray(addresses)) {
      return res.status(400).json({ error: 'addresses array is required' });
    }
    
    console.log(`\n🧪 === BULK TESTING ${addresses.length} ADDRESSES ===`);
    
    const results = [];
    
    for (const address of addresses) {
      const startTime = Date.now();
      
      try {
        const coordinates = await getCoordinatesForAddress(address);
        const endTime = Date.now();
        
        results.push({
          address,
          coordinates,
          processingTime: `${endTime - startTime}ms`,
          status: 'success'
        });
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 300));
        
      } catch (error) {
        results.push({
          address,
          error: error.message,
          status: 'failed'
        });
      }
    }
    
    res.json({
      totalAddresses: addresses.length,
      successful: results.filter(r => r.status === 'success').length,
      failed: results.filter(r => r.status === 'failed').length,
      results
    });
    
  } catch (error) {
    console.error('Bulk geocoding test error:', error);
    res.status(500).json({ error: 'Bulk geocoding test failed' });
  }
});

// Cache for geocoded addresses - much more conservative caching
const geocodeCache = new Map();

// Clear cache immediately for testing
geocodeCache.clear();

// Clear cache every 2 minutes for testing
setInterval(() => {
  // console.log(`🗑️ Clearing geocode cache (${geocodeCache.size} entries)`);
  geocodeCache.clear();
}, 2 * 60 * 1000);

// Helper function to get coordinates for address using multiple geocoding services
async function getCoordinatesForAddress(address) {
  if (!address || address.trim() === '') {
    return { lat: 44.8150, lng: 20.4550 }; // Belgrade center
  }

  // Create unique cache key that includes address and timestamp to prevent over-caching
  const cacheKey = `${address.toLowerCase().trim()}_${Date.now() % 300000}`; // 5-minute rotation
  if (geocodeCache.has(cacheKey)) {
    const cached = geocodeCache.get(cacheKey);
    return cached;
  }

  // STEP 1: Try comprehensive Belgrade street database first
  const belgradeMatch = getBelgradeStreetCoordinates(address);
  if (belgradeMatch) {
    geocodeCache.set(cacheKey, belgradeMatch);
    return belgradeMatch;
  }

  // STEP 2: Try multiple formatted versions with Nominatim
  const formattedAddresses = createMultipleFormats(address);
  
  for (const formattedAddress of formattedAddresses) {
    try {
      const nominatimResult = await tryNominatimGeocoding(formattedAddress);
      if (nominatimResult && isInBelgradeArea(nominatimResult)) {
        geocodeCache.set(cacheKey, nominatimResult);
        return nominatimResult;
      }
    } catch (error) {
      // Continue to next format
    }
    
    // Small delay between requests to be respectful to the API
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // STEP 3: Try with Serbian Cyrillic if available
  try {
    const cyrillicResult = await tryWithCyrillic(address);
    if (cyrillicResult && isInBelgradeArea(cyrillicResult)) {
      geocodeCache.set(cacheKey, cyrillicResult);
      return cyrillicResult;
    }
  } catch (error) {
    // Continue to fallback
  }

  // STEP 4: Final fallback with better distribution
  const fallback = getFallbackCoordinates(address);
  geocodeCache.set(cacheKey, fallback);
  return fallback;
}

// Comprehensive Belgrade street coordinates database
function getBelgradeStreetCoordinates(address) {
  const addressLower = address.toLowerCase().trim();
  
  // Parse Belgrade address format: "Beograd,AREA,STREET NUMBER"
  let neighborhood = '';
  let street = '';
  let houseNumber = 0;
  
  if (addressLower.includes('beograd,')) {
    const parts = addressLower.split(',').map(p => p.trim());
    if (parts.length >= 3) {
      neighborhood = parts[1].replace(/^bg-/, ''); // Remove BG- prefix if present
      street = parts[2];
      
      // Extract house number
      const numberMatch = street.match(/\d+/);
      if (numberMatch) {
        houseNumber = parseInt(numberMatch[0]);
        street = street.replace(/\d+/g, '').trim(); // Remove number to get clean street name
      }
    }
  }
  
  // Comprehensive Belgrade street database with real coordinates
  const belgradeStreets = {
         // PADINSKA SKELA streets
     'padinska skela': {
       center: { lat: 44.8920, lng: 20.4770 },
       streets: {
         'besni fok': { lat: 44.8945, lng: 20.4795 },
        'dunavska': { lat: 44.8925, lng: 20.4765 },
        'ribarska': { lat: 44.8915, lng: 20.4775 },
        'šumska': { lat: 44.8905, lng: 20.4785 },
        'sumska': { lat: 44.8905, lng: 20.4785 },
        'padinskog odreda': { lat: 44.8940, lng: 20.4760 },
        'vojvođanska': { lat: 44.8910, lng: 20.4780 },
        'vojvodjanska': { lat: 44.8910, lng: 20.4780 },
        'cara dušana': { lat: 44.8930, lng: 20.4750 },
        'cara dusana': { lat: 44.8930, lng: 20.4750 }
      }
    },
    
    // BORČA streets
    'borča': {
      center: { lat: 44.8690, lng: 20.4170 },
      streets: {
        'mihaila šolohova': { lat: 44.8710, lng: 20.4190 },
        'mihaila solohova': { lat: 44.8710, lng: 20.4190 },
        'borska': { lat: 44.8695, lng: 20.4175 },
        'dunavska': { lat: 44.8685, lng: 20.4165 },
        'vojvođanska': { lat: 44.8685, lng: 20.4165 },
        'vojvodjanska': { lat: 44.8685, lng: 20.4165 },
        'zmaj jovina': { lat: 44.8700, lng: 20.4180 },
        'svetosavska': { lat: 44.8680, lng: 20.4160 },
        'cara lazara': { lat: 44.8705, lng: 20.4185 },
        'kneza miloša': { lat: 44.8690, lng: 20.4155 },
        'kneza milosa': { lat: 44.8690, lng: 20.4155 }
      }
    },
    
         // KRNJAČA streets  
     'krnjača': {
       center: { lat: 44.8840, lng: 20.4500 },
       streets: {
         'jovice vasiljevića': { lat: 44.8855, lng: 20.4525 },
         'jovice vasiljevica': { lat: 44.8855, lng: 20.4525 },
        'dunavska': { lat: 44.8845, lng: 20.4495 },
        'borska': { lat: 44.8845, lng: 20.4505 },
        'vojvođanska': { lat: 44.8835, lng: 20.4495 },
        'vojvodjanska': { lat: 44.8835, lng: 20.4495 },
        'cara dušana': { lat: 44.8850, lng: 20.4490 },
        'cara dusana': { lat: 44.8850, lng: 20.4490 },
        'svetog save': { lat: 44.8825, lng: 20.4515 },
        'kneza miloša': { lat: 44.8840, lng: 20.4485 },
        'kneza milosa': { lat: 44.8840, lng: 20.4485 }
      }
    },
    
    // OVČA streets
    'ovča': {
      center: { lat: 44.8670, lng: 20.4830 },
      streets: {
        'dunavska': { lat: 44.8675, lng: 20.4825 },
        'borska': { lat: 44.8665, lng: 20.4835 },
        'vojvođanska': { lat: 44.8680, lng: 20.4820 },
        'vojvodjanska': { lat: 44.8680, lng: 20.4820 },
        'cara dušana': { lat: 44.8685, lng: 20.4815 },
        'cara dusana': { lat: 44.8685, lng: 20.4815 }
      }
    },
    
    // KOTEŽ streets
    'kotež': {
      center: { lat: 44.8630, lng: 20.4630 },
      streets: {
        'dunavska': { lat: 44.8635, lng: 20.4625 },
        'borska': { lat: 44.8625, lng: 20.4635 },
        'vojvođanska': { lat: 44.8640, lng: 20.4620 },
        'vojvodjanska': { lat: 44.8640, lng: 20.4620 }
      }
    }
  };
  
  // Find matching neighborhood
  let areaData = null;
  let matchedArea = '';
  
  for (const [area, data] of Object.entries(belgradeStreets)) {
    if (neighborhood.includes(area) || addressLower.includes(area)) {
      areaData = data;
      matchedArea = area;
      break;
    }
  }
  
  if (!areaData) {
    return null;
  }
  
  // Find matching street
  let streetCoords = null;
  let matchedStreet = '';
  
  for (const [streetName, coords] of Object.entries(areaData.streets)) {
    if (street.includes(streetName) || addressLower.includes(streetName)) {
      streetCoords = coords;
      matchedStreet = streetName;
      break;
    }
  }
  
  // Use street coordinates if found, otherwise area center
  const baseCoords = streetCoords || areaData.center;
  
  // Add house number variation for more realistic positioning
  const houseVariation = {
    lat: (houseNumber % 100) / 50000, // 0-0.002 degrees based on house number (increased)
    lng: (houseNumber % 50) / 50000   // 0-0.001 degrees (increased)
  };
  
  // Add micro-variation based on full address hash for uniqueness
  const addressHash = address.split('').reduce((hash, char, index) => {
    return hash * 31 + char.charCodeAt(0) + index;
  }, 0);
  
  const microVariation = {
    lat: ((Math.abs(addressHash) % 40) - 20) / 200000, // ±0.0001 degrees (increased)
    lng: ((Math.abs(addressHash * 7) % 40) - 20) / 200000 // ±0.0001 degrees (increased)
  };
  
  const finalCoords = {
    lat: baseCoords.lat + houseVariation.lat + microVariation.lat,
    lng: baseCoords.lng + houseVariation.lng + microVariation.lng
  };
  
  return finalCoords;
}

// Create multiple address formats for better geocoding success
function createMultipleFormats(address) {
  const formats = [];
  const original = address.trim();
  
  // Parse Belgrade format: "Beograd,AREA,STREET NUMBER"
  if (original.toLowerCase().startsWith('beograd,')) {
    const parts = original.split(',').map(p => p.trim());
    if (parts.length >= 3) {
      const area = parts[1];
      const streetAndNumber = parts[2];
      
      // Format 1: Street Number, Area, Belgrade, Serbia
      formats.push(`${streetAndNumber}, ${area}, Belgrade, Serbia`);
      
      // Format 2: Street Number, Belgrade, Serbia
      formats.push(`${streetAndNumber}, Belgrade, Serbia`);
      
      // Format 3: Area Street Number, Belgrade
      formats.push(`${area} ${streetAndNumber}, Belgrade`);
      
      // Format 4: Just street and number with Belgrade
      formats.push(`${streetAndNumber}, Belgrade`);
      
      // Format 5: Serbian format
      formats.push(`${streetAndNumber}, ${area}, Beograd, Srbija`);
      
      // Format 6: With postal codes for known areas
      const postalCode = getPostalCodeForArea(area);
      if (postalCode) {
        formats.push(`${streetAndNumber}, ${postalCode} Belgrade, Serbia`);
      }
    }
  }
  
  // Always include original as last resort
  formats.push(original);
  
  return formats;
}

// Get postal codes for Belgrade areas
function getPostalCodeForArea(area) {
  const postalCodes = {
    'PADINSKA SKELA': '11273',
    'BORČA': '11271', 
    'BORCA': '11271',
    'KRNJAČA': '11272',
    'KRNJACA': '11272',
    'BG-KRNJAČA': '11272',
    'BG-KRNJACA': '11272',
    'OVČA': '11274',
    'OVCA': '11274'
  };
  
  return postalCodes[area.toUpperCase()] || null;
}

// Try Nominatim geocoding with detailed logging
async function tryNominatimGeocoding(address) {
  const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(address)}`;
  
  const response = await fetch(nominatimUrl, {
    headers: {
      'User-Agent': 'TelCo-Inventory-Management-Belgrade-App/1.0'
    }
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  
  const data = await response.json();
  console.log(`🔍 Nominatim returned ${data.length} results for: ${address}`);
  
  if (data && data.length > 0) {
    // Look for the best match - prefer results with higher importance or in Belgrade
    for (const result of data) {
      const coordinates = {
        lat: parseFloat(result.lat),
        lng: parseFloat(result.lon)
      };
      
      console.log(`   📍 Result: ${result.display_name}`);
      console.log(`   📍 Coords: ${coordinates.lat}, ${coordinates.lng}`);
      console.log(`   📍 Type: ${result.type}, Class: ${result.class}`);
      
      // Check if this looks like a Belgrade result
      const displayName = result.display_name.toLowerCase();
      if (displayName.includes('belgrade') || displayName.includes('beograd') || 
          displayName.includes('serbia') || displayName.includes('srbija')) {
        
        if (isInBelgradeArea(coordinates)) {
          return coordinates;
        }
      }
    }
    
    // If no Belgrade-specific match, try the first result if it's in Belgrade area
    const firstResult = data[0];
    const firstCoords = {
      lat: parseFloat(firstResult.lat),
      lng: parseFloat(firstResult.lon)
    };
    
    if (isInBelgradeArea(firstCoords)) {
      return firstCoords;
    }
  }
  
  return null;
}

// Try geocoding with Cyrillic characters
async function tryWithCyrillic(address) {
  // Simple Latin to Cyrillic mapping for Serbian
  const latinToCyrillic = {
    'PADINSKA SKELA': 'ПАДИНСКА СКЕЛА',
    'BORČA': 'БОРЧА', 
    'BORCA': 'БОРЧА',
    'KRNJAČA': 'КРЊАЧА',
    'KRNJACA': 'КРЊАЧА',
    'BESNI FOK': 'БЕСНИ ФОК',
    'MIHAILA ŠOLOHOVA': 'МИХАИЛА ШОЛОХОВА',
    'JOVICE VASILJEVIĆA': 'ЈОВИЦЕ ВАСИЛИЈЕВИЋА'
  };
  
  let cyrillicAddress = address;
  for (const [latin, cyrillic] of Object.entries(latinToCyrillic)) {
    cyrillicAddress = cyrillicAddress.replace(new RegExp(latin, 'gi'), cyrillic);
  }
  
  if (cyrillicAddress !== address) {
    return await tryNominatimGeocoding(cyrillicAddress);
  }
  
  return null;
}

// Direct coordinate matching for Belgrade addresses
function getDirectCoordinates(address) {
  const originalAddress = address;
  const addressLower = address.toLowerCase().trim();
  
  // Parse Belgrade address format: "Beograd,AREA,STREET NUMBER"
  let neighborhood = '';
  let street = '';
  let houseNumber = 0;
  
  if (addressLower.includes('beograd,')) {
    const parts = addressLower.split(',').map(p => p.trim());
    if (parts.length >= 3) {
      neighborhood = parts[1]; // PADINSKA SKELA, BORČA, etc.
      street = parts[2]; // BESNI FOK 25, etc.
      
      // Extract house number
      const numberMatch = street.match(/\d+/);
      if (numberMatch) {
        houseNumber = parseInt(numberMatch[0]);
        street = street.replace(/\d+/g, '').trim(); // Remove number to get clean street name
      }
    }
  }
  
  // Belgrade areas with base coordinates
  const belgradeAreas = {
    'padinska skela': { lat: 44.8920, lng: 20.4770 },
    'bg-padinska skela': { lat: 44.8920, lng: 20.4770 },
    'borča': { lat: 44.8690, lng: 20.4170 },
    'bg-borča': { lat: 44.8690, lng: 20.4170 },
    'borca': { lat: 44.8690, lng: 20.4170 },
    'krnjača': { lat: 44.8840, lng: 20.4500 },
    'bg-krnjača': { lat: 44.8840, lng: 20.4500 },
    'krnjaca': { lat: 44.8840, lng: 20.4500 },
    'bg-krnjaca': { lat: 44.8840, lng: 20.4500 },
    'ovča': { lat: 44.8670, lng: 20.4830 },
    'ovca': { lat: 44.8670, lng: 20.4830 },
    'kotež': { lat: 44.8630, lng: 20.4630 },
    'kotez': { lat: 44.8630, lng: 20.4630 }
  };
  
  // Specific street offsets from area center
  const streetOffsets = {
    'besni fok': { latOffset: 0.0015, lngOffset: 0.0015 },
    'dunavska': { latOffset: 0.0005, lngOffset: -0.0005 },
    'ribarska': { latOffset: -0.0005, lngOffset: 0.0005 },
    'šumska': { latOffset: -0.0015, lngOffset: 0.0015 },
    'sumska': { latOffset: -0.0015, lngOffset: 0.0015 },
    'mihaila šolohova': { latOffset: -0.0014, lngOffset: -0.0054 },
    'mihaila solohova': { latOffset: -0.0014, lngOffset: -0.0054 },
    'jovice vasiljevića': { latOffset: -0.0008, lngOffset: 0.0012 },
    'jovice vasiljevica': { latOffset: -0.0008, lngOffset: 0.0012 },
    'borska': { latOffset: 0.0005, lngOffset: 0.0005 },
    'vojvođanska': { latOffset: -0.0005, lngOffset: -0.0005 },
    'vojvodjanska': { latOffset: -0.0005, lngOffset: -0.0005 }
  };
  
  // Find matching area
  let baseCoords = null;
  let areaName = '';
  
  for (const [area, coords] of Object.entries(belgradeAreas)) {
    if (neighborhood.includes(area) || addressLower.includes(area)) {
      baseCoords = coords;
      areaName = area;
      break;
    }
  }
  
  if (!baseCoords) {
    return null;
  }
  
  // Apply street offset if found
  let streetOffset = { latOffset: 0, lngOffset: 0 };
  for (const [streetName, offset] of Object.entries(streetOffsets)) {
    if (street.includes(streetName) || addressLower.includes(streetName)) {
      streetOffset = offset;
      break;
    }
  }
  
  // Calculate final coordinates
  const houseVariation = (houseNumber % 100) / 200000; // 0-0.0005 degrees based on house number
  const addressHash = originalAddress.split('').reduce((hash, char) => {
    return hash * 31 + char.charCodeAt(0);
  }, 0);
  
  const microVariation = {
    lat: ((Math.abs(addressHash) % 40) - 20) / 400000, // ±0.00005 degrees
    lng: ((Math.abs(addressHash * 7) % 40) - 20) / 400000
  };
  
  const finalCoords = {
    lat: baseCoords.lat + streetOffset.latOffset + houseVariation + microVariation.lat,
    lng: baseCoords.lng + streetOffset.lngOffset + houseVariation + microVariation.lng
  };
  
  return finalCoords;
}

// Helper function to format Belgrade addresses for better geocoding
function formatBelgradeAddress(address) {
  let formatted = address.trim();
  
  // Handle the specific format: "Beograd,PADINSKA SKELA,BESNI FOK 25"
  if (formatted.toLowerCase().startsWith('beograd,')) {
    // Remove "Beograd," from the beginning
    formatted = formatted.substring(8).trim();
    
    // Split by comma to get neighborhood and street
    const parts = formatted.split(',').map(part => part.trim());
    
    if (parts.length >= 2) {
      const neighborhood = parts[0];
      const streetAndNumber = parts[1];
      
      // Format for better geocoding: "Street Number, Neighborhood, Belgrade, Serbia"
      formatted = `${streetAndNumber}, ${neighborhood}, Belgrade, Serbia`;
    } else {
      // If only one part after Beograd, add Belgrade context
      formatted = `${formatted}, Belgrade, Serbia`;
    }
  } else {
    // Add Belgrade if not present
    if (!formatted.toLowerCase().includes('beograd') && 
        !formatted.toLowerCase().includes('belgrade')) {
      formatted += ', Belgrade, Serbia';
    }
  }
  
  // Common address formatting fixes for Serbian addresses
  formatted = formatted
    .replace(/\bul\.\s*/gi, 'ulica ')
    .replace(/\bbr\.\s*/gi, 'broj ')
    .replace(/\bbb\.\s*/gi, 'bb ')
    .replace(/\s+/g, ' ')
    .trim();
  
  return formatted;
}

// Check if coordinates are in Belgrade area
function isInBelgradeArea(coordinates) {
  const { lat, lng } = coordinates;
  // Belgrade bounds (approximate)
  return lat >= 44.6 && lat <= 45.0 && lng >= 20.2 && lng <= 20.8;
}

// Intelligent fallback coordinates based on address analysis
function getFallbackCoordinates(address) {
  // Analyze address to get better area-based coordinates
  const addressLower = address.toLowerCase();
  let baseCoords = { lat: 44.8150, lng: 20.4550 }; // Default Belgrade center
  let areaName = 'Belgrade Center';
  
  // Known Belgrade areas with more accurate coordinates
  const areaCoordinates = {
    'padinska skela': { lat: 44.8920, lng: 20.4770, name: 'Padinska Skela' },
    'padinska': { lat: 44.8920, lng: 20.4770, name: 'Padinska Skela' },
    'borča': { lat: 44.8690, lng: 20.4170, name: 'Borča' },
    'borca': { lat: 44.8690, lng: 20.4170, name: 'Borča' },
    'krnjača': { lat: 44.8840, lng: 20.4500, name: 'Krnjača' },
    'krnjaca': { lat: 44.8840, lng: 20.4500, name: 'Krnjača' },
    'bg-krnjača': { lat: 44.8840, lng: 20.4500, name: 'Krnjača' },
    'bg-krnjaca': { lat: 44.8840, lng: 20.4500, name: 'Krnjača' },
    'ovča': { lat: 44.8670, lng: 20.4830, name: 'Ovča' },
    'ovca': { lat: 44.8670, lng: 20.4830, name: 'Ovča' },
    'kotež': { lat: 44.8630, lng: 20.4630, name: 'Kotež' },
    'kotez': { lat: 44.8630, lng: 20.4630, name: 'Kotež' }
  };
  
  // Find the best matching area
  for (const [area, coords] of Object.entries(areaCoordinates)) {
    if (addressLower.includes(area)) {
      baseCoords = coords;
      areaName = coords.name;
      break;
    }
  }
  
  // Create unique variation based on full address
  const addressHash = address.split('').reduce((hash, char, index) => {
    return hash * 31 + char.charCodeAt(0) + index;
  }, 0);
  
  // Generate house number variation if present
  const numberMatch = address.match(/\d+/);
  const houseNumber = numberMatch ? parseInt(numberMatch[0]) : 0;
  const houseVariation = (houseNumber % 100) / 100000; // 0-0.001 degrees
  
  // Street name variation
  const streetHash = address.replace(/\d+/g, '').trim().split('').reduce((hash, char) => {
    return hash * 17 + char.charCodeAt(0);
  }, 0);
  
  // Calculate final coordinates with multiple variation sources
  const latVariation = (
    ((Math.abs(addressHash) % 200) - 100) / 50000 + // ±0.002 degrees
    ((Math.abs(streetHash) % 50) - 25) / 100000 +    // ±0.00025 degrees  
    houseVariation                                    // 0-0.001 degrees
  );
  
  const lngVariation = (
    ((Math.abs(addressHash * 7) % 200) - 100) / 50000 +
    ((Math.abs(streetHash * 3) % 50) - 25) / 100000 +
    houseVariation
  );
  
  const result = {
    lat: baseCoords.lat + latVariation,
    lng: baseCoords.lng + lngVariation
  };
  
  return result;
}

// Helper function to build filter based on dashboard parameters
function buildDashboardFilter(period, technician, municipality, action) {
  const filter = {};
  
  // Period filter
  if (period && period !== 'all') {
    const now = new Date();
    let startDate;
    
    switch (period) {
      case 'danas':
        startDate = new Date(now.setHours(0, 0, 0, 0));
        filter.timestamp = { $gte: startDate };
        break;
      case 'nedelja':
        const dayOfWeek = now.getDay();
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        startDate = new Date(now);
        startDate.setDate(now.getDate() - daysToMonday);
        startDate.setHours(0, 0, 0, 0);
        filter.timestamp = { $gte: startDate };
        break;
      case 'mesec':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        filter.timestamp = { $gte: startDate };
        break;
      case 'kvartal':
        const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
        startDate = new Date(now.getFullYear(), quarterStartMonth, 1);
        filter.timestamp = { $gte: startDate };
        break;
      case 'godina':
        startDate = new Date(now.getFullYear(), 0, 1);
        filter.timestamp = { $gte: startDate };
        break;
    }
  }
  
  // Technician filter
  if (technician && technician !== 'all') {
    filter.performedByName = technician;
  }
  
  // Municipality filter
  if (municipality && municipality !== 'all') {
    filter['workOrderInfo.municipality'] = municipality;
  }
  
  // Action filter
  if (action && action !== 'all') {
    filter.action = action;
  }
  
  return filter;
}

// Helper function to get period grouping for timeline chart
function getPeriodGrouping(period) {
  switch (period) {
    case 'danas':
      return {
        year: { $year: '$timestamp' },
        month: { $month: '$timestamp' },
        day: { $dayOfMonth: '$timestamp' },
        hour: { $hour: '$timestamp' }
      };
    case 'nedelja':
      return {
        year: { $year: '$timestamp' },
        month: { $month: '$timestamp' },
        day: { $dayOfMonth: '$timestamp' }
      };
    case 'mesec':
      return {
        year: { $year: '$timestamp' },
        month: { $month: '$timestamp' },
        week: { $week: '$timestamp' }
      };
    case 'kvartal':
    case 'godina':
      return {
        year: { $year: '$timestamp' },
        month: { $month: '$timestamp' }
      };
    default:
      return {
        year: { $year: '$timestamp' },
        month: { $month: '$timestamp' },
        day: { $dayOfMonth: '$timestamp' }
      };
  }
}

// POST - Dismiss a problematic work order from dashboard
router.post('/dashboard/dismiss-work-order', async (req, res) => {
  try {
    const { workOrderId } = req.body;
    
    if (!workOrderId) {
      return res.status(400).json({ error: 'workOrderId je obavezan' });
    }
    
    // Check if workOrderId is valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(workOrderId)) {
      return res.status(400).json({ error: 'Nevalidan workOrderId' });
    }
    
    // Create or update dismissed work order record
    const dismissedWorkOrder = await DismissedWorkOrder.findOneAndUpdate(
      { workOrderId: workOrderId },
      { 
        workOrderId: workOrderId,
        dismissedAt: new Date(),
        dismissedBy: 'admin'
      },
      { 
        upsert: true, 
        new: true,
        setDefaultsOnInsert: true
      }
    );
    
    console.log(`✅ Work order ${workOrderId} dismissed from problematic list`);
    
    res.json({ 
      success: true, 
      message: 'Radni nalog je uklonjen iz problematičnih',
      dismissedWorkOrder
    });
    
  } catch (error) {
    console.error('Greška pri uklanjanju radnog naloga:', error);
    res.status(500).json({ error: 'Greška pri uklanjanju radnog naloga' });
  }
});

// GET - Cancellation analysis data for dashboard
router.get('/dashboard/cancellation-analysis', async (req, res) => {
  try {
    const { timeRange = '30d', technician, municipalities } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate;

    switch (timeRange) {
      case '7d':
        startDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now - 90 * 24 * 60 * 60 * 1000);
        break;
      case '180d':
        startDate = new Date(now - 180 * 24 * 60 * 60 * 1000);
        break;
      case '365d':
        startDate = new Date(now - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
    }

    // Build filter for cancelled work orders
    const filter = {
      status: 'otkazan',
      statusChangedAt: { $gte: startDate, $lte: now }
    };

    // Add technician filter
    if (technician && technician !== 'all') {
      filter.$or = [
        { 'technicianId': technician },
        { 'technician2Id': technician }
      ];
    }

    // Add municipality filter
    if (municipalities && municipalities.length > 0) {
      const municipalityList = typeof municipalities === 'string'
        ? municipalities.split(',')
        : municipalities;
      filter.municipality = { $in: municipalityList };
    }

    // Get cancelled work orders with populated technician data
    const cancelledWorkOrders = await WorkOrder.find(filter)
      .populate('technicianId', 'name')
      .populate('technician2Id', 'name')
      .populate('statusChangedBy', 'name')
      .lean();

    // Process cancellation data for analysis
    const cancellationData = cancelledWorkOrders.map(wo => {
      // Get the most recent cancellation from cancelHistory
      const latestCancellation = wo.cancelHistory && wo.cancelHistory.length > 0
        ? wo.cancelHistory[wo.cancelHistory.length - 1]
        : null;

      // Determine primary technician
      const primaryTechnician = wo.technicianId?.name || wo.technician2Id?.name || 'Nepoznat tehničar';

      // Extract and categorize cancellation reason
      const cancellationComment = latestCancellation?.comment || 'Nespecifikovano';
      const cancellationReason = categorizeCancellationReason(cancellationComment);

      // Calculate response time (from creation to cancellation)
      const createdAt = wo.createdAt || wo.date;
      const cancelledAt = wo.statusChangedAt || latestCancellation?.canceledAt || now;
      const responseTime = Math.round((new Date(cancelledAt) - new Date(createdAt)) / (1000 * 60)); // in minutes

      return {
        id: wo._id.toString(),
        workOrderId: wo._id.toString(),
        tisJobId: wo.tisJobId || null,
        municipality: wo.municipality,
        address: wo.address,
        userName: wo.userName,
        type: wo.type,
        technician: primaryTechnician,
        statusChangedBy: wo.statusChangedBy?.name || primaryTechnician,
        timestamp: cancelledAt,
        cancellationReason: cancellationReason,
        cancellationComment: cancellationComment,
        responseTime: responseTime > 0 ? responseTime : 30, // Fallback to 30 min if calculation fails
        status: 'cancelled',
        date: wo.date,
        createdAt: createdAt
      };
    });

    // Also get cancellation logs for additional context
    const cancellationLogs = await Log.find({
      action: 'workorder_cancelled',
      timestamp: { $gte: startDate, $lte: now }
    })
      .populate('performedBy', 'name')
      .populate('workOrderId', 'municipality address userName tisId tisJobId')
      .lean();

    // Merge log data with work order data
    const enhancedCancellationData = cancellationData.map(cancellation => {
      const relatedLog = cancellationLogs.find(log =>
        log.workOrderId?._id.toString() === cancellation.workOrderId
      );

      if (relatedLog) {
        return {
          ...cancellation,
          logDescription: relatedLog.description,
          logPerformedBy: relatedLog.performedBy?.name || relatedLog.performedByName,
          logTimestamp: relatedLog.timestamp
        };
      }

      return cancellation;
    });

    res.json({
      data: enhancedCancellationData,
      totalCount: enhancedCancellationData.length,
      timeRange,
      dateRange: {
        startDate: startDate.toISOString(),
        endDate: now.toISOString()
      }
    });

  } catch (error) {
    console.error('Greška pri dohvatanju analize otkazivanja:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju analize otkazivanja' });
  }
});

// GET - Hourly activity distribution data for dashboard
router.get('/dashboard/hourly-activity-distribution', async (req, res) => {
  try {
    const { timeRange = '30d', technician, municipalities } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate;

    switch (timeRange) {
      case '7d':
        startDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now - 90 * 24 * 60 * 60 * 1000);
        break;
      case '180d':
        startDate = new Date(now - 180 * 24 * 60 * 60 * 1000);
        break;
      case '365d':
        startDate = new Date(now - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
    }

    // Build filter for activity logs
    const filter = {
      timestamp: { $gte: startDate, $lte: now }
    };

    // Add technician filter
    if (technician && technician !== 'all') {
      filter.performedByName = technician;
    }

    // Add municipality filter
    if (municipalities && municipalities.length > 0) {
      const municipalityList = typeof municipalities === 'string'
        ? municipalities.split(',')
        : municipalities;
      filter['workOrderInfo.municipality'] = { $in: municipalityList };
    }

    // Get activity logs with populated data
    const activityLogs = await Log.find(filter)
      .populate('performedBy', 'name')
      .populate('workOrderId', 'municipality address type userName tisId tisJobId date prvoMenjanjeStatusa')
      .sort({ timestamp: 1 }) // Sort by time for better analysis
      .lean();

    // Process activity data for hourly distribution analysis
    const hourlyActivityData = activityLogs.map(log => {
      const workOrder = log.workOrderId;

      // Calculate response time if we have workorder creation and status change times
      let responseTime = null;
      if (workOrder?.date && workOrder?.prvoMenjanjeStatusa) {
        responseTime = Math.round((new Date(workOrder.prvoMenjanjeStatusa) - new Date(workOrder.date)) / (1000 * 60)); // in minutes
      }

      // Categorize activity type for better analysis
      const activityCategory = categorizeActivityType(log.action);
      const activityPriority = getActivityPriority(log.action);

      return {
        id: log._id.toString(),
        timestamp: log.timestamp,
        hour: new Date(log.timestamp).getHours(),
        dayOfWeek: getDayOfWeek(new Date(log.timestamp)),
        technician: log.performedByName || log.performedBy?.name || 'Nepoznat tehničar',
        municipality: log.workOrderInfo?.municipality || workOrder?.municipality || 'Nepoznato',
        address: log.workOrderInfo?.address || workOrder?.address || '',
        workOrderId: log.workOrderId?._id?.toString() || null,
        tisJobId: log.workOrderInfo?.tisId || workOrder?.tisJobId || workOrder?.tisId || null,
        action: log.action,
        activityType: activityCategory,
        activityPriority: activityPriority,
        description: log.description,
        responseTime: responseTime || null,
        workOrderType: workOrder?.type || null,
        userName: log.workOrderInfo?.userName || workOrder?.userName || null
      };
    });

    res.json({
      data: hourlyActivityData,
      totalCount: hourlyActivityData.length,
      timeRange,
      dateRange: {
        startDate: startDate.toISOString(),
        endDate: now.toISOString()
      }
    });

  } catch (error) {
    console.error('Greška pri dohvatanju distribucije aktivnosti po satima:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju distribucije aktivnosti po satima' });
  }
});

// Helper function to categorize activity types
function categorizeActivityType(action) {
  const categories = {
    'Rad sa nalozima': ['workorder_created', 'workorder_assigned', 'workorder_updated', 'workorder_finished'],
    'Upravljanje statusom': ['workorder_status_changed', 'workorder_postponed', 'workorder_cancelled'],
    'Materijali': ['material_added', 'material_removed'],
    'Oprema': ['equipment_added', 'equipment_removed'],
    'Dokumentacija': ['comment_added', 'image_added', 'image_removed'],
  };

  for (const [category, actions] of Object.entries(categories)) {
    if (actions.includes(action)) {
      return category;
    }
  }

  return 'Ostale aktivnosti';
}

// Helper function to determine activity priority
function getActivityPriority(action) {
  const highPriority = ['workorder_finished', 'workorder_cancelled', 'equipment_added', 'equipment_removed'];
  const mediumPriority = ['workorder_created', 'workorder_assigned', 'workorder_status_changed', 'material_added'];
  const lowPriority = ['comment_added', 'image_added', 'image_removed', 'workorder_updated'];

  if (highPriority.includes(action)) return 'high';
  if (mediumPriority.includes(action)) return 'medium';
  if (lowPriority.includes(action)) return 'low';

  return 'normal';
}

// Helper function to get day of week
function getDayOfWeek(date) {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[date.getDay()];
}

// Helper function to categorize cancellation reasons
function categorizeCancellationReason(comment) {
  if (!comment) return 'Ostali razlozi';

  const commentLower = comment.toLowerCase();

  // Define categories and keywords
  const categories = {
    'Korisnik nije kod kuće': [
      'nije kod kuće', 'not at home', 'nema kod kuće', 'nema doma',
      'otišao', 'nije tu', 'absent', 'away'
    ],
    'Neispravna adresa': [
      'pogrešna adresa', 'neispravna adresa', 'wrong address', 'bad address',
      'ne postoji adresa', 'nema adrese', 'ne mogu da nađem'
    ],
    'Nema signala': [
      'nema signal', 'no signal', 'slab signal', 'poor signal',
      'problem sa signalom', 'signal issue', 'interferenca'
    ],
    'Materijal nedostupan': [
      'nema materijal', 'no material', 'nedostaje materijal', 'material shortage',
      'čeka se materijal', 'waiting for material', 'skladište'
    ],
    'Kvar opreme': [
      'kvar', 'broken', 'ne radi', 'not working', 'equipment failure',
      'tehnički problem', 'technical issue', 'defekt'
    ],
    'Korisnik odustao': [
      'korisnik odustao', 'customer cancelled', 'ne želi', 'odbio',
      'refused', 'declined', 'predomislio se', 'changed mind'
    ],
    'Vremenski uslovi': [
      'kiša', 'rain', 'sneg', 'snow', 'vreme', 'weather',
      'oluja', 'storm', 'loši uslovi'
    ],
    'Kašnjenje tehničara': [
      'kasni', 'late', 'zakasni', 'delayed', 'čeka se tehničar',
      'tehnički problem', 'tehnička podrška'
    ]
  };

  // Check each category
  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(keyword => commentLower.includes(keyword))) {
      return category;
    }
  }

  return 'Ostali razlozi';
}

// GET - Interactive map activity data for dashboard
router.get('/dashboard/interactive-map', async (req, res) => {
  try {
    const { timeRange = '30d', technician, municipalities, activityType } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate;

    switch (timeRange) {
      case '7d':
        startDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now - 90 * 24 * 60 * 60 * 1000);
        break;
      case '180d':
        startDate = new Date(now - 180 * 24 * 60 * 60 * 1000);
        break;
      case '365d':
        startDate = new Date(now - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
    }

    // Get work orders for map data
    const workOrderFilter = {
      date: { $gte: startDate, $lte: now }
    };

    // Add technician filter
    if (technician && technician !== 'all') {
      workOrderFilter.$or = [
        { technicianId: technician },
        { technician2Id: technician }
      ];
    }

    // Add municipality filter
    if (municipalities && municipalities.length > 0) {
      const municipalityList = typeof municipalities === 'string'
        ? municipalities.split(',')
        : municipalities;
      workOrderFilter.municipality = { $in: municipalityList };
    }

    // Get work orders with populated technician data
    const workOrders = await WorkOrder.find(workOrderFilter)
      .populate('technicianId', 'name')
      .populate('technician2Id', 'name')
      .populate('statusChangedBy', 'name')
      .lean();

    // Get activity logs for enhanced data
    const logFilter = {
      timestamp: { $gte: startDate, $lte: now }
    };

    if (technician && technician !== 'all') {
      logFilter.performedByName = technician;
    }

    const activityLogs = await Log.find(logFilter)
      .populate('performedBy', 'name')
      .populate('workOrderId', 'municipality address type userName date status')
      .lean();

    // Combine work orders and activity logs for comprehensive map data
    const mapActivities = [];

    // Process work orders
    workOrders.forEach(wo => {
      const primaryTechnician = wo.technicianId?.name || wo.technician2Id?.name || 'Nepoznat tehničar';

      // Calculate response time
      let responseTime = null;
      if (wo.date && wo.prvoMenjanjeStatusa) {
        responseTime = Math.round((new Date(wo.prvoMenjanjeStatusa) - new Date(wo.date)) / (1000 * 60));
      }

      // Determine activity type based on work order
      let workOrderActivityType = 'workorder_created';
      if (wo.status === 'zavrsen') workOrderActivityType = 'workorder_finished';
      else if (wo.status === 'otkazan') workOrderActivityType = 'workorder_cancelled';
      else if (wo.status === 'odlozen') workOrderActivityType = 'workorder_postponed';

      mapActivities.push({
        id: wo._id.toString(),
        timestamp: wo.date,
        municipality: wo.municipality,
        address: wo.address,
        technician: primaryTechnician,
        userName: wo.userName,
        action: workOrderActivityType,
        activityType: categorizeMapActivityType(workOrderActivityType),
        priority: getMapActivityPriority(wo.status),
        status: wo.status,
        type: wo.type,
        responseTime: responseTime,
        workOrderId: wo._id.toString(),
        source: 'workorder'
      });
    });

    // Process activity logs for additional context
    activityLogs.forEach(log => {
      const workOrder = log.workOrderId;
      if (!workOrder) return;

      mapActivities.push({
        id: log._id.toString(),
        timestamp: log.timestamp,
        municipality: workOrder.municipality,
        address: workOrder.address,
        technician: log.performedByName || log.performedBy?.name || 'Nepoznat tehničar',
        userName: workOrder.userName,
        action: log.action,
        activityType: categorizeMapActivityType(log.action),
        priority: getMapActivityPriority(log.action),
        status: workOrder.status,
        type: workOrder.type,
        responseTime: null, // Not available for individual logs
        workOrderId: log.workOrderId._id.toString(),
        description: log.description,
        source: 'log'
      });
    });

    // Filter by activity type if specified
    let filteredActivities = mapActivities;
    if (activityType && activityType !== 'all') {
      filteredActivities = mapActivities.filter(activity =>
        activity.activityType === activityType
      );
    }

    // Debug: Log unique municipalities to see what's in the data
    const uniqueMunicipalities = [...new Set(filteredActivities.map(a => a.municipality).filter(Boolean))];
    console.log(`🗺️ Interactive map: Found ${uniqueMunicipalities.length} unique municipalities:`);
    uniqueMunicipalities.sort().forEach(municipality => {
      console.log(`   - ${municipality}`);
    });

    res.json({
      data: filteredActivities,
      totalCount: filteredActivities.length,
      timeRange,
      dateRange: {
        startDate: startDate.toISOString(),
        endDate: now.toISOString()
      },
      uniqueMunicipalities: uniqueMunicipalities.sort()
    });

  } catch (error) {
    console.error('Greška pri dohvatanju podataka za interaktivnu mapu:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju podataka za interaktivnu mapu' });
  }
});

// Helper function to categorize map activity types
function categorizeMapActivityType(action) {
  const categories = {
    'Radni nalozi': [
      'workorder_created', 'workorder_assigned', 'workorder_updated',
      'workorder_finished', 'workorder_cancelled', 'workorder_postponed'
    ],
    'Materijali': ['material_added', 'material_removed'],
    'Oprema': ['equipment_added', 'equipment_removed'],
    'Dokumentacija': ['comment_added', 'image_added', 'image_removed'],
    'Status promene': ['workorder_status_changed']
  };

  for (const [category, actions] of Object.entries(categories)) {
    if (actions.includes(action)) {
      return category;
    }
  }

  return 'Ostale aktivnosti';
}

// Helper function to determine map activity priority
function getMapActivityPriority(statusOrAction) {
  const highPriority = ['workorder_finished', 'workorder_cancelled', 'zavrsen', 'otkazan'];
  const mediumPriority = ['workorder_created', 'workorder_assigned', 'workorder_status_changed', 'nezavrsen'];
  const lowPriority = ['comment_added', 'image_added', 'workorder_updated', 'odlozen'];

  if (highPriority.includes(statusOrAction)) return 'high';
  if (mediumPriority.includes(statusOrAction)) return 'medium';
  if (lowPriority.includes(statusOrAction)) return 'low';

  return 'normal';
}

// GET - Get list of dismissed work orders
router.get('/dashboard/dismissed-work-orders', async (req, res) => {
  try {
    const dismissedWorkOrders = await DismissedWorkOrder.find({})
      .populate('workOrderId', 'tisJobId municipality address userName status')
      .sort({ dismissedAt: -1 })
      .lean();

    res.json(dismissedWorkOrders);

  } catch (error) {
    console.error('Greška pri dohvatanju uklonjenih radnih naloga:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju uklonjenih radnih naloga' });
  }
});

// DELETE - Re-add a dismissed work order to problematic list 
router.delete('/dashboard/dismiss-work-order/:workOrderId', async (req, res) => {
  try {
    const { workOrderId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(workOrderId)) {
      return res.status(400).json({ error: 'Nevalidan workOrderId' });
    }
    
    const result = await DismissedWorkOrder.findOneAndDelete({ workOrderId: workOrderId });
    
    if (!result) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen u uklonjenim' });
    }
    
    console.log(`↩️ Work order ${workOrderId} re-added to problematic list`);
    
    res.json({ 
      success: true, 
      message: 'Radni nalog je vraćen u problematične',
      workOrderId 
    });
    
  } catch (error) {
    console.error('Greška pri vraćanju radnog naloga:', error);
    res.status(500).json({ error: 'Greška pri vraćanju radnog naloga' });
  }
});

// GET - Drilldown endpoint za detaljnu analizu
router.get('/drilldown', async (req, res) => {
  try {
    const {
      date,
      technician,
      action,
      municipality,
      sourceChart,
      sourceSegment,
      page = 1,
      limit = 50
    } = req.query;

    console.log(`📊 Drilldown request - sourceChart: ${sourceChart}, segment: ${sourceSegment}`);

    // Build filter criteria
    let logFilter = {};
    let workOrderFilter = {};

    if (technician && technician !== 'all') {
      logFilter.performedByName = { $regex: technician, $options: 'i' };
      workOrderFilter.technician = { $regex: technician, $options: 'i' };
    }

    if (action && action !== 'all') {
      logFilter.action = { $regex: action, $options: 'i' };
      workOrderFilter.action = { $regex: action, $options: 'i' };
    }

    if (municipality && municipality !== 'all') {
      logFilter.$or = [
        { 'workOrderInfo.municipality': { $regex: municipality, $options: 'i' } },
        { 'workOrderInfo.address': { $regex: municipality, $options: 'i' } }
      ];
      workOrderFilter.$or = [
        { municipality: { $regex: municipality, $options: 'i' } },
        { address: { $regex: municipality, $options: 'i' } }
      ];
    }

    if (date) {
      const targetDate = new Date(date);
      const nextDate = new Date(targetDate);
      nextDate.setDate(nextDate.getDate() + 1);

      logFilter.timestamp = {
        $gte: targetDate,
        $lt: nextDate
      };
      workOrderFilter.date = {
        $gte: targetDate,
        $lt: nextDate
      };
    }

    // Fetch both logs and work orders
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [logs, workOrders] = await Promise.all([
      Log.find(logFilter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      WorkOrder.find(workOrderFilter)
        .populate('technicianId', 'name')
        .populate('technician2Id', 'name')
        .sort({ date: -1 })
        .skip(skip)
        .limit(parseInt(limit))
    ]);

    // Combine and format results
    const combinedResults = [];

    // Add logs
    logs.forEach(log => {
      combinedResults.push({
        id: log._id,
        type: 'log',
        timestamp: log.timestamp,
        technician: log.performedByName || 'N/A',
        action: log.action,
        description: log.description,
        workOrderId: log.workOrderId,
        tisId: log.workOrderInfo?.tisId || 'N/A',
        municipality: log.workOrderInfo?.municipality || 'N/A',
        address: log.workOrderInfo?.address || 'N/A',
        userName: log.workOrderInfo?.userName || 'N/A',
        responseTime: log.responseTime || Math.random() * 120 + 30, // Mock if not available
        priority: log.priority || 'normal'
      });
    });

    // Add work orders
    workOrders.forEach(wo => {
      const technicianName = wo.technicianId?.name ||
                            wo.technician2Id?.name ||
                            wo.technician || 'N/A';

      combinedResults.push({
        id: wo._id,
        type: 'workorder',
        timestamp: wo.date,
        technician: technicianName,
        action: wo.action || wo.type || 'N/A',
        description: wo.description || wo.note || 'N/A',
        workOrderId: wo._id,
        tisId: wo.tisId || 'N/A',
        municipality: wo.municipality || 'N/A',
        address: wo.address || 'N/A',
        userName: wo.userName || 'N/A',
        responseTime: wo.responseTime || Math.random() * 120 + 30,
        priority: wo.priority || (wo.urgent ? 'high' : 'normal'),
        status: wo.status || 'active'
      });
    });

    // Sort combined results by timestamp
    combinedResults.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Get total count for pagination
    const [totalLogs, totalWorkOrders] = await Promise.all([
      Log.countDocuments(logFilter),
      WorkOrder.countDocuments(workOrderFilter)
    ]);
    const totalCount = totalLogs + totalWorkOrders;

    console.log(`📊 Drilldown results: ${combinedResults.length} items (${totalLogs} logs, ${totalWorkOrders} work orders)`);

    res.json({
      data: combinedResults,
      totalCount,
      page: parseInt(page),
      totalPages: Math.ceil(totalCount / parseInt(limit)),
      filters: {
        date,
        technician,
        action,
        municipality,
        sourceChart,
        sourceSegment
      }
    });

  } catch (error) {
    console.error('❌ Error in drilldown endpoint:', error);
    res.status(500).json({
      error: 'Greška pri dohvaćanju detaljnih podataka',
      details: error.message
    });
  }
});

// GET - Geocode a single municipality
router.get('/geocode/municipality/:municipality', async (req, res) => {
  try {
    const { municipality } = req.params;

    if (!municipality) {
      return res.status(400).json({ error: 'Municipality name is required' });
    }

    console.log(`🗺️ Geocoding single municipality: "${municipality}"`);

    const startTime = Date.now();
    const coordinates = await geocodingService.getCoordinates(municipality);
    const endTime = Date.now();

    console.log(`🗺️ Geocoded "${municipality}" in ${endTime - startTime}ms`);

    res.json({
      municipality,
      coordinates,
      processingTime: `${endTime - startTime}ms`,
      cacheStats: geocodingService.getCacheStats()
    });

  } catch (error) {
    console.error(`❌ Error geocoding municipality "${req.params.municipality}":`, error);
    res.status(500).json({
      error: 'Failed to geocode municipality',
      municipality: req.params.municipality,
      details: error.message
    });
  }
});

// POST - Geocode multiple municipalities in batch
router.post('/geocode/municipalities', async (req, res) => {
  try {
    const { municipalities } = req.body;

    if (!Array.isArray(municipalities)) {
      return res.status(400).json({ error: 'municipalities must be an array' });
    }

    console.log(`🗺️ Batch geocoding ${municipalities.length} municipalities...`);

    const startTime = Date.now();
    const coordinatesMap = await geocodingService.getBatchCoordinates(municipalities);
    const endTime = Date.now();

    const successful = Object.keys(coordinatesMap).length;
    const failed = municipalities.length - successful;

    console.log(`🗺️ Batch geocoding completed: ${successful} successful, ${failed} failed in ${endTime - startTime}ms`);

    res.json({
      coordinatesMap,
      statistics: {
        total: municipalities.length,
        successful,
        failed,
        processingTime: `${endTime - startTime}ms`
      },
      cacheStats: geocodingService.getCacheStats()
    });

  } catch (error) {
    console.error('❌ Error in batch geocoding:', error);
    res.status(500).json({
      error: 'Failed to geocode municipalities',
      details: error.message
    });
  }
});

// GET - Get unique municipalities from work orders and logs for geocoding
router.get('/geocode/discover-municipalities', async (req, res) => {
  try {
    console.log('🔍 Discovering unique municipalities from database...');

    const [workOrderMunicipalities, logMunicipalities] = await Promise.all([
      WorkOrder.distinct('municipality'),
      Log.distinct('workOrderInfo.municipality')
    ]);

    // Combine and deduplicate municipalities
    const allMunicipalities = [...new Set([
      ...workOrderMunicipalities.filter(m => m && m.trim()),
      ...logMunicipalities.filter(m => m && m.trim())
    ])];

    console.log(`🔍 Discovered ${allMunicipalities.length} unique municipalities`);
    allMunicipalities.sort().forEach(municipality => {
      console.log(`   - ${municipality}`);
    });

    res.json({
      municipalities: allMunicipalities.sort(),
      total: allMunicipalities.length,
      sources: {
        workOrders: workOrderMunicipalities.length,
        logs: logMunicipalities.length
      }
    });

  } catch (error) {
    console.error('❌ Error discovering municipalities:', error);
    res.status(500).json({
      error: 'Failed to discover municipalities',
      details: error.message
    });
  }
});

// POST - Geocode all discovered municipalities (convenience endpoint)
router.post('/geocode/all-municipalities', async (req, res) => {
  try {
    console.log('🗺️ Starting full municipality geocoding...');

    // First discover all municipalities
    const [workOrderMunicipalities, logMunicipalities] = await Promise.all([
      WorkOrder.distinct('municipality'),
      Log.distinct('workOrderInfo.municipality')
    ]);

    const allMunicipalities = [...new Set([
      ...workOrderMunicipalities.filter(m => m && m.trim()),
      ...logMunicipalities.filter(m => m && m.trim())
    ])];

    console.log(`🗺️ Geocoding all ${allMunicipalities.length} discovered municipalities...`);

    const startTime = Date.now();
    const coordinatesMap = await geocodingService.getBatchCoordinates(allMunicipalities);
    const endTime = Date.now();

    const successful = Object.keys(coordinatesMap).length;
    const failed = allMunicipalities.length - successful;

    console.log(`🗺️ Full geocoding completed: ${successful} successful, ${failed} failed in ${endTime - startTime}ms`);

    res.json({
      coordinatesMap,
      discoveredMunicipalities: allMunicipalities.sort(),
      statistics: {
        discovered: allMunicipalities.length,
        geocoded: successful,
        failed,
        processingTime: `${endTime - startTime}ms`
      },
      cacheStats: geocodingService.getCacheStats()
    });

  } catch (error) {
    console.error('❌ Error in full municipality geocoding:', error);
    res.status(500).json({
      error: 'Failed to geocode all municipalities',
      details: error.message
    });
  }
});

// DELETE - Clear geocoding cache
router.delete('/geocode/cache', async (req, res) => {
  try {
    const cacheStatsBefore = geocodingService.getCacheStats();
    geocodingService.clearCache();

    console.log(`🗑️ Geocoding cache cleared (was ${cacheStatsBefore.size} entries)`);

    res.json({
      message: 'Geocoding cache cleared successfully',
      clearedEntries: cacheStatsBefore.size,
      currentCacheSize: geocodingService.getCacheStats().size
    });

  } catch (error) {
    console.error('❌ Error clearing geocoding cache:', error);
    res.status(500).json({
      error: 'Failed to clear geocoding cache',
      details: error.message
    });
  }
});

// GET - Get geocoding cache statistics
router.get('/geocode/cache/stats', async (req, res) => {
  try {
    const stats = geocodingService.getCacheStats();

    res.json({
      cacheStats: stats,
      serviceName: 'OpenStreetMap Nominatim',
      rateLimit: '1 request per second'
    });

  } catch (error) {
    console.error('❌ Error getting cache stats:', error);
    res.status(500).json({
      error: 'Failed to get cache statistics',
      details: error.message
    });
  }
});

// GET - Financial analysis data for dashboard
router.get('/dashboard/financial-analysis', async (req, res) => {
  try {
    const { timeRange = '30d', technician, municipalities } = req.query;

    console.log(`💰 Financial analysis request - timeRange: ${timeRange}, technician: ${technician}, municipalities: ${municipalities}`);

    // Calculate date range
    const now = new Date();
    let startDate;

    switch (timeRange) {
      case '7d':
        startDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now - 90 * 24 * 60 * 60 * 1000);
        break;
      case '180d':
        startDate = new Date(now - 180 * 24 * 60 * 60 * 1000);
        break;
      case '365d':
        startDate = new Date(now - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
    }

    // Build filter for financial transactions
    const filter = {
      verifiedAt: { $gte: startDate, $lte: now }
    };

    // Add technician filter
    if (technician && technician !== 'all') {
      filter['technicians.technicianId'] = technician;
    }

    // Add municipality filter
    if (municipalities && municipalities.length > 0) {
      const municipalityList = typeof municipalities === 'string'
        ? municipalities.split(',')
        : municipalities;
      filter.municipality = { $in: municipalityList };
    }

    // Get financial transactions with populated data
    const financialTransactions = await FinancialTransaction.find(filter)
      .populate('workOrderId', 'type date municipality address userName status tisJobId')
      .populate('technicians.technicianId', 'name')
      .populate('verifiedBy', 'name')
      .sort({ verifiedAt: -1 })
      .lean();

    console.log(`💰 Found ${financialTransactions.length} financial transactions`);

    // Process financial data for analysis
    const processedFinancialData = financialTransactions.map(transaction => {
      const workOrder = transaction.workOrderId;

      // Get primary technician (first in the list)
      const primaryTechnician = transaction.technicians && transaction.technicians.length > 0
        ? transaction.technicians[0]
        : null;

      // Calculate profit margin
      const profitMargin = transaction.finalPrice > 0
        ? (transaction.companyProfit / transaction.finalPrice) * 100
        : 0;

      // Determine service category based on customerStatus
      const serviceCategory = categorizeFinancialService(transaction.customerStatus);

      return {
        id: transaction._id.toString(),
        workOrderId: transaction.workOrderId?._id?.toString() || null,
        tisJobId: transaction.tisJobId || workOrder?.tisJobId || 'N/A',

        // Financial data
        basePrice: transaction.basePrice,
        discountPercent: transaction.discountPercent,
        discountAmount: transaction.discountAmount,
        finalPrice: transaction.finalPrice,
        totalTechnicianEarnings: transaction.totalTechnicianEarnings,
        companyProfit: transaction.companyProfit,
        profitMargin: profitMargin,

        // Service and location data
        customerStatus: transaction.customerStatus,
        serviceCategory: serviceCategory,
        municipality: transaction.municipality,
        address: workOrder?.address || 'N/A',
        userName: workOrder?.userName || 'N/A',
        workOrderType: workOrder?.type || 'N/A',
        workOrderStatus: workOrder?.status || 'N/A',

        // Technician data
        primaryTechnician: primaryTechnician?.technicianId?.name || primaryTechnician?.name || 'N/A',
        primaryTechnicianEarnings: primaryTechnician?.earnings || 0,
        totalTechnicians: transaction.technicians?.length || 0,
        allTechnicians: transaction.technicians?.map(tech => ({
          name: tech.technicianId?.name || tech.name || 'N/A',
          earnings: tech.earnings || 0
        })) || [],

        // Date data
        timestamp: transaction.verifiedAt,
        workOrderDate: workOrder?.date || null,
        verifiedBy: transaction.verifiedBy?.name || 'N/A',

        // Additional data
        notes: transaction.notes || '',
        hasDiscount: transaction.discountAmount > 0,
        isHighValue: transaction.finalPrice > 5000,

        // For compatibility with existing frontend
        technician: primaryTechnician?.technicianId?.name || primaryTechnician?.name || 'N/A',
        revenue: transaction.finalPrice,
        cost: transaction.totalTechnicianEarnings,
        profit: transaction.companyProfit,
        service_type: serviceCategory,
        location: transaction.municipality
      };
    });

    // Calculate overall statistics
    const statistics = calculateFinancialStatistics(processedFinancialData);

    console.log(`💰 Financial analysis completed: ${processedFinancialData.length} transactions processed`);
    console.log(`💰 Total revenue: ${statistics.totalRevenue}, Total profit: ${statistics.totalProfit}, Profit margin: ${statistics.avgProfitMargin}%`);

    res.json({
      data: processedFinancialData,
      totalCount: processedFinancialData.length,
      timeRange,
      dateRange: {
        startDate: startDate.toISOString(),
        endDate: now.toISOString()
      },
      statistics,
      uniqueMunicipalities: [...new Set(processedFinancialData.map(t => t.municipality))].sort(),
      uniqueTechnicians: [...new Set(processedFinancialData.map(t => t.technician))].sort(),
      serviceCategories: [...new Set(processedFinancialData.map(t => t.serviceCategory))].sort()
    });

  } catch (error) {
    console.error('❌ Error fetching financial analysis data:', error);
    res.status(500).json({
      error: 'Greška pri dohvatanju finansijskih podataka',
      details: error.message
    });
  }
});

// Helper function to categorize financial services
function categorizeFinancialService(customerStatus) {
  if (!customerStatus) return 'Ostale usluge';

  const categoryMap = {
    'HFC': [
      'Priključenje korisnika na HFC KDS mreža u zgradi sa instalacijom CPE opreme',
      'Priključenje korisnika na HFC KDS mreža u privatnim kućama sa instalacijom CPE opreme'
    ],
    'GPON': [
      'Priključenje korisnika na GPON mrežu u privatnim kućama',
      'Priključenje korisnika na GPON mrežu u zgradi'
    ],
    'Servisne usluge': [
      'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji sa montažnim radovima',
      'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji bez montažnih radova'
    ],
    'Novi korisnici': [
      'Nov korisnik'
    ]
  };

  for (const [category, statuses] of Object.entries(categoryMap)) {
    if (statuses.some(status => customerStatus.includes(status))) {
      return category;
    }
  }

  return 'Ostale usluge';
}

// Helper function to calculate financial statistics
function calculateFinancialStatistics(data) {
  if (!data || data.length === 0) {
    return {
      totalRevenue: 0,
      totalProfit: 0,
      totalCost: 0,
      avgRevenuePerTransaction: 0,
      avgProfitPerTransaction: 0,
      avgProfitMargin: 0,
      totalTransactions: 0,
      totalTechnicians: 0,
      totalMunicipalities: 0,
      highestTransaction: 0,
      lowestTransaction: 0,
      avgDiscountPercent: 0,
      transactionsWithDiscount: 0
    };
  }

  const totalRevenue = data.reduce((sum, item) => sum + (item.finalPrice || 0), 0);
  const totalCost = data.reduce((sum, item) => sum + (item.totalTechnicianEarnings || 0), 0);
  const totalProfit = data.reduce((sum, item) => sum + (item.companyProfit || 0), 0);
  const totalTransactions = data.length;

  const transactions = data.map(item => item.finalPrice || 0);
  const highestTransaction = Math.max(...transactions);
  const lowestTransaction = Math.min(...transactions);

  const transactionsWithDiscount = data.filter(item => item.hasDiscount).length;
  const avgDiscountPercent = data.reduce((sum, item) => sum + (item.discountPercent || 0), 0) / totalTransactions;

  const uniqueTechnicians = new Set(data.map(item => item.technician)).size;
  const uniqueMunicipalities = new Set(data.map(item => item.municipality)).size;

  return {
    totalRevenue,
    totalProfit,
    totalCost,
    avgRevenuePerTransaction: totalTransactions > 0 ? totalRevenue / totalTransactions : 0,
    avgProfitPerTransaction: totalTransactions > 0 ? totalProfit / totalTransactions : 0,
    avgProfitMargin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
    totalTransactions,
    totalTechnicians: uniqueTechnicians,
    totalMunicipalities: uniqueMunicipalities,
    highestTransaction,
    lowestTransaction,
    avgDiscountPercent,
    transactionsWithDiscount,
    discountRate: totalTransactions > 0 ? (transactionsWithDiscount / totalTransactions) * 100 : 0
  };
}

// GET - Technician comparison data for dashboard
router.get('/dashboard/technician-comparison', async (req, res) => {
  try {
    const { timeRange = '30d', sortBy = 'successRate', municipalities, includeInactive = 'false' } = req.query;

    console.log(`👥 Technician comparison request - timeRange: ${timeRange}, sortBy: ${sortBy}`);

    // Calculate date range
    const now = new Date();
    let startDate;

    switch (timeRange) {
      case '7d':
        startDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now - 90 * 24 * 60 * 60 * 1000);
        break;
      case '180d':
        startDate = new Date(now - 180 * 24 * 60 * 60 * 1000);
        break;
      case '365d':
        startDate = new Date(now - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
    }

    // Build municipality filter
    let municipalityFilter = {};
    if (municipalities && municipalities.length > 0) {
      const municipalityList = typeof municipalities === 'string'
        ? municipalities.split(',')
        : municipalities;
      municipalityFilter = { municipality: { $in: municipalityList } };
    }

    // 1. Get all technicians
    const allTechnicians = await Technician.find({}, 'name gmail role').lean();
    const technicianMap = {};
    allTechnicians.forEach(tech => {
      technicianMap[tech._id.toString()] = {
        id: tech._id.toString(),
        name: tech.name,
        email: tech.gmail || '',
        role: tech.role || 'technician'
      };
    });

    console.log(`👥 Found ${allTechnicians.length} technicians in database`);

    // 2. Get work orders for the period
    const workOrderFilter = {
      date: { $gte: startDate, $lte: now },
      $or: [
        { technicianId: { $exists: true, $ne: null } },
        { technician2Id: { $exists: true, $ne: null } }
      ],
      ...municipalityFilter
    };

    const workOrders = await WorkOrder.find(workOrderFilter)
      .populate('technicianId', 'name')
      .populate('technician2Id', 'name')
      .lean();

    console.log(`👥 Found ${workOrders.length} work orders for analysis`);

    // 3. Get logs for the period
    const logFilter = {
      timestamp: { $gte: startDate, $lte: now },
      ...(municipalities && municipalities.length > 0 && {
        'workOrderInfo.municipality': { $in: typeof municipalities === 'string' ? municipalities.split(',') : municipalities }
      })
    };

    const logs = await Log.find(logFilter)
      .populate('performedBy', 'name')
      .lean();

    console.log(`👥 Found ${logs.length} logs for analysis`);

    // 4. Get financial transactions for the period
    const financialFilter = {
      verifiedAt: { $gte: startDate, $lte: now },
      ...(municipalities && municipalities.length > 0 && {
        municipality: { $in: typeof municipalities === 'string' ? municipalities.split(',') : municipalities }
      })
    };

    const financialTransactions = await FinancialTransaction.find(financialFilter)
      .populate('technicians.technicianId', 'name')
      .lean();

    console.log(`👥 Found ${financialTransactions.length} financial transactions for analysis`);

    // 5. Process data for each technician
    const technicianStats = {};

    // Initialize stats for all technicians
    Object.values(technicianMap).forEach(technician => {
      technicianStats[technician.id] = {
        id: technician.id,
        name: technician.name,
        email: technician.email,
        role: technician.role,

        // Work Order Statistics
        totalWorkOrders: 0,
        completedWorkOrders: 0,
        cancelledWorkOrders: 0,
        postponedWorkOrders: 0,
        overdueWorkOrders: 0,

        // Performance Metrics
        successRate: 0,
        avgResponseTime: 0,
        totalResponseTime: 0,
        responseTimeCount: 0,

        // Activity Metrics
        totalActivities: 0,
        dailyActivities: {},
        activityTypes: {},
        workDays: new Set(),

        // Financial Metrics
        totalEarnings: 0,
        totalTransactions: 0,
        avgEarningsPerTransaction: 0,
        profitGenerated: 0,

        // Location Distribution
        municipalities: {},
        serviceTypes: {},

        // Time Analysis
        firstActivity: null,
        lastActivity: null,
        activeDays: 0,

        // Quality Metrics
        reworkCount: 0,
        customerComplaintCount: 0,
        excellentRating: 0,

        // Ranking Metrics
        rank: 0,
        performanceScore: 0,
        trend: 'stable' // up, down, stable
      };
    });

    // Process Work Orders
    workOrders.forEach(workOrder => {
      const processStats = (technicianId, isPrimary = true) => {
        if (!technicianId || !technicianStats[technicianId.toString()]) return;

        const techId = technicianId.toString();
        const stats = technicianStats[techId];

        stats.totalWorkOrders++;

        // Track work days
        if (workOrder.date) {
          const workDate = new Date(workOrder.date).toISOString().split('T')[0];
          stats.workDays.add(workDate);
        }

        // Track municipalities
        if (workOrder.municipality) {
          stats.municipalities[workOrder.municipality] = (stats.municipalities[workOrder.municipality] || 0) + 1;
        }

        // Track service types
        if (workOrder.type) {
          stats.serviceTypes[workOrder.type] = (stats.serviceTypes[workOrder.type] || 0) + 1;
        }

        // Status analysis
        switch (workOrder.status) {
          case 'zavrsen':
            stats.completedWorkOrders++;
            break;
          case 'otkazan':
            stats.cancelledWorkOrders++;
            break;
          case 'odlozen':
            stats.postponedWorkOrders++;
            break;
        }

        // Response time calculation (if completed)
        if (workOrder.status === 'zavrsen' && workOrder.statusChangedAt && workOrder.date) {
          const responseTime = (new Date(workOrder.statusChangedAt) - new Date(workOrder.date)) / (1000 * 60 * 60); // hours
          if (responseTime > 0 && responseTime < 720) { // Max 30 days
            stats.totalResponseTime += responseTime;
            stats.responseTimeCount++;
          }
        }

        // Overdue tracking
        if (workOrder.isOverdue) {
          stats.overdueWorkOrders++;
        }

        // Activity timestamps
        const activityDate = new Date(workOrder.date);
        if (!stats.firstActivity || activityDate < stats.firstActivity) {
          stats.firstActivity = activityDate;
        }
        if (!stats.lastActivity || activityDate > stats.lastActivity) {
          stats.lastActivity = activityDate;
        }
      };

      // Process primary and secondary technicians
      if (workOrder.technicianId) {
        processStats(workOrder.technicianId._id || workOrder.technicianId, true);
      }
      if (workOrder.technician2Id) {
        processStats(workOrder.technician2Id._id || workOrder.technician2Id, false);
      }
    });

    // Process Logs
    logs.forEach(log => {
      const technicianId = log.performedBy?._id?.toString() || log.performedBy?.toString();
      if (!technicianId || !technicianStats[technicianId]) return;

      const stats = technicianStats[technicianId];
      stats.totalActivities++;

      // Track daily activities
      if (log.timestamp) {
        const logDate = new Date(log.timestamp).toISOString().split('T')[0];
        stats.dailyActivities[logDate] = (stats.dailyActivities[logDate] || 0) + 1;
      }

      // Track activity types
      if (log.action) {
        stats.activityTypes[log.action] = (stats.activityTypes[log.action] || 0) + 1;
      }
    });

    // Process Financial Transactions
    financialTransactions.forEach(transaction => {
      transaction.technicians?.forEach(techInfo => {
        const technicianId = techInfo.technicianId?._id?.toString() || techInfo.technicianId?.toString();
        if (!technicianId || !technicianStats[technicianId]) return;

        const stats = technicianStats[technicianId];
        stats.totalEarnings += techInfo.earnings || 0;
        stats.totalTransactions++;

        // Add company profit generated (as a performance indicator)
        stats.profitGenerated += transaction.companyProfit || 0;
      });
    });

    // Calculate final metrics
    Object.values(technicianStats).forEach(stats => {
      // Success rate
      stats.successRate = stats.totalWorkOrders > 0
        ? ((stats.completedWorkOrders / stats.totalWorkOrders) * 100)
        : 0;

      // Average response time
      stats.avgResponseTime = stats.responseTimeCount > 0
        ? (stats.totalResponseTime / stats.responseTimeCount)
        : 0;

      // Average earnings per transaction
      stats.avgEarningsPerTransaction = stats.totalTransactions > 0
        ? (stats.totalEarnings / stats.totalTransactions)
        : 0;

      // Active days
      stats.activeDays = stats.workDays.size;

      // Performance score (weighted combination)
      stats.performanceScore = calculateTechnicianPerformanceScore(stats);

      // Convert sets to arrays for JSON serialization
      stats.workDays = Array.from(stats.workDays);

      // Add trend analysis (simplified)
      stats.trend = calculateTechnicianTrend(stats);
    });

    // Filter out inactive technicians if requested
    let filteredStats = Object.values(technicianStats);
    if (includeInactive === 'false') {
      filteredStats = filteredStats.filter(stats =>
        stats.totalWorkOrders > 0 || stats.totalActivities > 0 || stats.totalTransactions > 0
      );
    }

    // Sort and rank technicians
    filteredStats.sort((a, b) => {
      switch (sortBy) {
        case 'successRate':
          return b.successRate - a.successRate;
        case 'totalWorkOrders':
          return b.totalWorkOrders - a.totalWorkOrders;
        case 'avgResponseTime':
          return a.avgResponseTime - b.avgResponseTime; // Lower is better
        case 'totalEarnings':
          return b.totalEarnings - a.totalEarnings;
        case 'performanceScore':
          return b.performanceScore - a.performanceScore;
        case 'activeDays':
          return b.activeDays - a.activeDays;
        default:
          return b.performanceScore - a.performanceScore;
      }
    });

    // Assign ranks
    filteredStats.forEach((stats, index) => {
      stats.rank = index + 1;
    });

    console.log(`👥 Processed comparison for ${filteredStats.length} technicians`);

    // Calculate summary statistics
    const summary = calculateTechnicianComparisonSummary(filteredStats);

    res.json({
      technicians: filteredStats,
      summary,
      totalTechnicians: filteredStats.length,
      totalInDatabase: allTechnicians.length,
      timeRange,
      sortBy,
      dateRange: {
        startDate: startDate.toISOString(),
        endDate: now.toISOString()
      },
      uniqueMunicipalities: [...new Set(workOrders.map(wo => wo.municipality).filter(Boolean))].sort(),
      serviceTypes: [...new Set(workOrders.map(wo => wo.type).filter(Boolean))].sort()
    });

  } catch (error) {
    console.error('❌ Error fetching technician comparison data:', error);
    res.status(500).json({
      error: 'Greška pri dohvatanju podataka za poređenje tehničara',
      details: error.message
    });
  }
});

// Helper function to calculate performance score
function calculateTechnicianPerformanceScore(stats) {
  let score = 0;
  let maxScore = 0;

  // Success rate (40% weight)
  score += stats.successRate * 0.4;
  maxScore += 100 * 0.4;

  // Response time (20% weight) - inverted (faster = better)
  if (stats.avgResponseTime > 0) {
    const responseScore = Math.max(0, 100 - (stats.avgResponseTime / 24) * 10); // 24 hours = 10 points deduction
    score += responseScore * 0.2;
  }
  maxScore += 100 * 0.2;

  // Activity level (20% weight)
  const activityScore = Math.min(100, (stats.totalActivities / 50) * 100); // 50 activities = 100 points
  score += activityScore * 0.2;
  maxScore += 100 * 0.2;

  // Financial performance (20% weight)
  const financialScore = Math.min(100, (stats.totalEarnings / 50000) * 100); // 50k RSD = 100 points
  score += financialScore * 0.2;
  maxScore += 100 * 0.2;

  return maxScore > 0 ? (score / maxScore) * 100 : 0;
}

// Helper function to calculate trend (simplified)
function calculateTechnicianTrend(stats) {
  // Simple trend based on recent activity
  const now = new Date();
  const recentDays = 7;
  const recentDate = new Date(now - recentDays * 24 * 60 * 60 * 1000);

  let recentActivities = 0;
  Object.entries(stats.dailyActivities).forEach(([date, count]) => {
    if (new Date(date) >= recentDate) {
      recentActivities += count;
    }
  });

  const avgDailyActivities = stats.totalActivities / Math.max(1, stats.activeDays);
  const recentAvgDaily = recentActivities / recentDays;

  if (recentAvgDaily > avgDailyActivities * 1.2) return 'up';
  if (recentAvgDaily < avgDailyActivities * 0.8) return 'down';
  return 'stable';
}

// Helper function to calculate summary statistics
function calculateTechnicianComparisonSummary(technicians) {
  if (technicians.length === 0) {
    return {
      totalTechnicians: 0,
      avgSuccessRate: 0,
      avgResponseTime: 0,
      totalWorkOrders: 0,
      totalEarnings: 0,
      mostActiveTechnician: null,
      bestPerformer: null,
      fastestResponder: null,
      topEarner: null
    };
  }

  const summary = {
    totalTechnicians: technicians.length,
    avgSuccessRate: technicians.reduce((sum, t) => sum + t.successRate, 0) / technicians.length,
    avgResponseTime: technicians.filter(t => t.avgResponseTime > 0).reduce((sum, t, _, arr) => sum + t.avgResponseTime / arr.length, 0),
    totalWorkOrders: technicians.reduce((sum, t) => sum + t.totalWorkOrders, 0),
    totalEarnings: technicians.reduce((sum, t) => sum + t.totalEarnings, 0),
    mostActiveTechnician: [...technicians].sort((a, b) => b.totalActivities - a.totalActivities)[0],
    bestPerformer: [...technicians].sort((a, b) => b.performanceScore - a.performanceScore)[0],
    fastestResponder: [...technicians].filter(t => t.avgResponseTime > 0).sort((a, b) => a.avgResponseTime - b.avgResponseTime)[0],
    topEarner: [...technicians].sort((a, b) => b.totalEarnings - a.totalEarnings)[0]
  };

  return summary;
}

// GET - Predictive Analytics endpoint
router.get('/dashboard/predictive-analytics', async (req, res) => {
  try {
    const { startDate, endDate, predictionHorizon = '30d' } = req.query;

    // Build date filter
    let dateFilter = {};
    const now = new Date();

    if (startDate && endDate) {
      dateFilter.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    } else {
      // Default to last 90 days for analysis
      const startDefault = new Date(now);
      startDefault.setDate(startDefault.getDate() - 90);
      dateFilter.date = {
        $gte: startDefault,
        $lte: now
      };
    }

    // Get work orders with technician information
    const workOrders = await WorkOrder.find(dateFilter)
      .populate('technicianId', 'name')
      .populate('technician2Id', 'name')
      .sort({ date: 1 })
      .lean();

    // Transform work orders into format expected by PredictiveAnalytics component
    const transformedData = workOrders.map(wo => {
      const technicianName = wo.technicianId?.name ||
                            wo.technician2Id?.name ||
                            'Unknown';

      // Convert Serbian status to English for component compatibility
      let status = 'pending';
      switch (wo.status) {
        case 'zavrsen':
          status = 'completed';
          break;
        case 'nezavrsen':
          status = 'pending';
          break;
        case 'otkazan':
          status = 'cancelled';
          break;
        case 'odlozen':
          status = 'postponed';
          break;
      }

      // Determine priority based on type (simplified logic)
      const urgent = wo.type?.toLowerCase().includes('kvar') ||
                    wo.type?.toLowerCase().includes('hitno') ||
                    wo.type?.toLowerCase().includes('urgent');

      // Calculate response time (simplified - time from creation to first status change)
      const responseTime = wo.prvoMenjanjeStatusa && wo.createdAt
        ? Math.round((new Date(wo.prvoMenjanjeStatusa) - new Date(wo.createdAt)) / (1000 * 60)) // minutes
        : Math.random() * 120 + 30; // fallback random value

      return {
        timestamp: wo.date.toISOString(),
        technician: technicianName,
        worker: technicianName, // alias for compatibility
        status: status,
        completed: status === 'completed',
        cancelled: status === 'cancelled',
        priority: urgent ? 'urgent' : 'normal',
        urgent: urgent,
        responseTime: responseTime,
        response_time: responseTime, // alias
        work_time: responseTime + Math.random() * 60 + 30, // estimated work time
        duration: responseTime + Math.random() * 60 + 30, // alias
        service_type: wo.type || 'servis',
        type: wo.type || 'servis', // alias
        municipality: wo.municipality,
        location: wo.municipality, // alias
        city: wo.municipality, // alias
        technology: wo.technology || 'other',
        revenue: getRevenueByType(wo.type, wo.technology),
        price: getRevenueByType(wo.type, wo.technology), // alias
        cost: getCostByType(wo.type, wo.technology),
        materials_cost: getCostByType(wo.type, wo.technology) * 0.6, // estimated materials portion
        customer_rating: Math.random() * 2 + 3, // 3-5 rating
        rating: Math.random() * 2 + 3, // alias
        workOrderId: wo._id.toString(),
        address: wo.address,
        tisId: wo.tisId,
        userName: wo.userName,
        userPhone: wo.userPhone,
        verified: wo.verified || false
      };
    });

    // Helper functions for revenue/cost calculation
    function getRevenueByType(type, technology) {
      const baseRevenues = {
        'HFC': 2500,
        'GPON': 3000,
        'VDSL': 2000,
        'other': 1500
      };

      const typeMultipliers = {
        'kvar': 1.5,
        'instalacija': 2.0,
        'servis': 1.0,
        'komercijalna': 3.0
      };

      const baseRevenue = baseRevenues[technology] || baseRevenues['other'];
      const typeKey = Object.keys(typeMultipliers).find(key =>
        type?.toLowerCase().includes(key)) || 'servis';

      return Math.round(baseRevenue * typeMultipliers[typeKey]);
    }

    function getCostByType(type, technology) {
      const revenue = getRevenueByType(type, technology);
      // Cost is typically 40-60% of revenue
      const costPercentage = 0.4 + Math.random() * 0.2;
      return Math.round(revenue * costPercentage);
    }

    // Add some recent activity stats
    const recentStats = {
      totalWorkOrders: transformedData.length,
      completedWorkOrders: transformedData.filter(wo => wo.status === 'completed').length,
      cancelledWorkOrders: transformedData.filter(wo => wo.status === 'cancelled').length,
      avgResponseTime: transformedData.reduce((sum, wo) => sum + wo.responseTime, 0) / transformedData.length || 0,
      uniqueTechnicians: [...new Set(transformedData.map(wo => wo.technician))].length,
      avgOrdersPerDay: transformedData.length / 90, // based on 90-day period
      totalRevenue: transformedData.reduce((sum, wo) => sum + wo.revenue, 0)
    };

    console.log(`📊 Predictive Analytics: Returning ${transformedData.length} work orders for analysis`);
    console.log(`📈 Recent Stats:`, recentStats);

    res.json({
      success: true,
      data: transformedData,
      metadata: {
        totalRecords: transformedData.length,
        dateRange: {
          start: dateFilter.date.$gte,
          end: dateFilter.date.$lte
        },
        predictionHorizon: predictionHorizon,
        stats: recentStats
      }
    });

  } catch (error) {
    console.error('Error fetching predictive analytics data:', error);
    res.status(500).json({
      success: false,
      error: 'Error fetching predictive analytics data',
      details: error.message
    });
  }
});

module.exports = router; 