const express = require('express');
const router = express.Router();
const { Log, Technician, WorkOrder } = require('../models');
const mongoose = require('mongoose');
const fetch = require('node-fetch');

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
    
    // Problematic work orders (postponed/cancelled)
    const problematicWorkOrders = await Log.aggregate([
      { 
        $match: { 
          ...filter, 
          action: { $in: ['workorder_postponed', 'workorder_cancelled'] }
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
  console.log(`🗑️ Clearing geocode cache (${geocodeCache.size} entries)`);
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

module.exports = router; 