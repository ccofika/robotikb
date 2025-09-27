// OPTIMIZED DASHBOARD ENDPOINTS FOR LOGS
// This contains optimized versions of all 5 dashboard endpoints with:
// 1. Cache system (5-minute TTL)
// 2. statsOnly parameter support
// 3. MongoDB aggregation pipelines
// 4. Performance logging
// 5. Lean queries

const mongoose = require('mongoose');
const { WorkOrder, Technician, Log, FinancialTransaction } = require('../models');

// Dashboard cache system - 5 minute TTL for performance
let dashboardCache = {
  cancellation: null,
  hourly: null,
  map: null,
  financial: null,
  technician: null
};
let dashboardCacheTime = {
  cancellation: 0,
  hourly: 0,
  map: 0,
  financial: 0,
  technician: 0
};
const DASHBOARD_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Function to invalidate dashboard cache
const invalidateDashboardStats = () => {
  console.log('🗑️ Invalidating dashboard cache due to data change');
  dashboardCache = {
    cancellation: null,
    hourly: null,
    map: null,
    financial: null,
    technician: null
  };
  dashboardCacheTime = {
    cancellation: 0,
    hourly: 0,
    map: 0,
    financial: 0,
    technician: 0
  };
};

// Helper function to categorize cancellation reasons
function categorizeCancellationReason(comment) {
  if (!comment || comment === 'Nespecifikovano') return 'Ostali razlozi';

  const lowerComment = comment.toLowerCase();

  if (lowerComment.includes('nije kod kuće') || lowerComment.includes('nema kod kuće')) {
    return 'Korisnik nije kod kuće';
  }
  if (lowerComment.includes('adresa') || lowerComment.includes('pogrešna')) {
    return 'Neispravna adresa';
  }
  if (lowerComment.includes('signal') || lowerComment.includes('nema signala')) {
    return 'Tehnički problemi';
  }
  if (lowerComment.includes('otkazao') || lowerComment.includes('ne želi')) {
    return 'Korisnik otkazao';
  }
  if (lowerComment.includes('vreme') || lowerComment.includes('vrijeme')) {
    return 'Neodgovarajuće vreme';
  }

  return 'Ostali razlozi';
}

// GET - Cancellation analysis data for dashboard (OPTIMIZED)
const getCancellationAnalysis = async (req, res) => {
  try {
    const { timeRange = '30d', technician, municipalities, statsOnly } = req.query;

    console.log(`📊 Cancellation analysis request - timeRange: ${timeRange}, technician: ${technician}, statsOnly: ${statsOnly}`);
    const startTime = Date.now();

    // For dashboard stats, return only basic numbers
    if (statsOnly === 'true') {
      const now = new Date();
      const startDate = new Date(now - 30 * 24 * 60 * 60 * 1000); // Default 30d

      const count = await WorkOrder.countDocuments({
        status: 'otkazan',
        statusChangedAt: { $gte: startDate, $lte: now }
      });

      console.log(`📊 Cancellation stats returned in ${Date.now() - startTime}ms`);
      return res.json({ total: count });
    }

    // Create cache key based on parameters
    const cacheKey = `${timeRange}-${technician || 'all'}-${municipalities || 'all'}`;
    const cacheEntry = dashboardCache.cancellation;
    const cacheTime = dashboardCacheTime.cancellation;

    // Return cached data if still valid and same parameters
    if (cacheEntry && cacheEntry.key === cacheKey && (Date.now() - cacheTime) < DASHBOARD_CACHE_TTL) {
      console.log(`📊 Returning cached cancellation analysis (${Date.now() - startTime}ms)`);
      return res.json(cacheEntry.data);
    }

    console.log('📊 Calculating fresh cancellation analysis...');

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

    // Build aggregation pipeline for better performance
    const matchStage = {
      status: 'otkazan',
      statusChangedAt: { $gte: startDate, $lte: now }
    };

    // Add technician filter
    if (technician && technician !== 'all') {
      matchStage.$or = [
        { 'technicianId': new mongoose.Types.ObjectId(technician) },
        { 'technician2Id': new mongoose.Types.ObjectId(technician) }
      ];
    }

    // Add municipality filter
    if (municipalities && municipalities.length > 0) {
      const municipalityList = typeof municipalities === 'string'
        ? municipalities.split(',')
        : municipalities;
      matchStage.municipality = { $in: municipalityList };
    }

    // Use MongoDB aggregation pipeline for better performance
    const cancellationAggregation = await WorkOrder.aggregate([
      { $match: matchStage },
      {
        $lookup: {
          from: 'technicians',
          localField: 'technicianId',
          foreignField: '_id',
          as: 'technician'
        }
      },
      {
        $lookup: {
          from: 'technicians',
          localField: 'technician2Id',
          foreignField: '_id',
          as: 'technician2'
        }
      },
      {
        $project: {
          _id: 1,
          tisJobId: 1,
          municipality: 1,
          address: 1,
          userName: 1,
          type: 1,
          statusChangedAt: 1,
          createdAt: 1,
          date: 1,
          cancelHistory: 1,
          primaryTechnician: {
            $cond: {
              if: { $gt: [{ $size: '$technician' }, 0] },
              then: { $arrayElemAt: ['$technician.name', 0] },
              else: {
                $cond: {
                  if: { $gt: [{ $size: '$technician2' }, 0] },
                  then: { $arrayElemAt: ['$technician2.name', 0] },
                  else: 'Nepoznat tehničar'
                }
              }
            }
          }
        }
      }
    ]);

    // Process cancellation data for analysis
    const cancellationData = cancellationAggregation.map(wo => {
      // Get the most recent cancellation from cancelHistory
      const latestCancellation = wo.cancelHistory && wo.cancelHistory.length > 0
        ? wo.cancelHistory[wo.cancelHistory.length - 1]
        : null;

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
        technician: wo.primaryTechnician,
        timestamp: cancelledAt,
        cancellationReason: cancellationReason,
        cancellationComment: cancellationComment,
        responseTime: responseTime > 0 ? responseTime : 30,
        status: 'cancelled',
        date: wo.date,
        createdAt: createdAt
      };
    });

    const result = {
      data: cancellationData,
      totalCount: cancellationData.length,
      timeRange,
      dateRange: {
        startDate: startDate.toISOString(),
        endDate: now.toISOString()
      }
    };

    // Cache the result
    dashboardCache.cancellation = { key: cacheKey, data: result };
    dashboardCacheTime.cancellation = Date.now();

    const endTime = Date.now();
    console.log(`📊 Cancellation analysis calculated in ${endTime - startTime}ms (cached for ${DASHBOARD_CACHE_TTL/1000}s)`);

    res.json(result);

  } catch (error) {
    console.error('Greška pri dohvatanju analize otkazivanja:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju analize otkazivanja' });
  }
};

// GET - Hourly activity distribution data for dashboard (OPTIMIZED)
const getHourlyActivityDistribution = async (req, res) => {
  try {
    const { timeRange = '30d', technician, municipalities, statsOnly } = req.query;

    console.log(`⏰ Hourly activity request - timeRange: ${timeRange}, technician: ${technician}, statsOnly: ${statsOnly}`);
    const startTime = Date.now();

    // For dashboard stats, return only basic numbers
    if (statsOnly === 'true') {
      const now = new Date();
      const startDate = new Date(now - 30 * 24 * 60 * 60 * 1000); // Default 30d

      const count = await Log.countDocuments({
        timestamp: { $gte: startDate, $lte: now }
      });

      console.log(`⏰ Hourly stats returned in ${Date.now() - startTime}ms`);
      return res.json({ total: count });
    }

    // Create cache key based on parameters
    const cacheKey = `${timeRange}-${technician || 'all'}-${municipalities || 'all'}`;
    const cacheEntry = dashboardCache.hourly;
    const cacheTime = dashboardCacheTime.hourly;

    // Return cached data if still valid and same parameters
    if (cacheEntry && cacheEntry.key === cacheKey && (Date.now() - cacheTime) < DASHBOARD_CACHE_TTL) {
      console.log(`⏰ Returning cached hourly activity (${Date.now() - startTime}ms)`);
      return res.json(cacheEntry.data);
    }

    console.log('⏰ Calculating fresh hourly activity distribution...');

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

    // Build aggregation pipeline for better performance
    const matchStage = {
      timestamp: { $gte: startDate, $lte: now }
    };

    // Add technician filter
    if (technician && technician !== 'all') {
      matchStage.performedByName = technician;
    }

    // Add municipality filter
    if (municipalities && municipalities.length > 0) {
      const municipalityList = typeof municipalities === 'string'
        ? municipalities.split(',')
        : municipalities;
      matchStage['workOrderInfo.municipality'] = { $in: municipalityList };
    }

    // Get raw log data for frontend processing - limit fields and records for better performance
    const logs = await Log.find(matchStage)
      .select('timestamp action performedByName workOrderInfo.municipality')
      .sort({ timestamp: -1 })
      .limit(5000) // Reduced limit for better performance
      .lean();

    console.log(`⏰ Found ${logs.length} log entries for hourly distribution`);

    // Transform data to match frontend component expectations
    const transformedLogs = logs.map(log => ({
      timestamp: log.timestamp,
      action: log.action,
      technician: log.performedByName,
      municipality: log.workOrderInfo?.municipality || 'Unknown',
      responseTime: 0 // Default response time since we don't calculate it yet
    }));

    const result = {
      data: transformedLogs, // Frontend expects specific field names
      totalActivities: transformedLogs.length,
      timeRange,
      dateRange: {
        startDate: startDate.toISOString(),
        endDate: now.toISOString()
      }
    };

    // Cache the result
    dashboardCache.hourly = { key: cacheKey, data: result };
    dashboardCacheTime.hourly = Date.now();

    const endTime = Date.now();
    console.log(`⏰ Hourly activity calculated in ${endTime - startTime}ms (cached for ${DASHBOARD_CACHE_TTL/1000}s)`);

    res.json(result);

  } catch (error) {
    console.error('Greška pri dohvatanju distribucije aktivnosti po satima:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju distribucije aktivnosti po satima' });
  }
};

// GET - Interactive map activity data for dashboard (OPTIMIZED)
const getInteractiveMapData = async (req, res) => {
  try {
    const { timeRange = '30d', technician, municipalities, activityType, statsOnly } = req.query;

    console.log(`🗺️ Interactive map request - timeRange: ${timeRange}, technician: ${technician}, statsOnly: ${statsOnly}`);
    const startTime = Date.now();

    // For dashboard stats, return only basic numbers
    if (statsOnly === 'true') {
      const now = new Date();
      const startDate = new Date(now - 30 * 24 * 60 * 60 * 1000); // Default 30d

      const count = await WorkOrder.countDocuments({
        date: { $gte: startDate, $lte: now },
        status: 'zavrsen' // ONLY count completed work orders
      });

      console.log(`🗺️ Map stats returned in ${Date.now() - startTime}ms`);
      return res.json({ total: count });
    }

    // Create cache key based on parameters
    const cacheKey = `${timeRange}-${technician || 'all'}-${municipalities || 'all'}-${activityType || 'all'}`;
    const cacheEntry = dashboardCache.map;
    const cacheTime = dashboardCacheTime.map;

    // Return cached data if still valid and same parameters
    if (cacheEntry && cacheEntry.key === cacheKey && (Date.now() - cacheTime) < DASHBOARD_CACHE_TTL) {
      console.log(`🗺️ Returning cached map data (${Date.now() - startTime}ms)`);
      return res.json(cacheEntry.data);
    }

    console.log('🗺️ Calculating fresh interactive map data...');

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

    // Build aggregation pipeline for work orders (ONLY COMPLETED)
    const matchStage = {
      date: { $gte: startDate, $lte: now },
      status: 'zavrsen' // ONLY show completed work orders
    };

    // Add technician filter
    if (technician && technician !== 'all') {
      matchStage.$or = [
        { technicianId: new mongoose.Types.ObjectId(technician) },
        { technician2Id: new mongoose.Types.ObjectId(technician) }
      ];
    }

    // Add municipality filter
    if (municipalities && municipalities.length > 0) {
      const municipalityList = typeof municipalities === 'string'
        ? municipalities.split(',')
        : municipalities;
      matchStage.municipality = { $in: municipalityList };
    }

    // Add activity type filter
    if (activityType && activityType !== 'all') {
      matchStage.status = activityType;
    }

    // Use aggregation to get map data with location grouping
    const mapData = await WorkOrder.aggregate([
      { $match: matchStage },
      {
        $lookup: {
          from: 'technicians',
          localField: 'technicianId',
          foreignField: '_id',
          as: 'technician'
        }
      },
      {
        $lookup: {
          from: 'technicians',
          localField: 'technician2Id',
          foreignField: '_id',
          as: 'technician2'
        }
      },
      {
        $project: {
          _id: 1,
          municipality: 1,
          address: 1,
          date: 1,
          status: 1,
          type: 1,
          userName: 1,
          tisJobId: 1,
          primaryTechnician: {
            $cond: {
              if: { $gt: [{ $size: '$technician' }, 0] },
              then: { $arrayElemAt: ['$technician.name', 0] },
              else: {
                $cond: {
                  if: { $gt: [{ $size: '$technician2' }, 0] },
                  then: { $arrayElemAt: ['$technician2.name', 0] },
                  else: 'Nepoznat tehničar'
                }
              }
            }
          },
          secondaryTechnician: {
            $cond: {
              if: { $gt: [{ $size: '$technician2' }, 0] },
              then: { $arrayElemAt: ['$technician2.name', 0] },
              else: null
            }
          },
          allTechnicians: {
            $filter: {
              input: {
                $concatArrays: [
                  { $ifNull: ['$technician.name', []] },
                  { $ifNull: ['$technician2.name', []] }
                ]
              },
              cond: { $ne: ['$$this', null] }
            }
          }
        }
      },
      {
        $group: {
          _id: '$municipality', // Group only by municipality, not address
          activities: { $sum: 1 },
          completed: { $sum: 1 }, // Since we only filter completed, all are completed
          addresses: { $addToSet: '$address' }, // Collect all unique addresses
          primaryTechnicians: { $addToSet: '$primaryTechnician' },
          secondaryTechnicians: { $addToSet: '$secondaryTechnician' }, // All unique technicians (both primary and secondary)
          workOrders: { $push: '$$ROOT' } // All work orders for this municipality
        }
      },
      {
        $project: {
          municipality: '$_id',
          activities: 1,
          completed: 1,
          uniqueAddresses: { $size: '$addresses' },
          allTechnicians: {
            $setUnion: [
              { $filter: { input: '$primaryTechnicians', cond: { $ne: ['$$this', 'Nepoznat tehničar'] } } },
              { $filter: { input: '$secondaryTechnicians', cond: { $ne: ['$$this', null] } } }
            ]
          },
          addressList: '$addresses',
          sampleWorkOrders: { $slice: ['$workOrders', 10] } // Keep 10 sample work orders
        }
      },
      {
        $project: {
          municipality: 1,
          activities: 1,
          completed: 1,
          uniqueAddresses: 1,
          uniqueTechnicians: { $size: '$allTechnicians' },
          technicianList: '$allTechnicians',
          addressList: 1,
          sampleWorkOrders: 1
        }
      },
      { $sort: { activities: -1 } }
    ]);

    const result = {
      data: mapData,
      totalLocations: mapData.length,
      totalActivities: mapData.reduce((sum, item) => sum + item.activities, 0),
      timeRange,
      dateRange: {
        startDate: startDate.toISOString(),
        endDate: now.toISOString()
      }
    };

    // Cache the result
    dashboardCache.map = { key: cacheKey, data: result };
    dashboardCacheTime.map = Date.now();

    const endTime = Date.now();
    console.log(`🗺️ Interactive map calculated in ${endTime - startTime}ms (cached for ${DASHBOARD_CACHE_TTL/1000}s)`);

    res.json(result);

  } catch (error) {
    console.error('Greška pri dohvatanju podataka za interaktivnu mapu:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju podataka za interaktivnu mapu' });
  }
};

// GET - Financial analysis data for dashboard (OPTIMIZED)
const getFinancialAnalysis = async (req, res) => {
  try {
    const { timeRange = '30d', technician, municipalities, statsOnly } = req.query;

    console.log(`💰 Financial analysis request - timeRange: ${timeRange}, technician: ${technician}, statsOnly: ${statsOnly}`);
    const startTime = Date.now();

    // For dashboard stats, return only basic numbers
    if (statsOnly === 'true') {
      const now = new Date();
      const startDate = new Date(now - 30 * 24 * 60 * 60 * 1000); // Default 30d

      const count = await FinancialTransaction.countDocuments({
        verifiedAt: { $gte: startDate, $lte: now }
      });

      console.log(`💰 Financial stats returned in ${Date.now() - startTime}ms`);
      return res.json({ total: count });
    }

    // Create cache key based on parameters
    const cacheKey = `${timeRange}-${technician || 'all'}-${municipalities || 'all'}`;
    const cacheEntry = dashboardCache.financial;
    const cacheTime = dashboardCacheTime.financial;

    // Return cached data if still valid and same parameters
    if (cacheEntry && cacheEntry.key === cacheKey && (Date.now() - cacheTime) < DASHBOARD_CACHE_TTL) {
      console.log(`💰 Returning cached financial analysis (${Date.now() - startTime}ms)`);
      return res.json(cacheEntry.data);
    }

    console.log('💰 Calculating fresh financial analysis...');

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

    // Build aggregation pipeline for financial transactions
    const matchStage = {
      verifiedAt: { $gte: startDate, $lte: now }
    };

    // Add technician filter
    if (technician && technician !== 'all') {
      matchStage['technicians.technicianId'] = new mongoose.Types.ObjectId(technician);
    }

    // Add municipality filter
    if (municipalities && municipalities.length > 0) {
      const municipalityList = typeof municipalities === 'string'
        ? municipalities.split(',')
        : municipalities;
      matchStage.municipality = { $in: municipalityList };
    }

    // Use aggregation pipeline for financial analysis
    const financialData = await FinancialTransaction.aggregate([
      { $match: matchStage },
      {
        $lookup: {
          from: 'workorders',
          localField: 'workOrderId',
          foreignField: '_id',
          as: 'workOrder'
        }
      },
      {
        $unwind: { path: '$workOrder', preserveNullAndEmptyArrays: true }
      },
      {
        $project: {
          _id: 1,
          totalAmount: 1,
          discountAmount: 1,
          finalAmount: 1,
          verifiedAt: 1,
          municipality: 1,
          technicians: 1,
          'workOrder.type': 1,
          'workOrder.tisJobId': 1,
          'workOrder.userName': 1,
          netRevenue: { $subtract: ['$totalAmount', { $ifNull: ['$discountAmount', 0] }] }
        }
      },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          totalRevenue: { $sum: '$totalAmount' },
          totalDiscounts: { $sum: { $ifNull: ['$discountAmount', 0] } },
          totalNetRevenue: { $sum: '$netRevenue' },
          avgTransactionValue: { $avg: '$totalAmount' },
          transactionsByType: {
            $push: {
              type: '$workOrder.type',
              amount: '$totalAmount',
              municipality: '$municipality'
            }
          },
          dailyRevenue: {
            $push: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$verifiedAt' } },
              amount: '$totalAmount'
            }
          }
        }
      }
    ]);

    // Process results for better frontend consumption
    const result = financialData[0] || {
      totalTransactions: 0,
      totalRevenue: 0,
      totalDiscounts: 0,
      totalNetRevenue: 0,
      avgTransactionValue: 0,
      transactionsByType: [],
      dailyRevenue: []
    };

    // Group daily revenue
    const dailyRevenueMap = {};
    result.dailyRevenue.forEach(item => {
      if (dailyRevenueMap[item.date]) {
        dailyRevenueMap[item.date] += item.amount;
      } else {
        dailyRevenueMap[item.date] = item.amount;
      }
    });

    result.dailyRevenue = Object.entries(dailyRevenueMap).map(([date, amount]) => ({
      date,
      amount
    })).sort((a, b) => a.date.localeCompare(b.date));

    // Group revenue by type
    const revenueByType = {};
    result.transactionsByType.forEach(item => {
      const type = item.type || 'Nespecifikovano';
      if (revenueByType[type]) {
        revenueByType[type] += item.amount;
      } else {
        revenueByType[type] = item.amount;
      }
    });

    result.revenueByType = Object.entries(revenueByType).map(([type, amount]) => ({
      type,
      amount
    }));

    const finalResult = {
      data: result,
      timeRange,
      dateRange: {
        startDate: startDate.toISOString(),
        endDate: now.toISOString()
      }
    };

    // Cache the result
    dashboardCache.financial = { key: cacheKey, data: finalResult };
    dashboardCacheTime.financial = Date.now();

    const endTime = Date.now();
    console.log(`💰 Financial analysis calculated in ${endTime - startTime}ms (cached for ${DASHBOARD_CACHE_TTL/1000}s)`);

    res.json(finalResult);

  } catch (error) {
    console.error('Greška pri dohvatanju finansijske analize:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju finansijske analize' });
  }
};

// GET - Technician comparison data for dashboard (OPTIMIZED)
const getTechnicianComparison = async (req, res) => {
  try {
    const { timeRange = '30d', sortBy = 'successRate', municipalities, includeInactive = 'false', statsOnly } = req.query;

    console.log(`👥 Technician comparison request - timeRange: ${timeRange}, sortBy: ${sortBy}, statsOnly: ${statsOnly}`);
    const startTime = Date.now();

    // For dashboard stats, return only basic numbers
    if (statsOnly === 'true') {
      const count = await Technician.countDocuments({});

      console.log(`👥 Technician stats returned in ${Date.now() - startTime}ms`);
      return res.json({ total: count });
    }

    // Create cache key based on parameters
    const cacheKey = `${timeRange}-${sortBy}-${municipalities || 'all'}-${includeInactive}`;
    const cacheEntry = dashboardCache.technician;
    const cacheTime = dashboardCacheTime.technician;

    // Return cached data if still valid and same parameters - TEMPORARILY DISABLED FOR DEBUGGING
    if (false && cacheEntry && cacheEntry.key === cacheKey && (Date.now() - cacheTime) < DASHBOARD_CACHE_TTL) {
      console.log(`👥 Returning cached technician comparison (${Date.now() - startTime}ms)`);
      return res.json(cacheEntry.data);
    }

    console.log('👥 Calculating fresh technician comparison...');

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

    // Get all technicians first
    const technicians = await Technician.find({}, 'name gmail role').lean();

    // Get financial data for the same time period to calculate real profits
    const financialMatchStage = {
      verifiedAt: { $gte: startDate, $lte: now }
    };

    // Add municipality filter for financial data
    if (municipalities && municipalities.length > 0) {
      const municipalityList = typeof municipalities === 'string'
        ? municipalities.split(',')
        : municipalities;
      financialMatchStage.municipality = { $in: municipalityList };
    }

    // Get financial data aggregated by technician
    const technicianFinancials = await FinancialTransaction.aggregate([
      { $match: financialMatchStage },
      { $unwind: '$technicians' },
      {
        $group: {
          _id: '$technicians.technicianId',
          totalEarnings: { $sum: '$technicians.earnings' },
          totalRevenue: { $sum: '$finalPrice' },
          totalTransactions: { $sum: 1 },
          avgTransactionValue: { $avg: '$finalPrice' }
        }
      }
    ]);

    // Also get total company profit for comparison
    const totalFinancials = await FinancialTransaction.aggregate([
      { $match: financialMatchStage },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$finalPrice' },
          totalTechnicianEarnings: { $sum: '$totalTechnicianEarnings' },
          totalCompanyProfit: { $sum: '$companyProfit' }
        }
      }
    ]);

    const companyTotals = totalFinancials[0] || {
      totalRevenue: 0,
      totalTechnicianEarnings: 0,
      totalCompanyProfit: 0
    };

    console.log('💰 Company totals:', companyTotals);

    // Create a map for quick lookup
    const financialMap = {};
    technicianFinancials.forEach(item => {
      if (item._id) {
        financialMap[item._id.toString()] = item;
      }
    });

    console.log(`👥 Found ${technicianFinancials.length} technicians with financial data`);
    console.log(`👥 Sample financial data:`, technicianFinancials[0]);

    // Debug: Check if we're double counting
    const totalRevenueByTechnicians = technicianFinancials.reduce((sum, t) => sum + t.totalRevenue, 0);
    console.log(`🔍 Total revenue by technicians: ${totalRevenueByTechnicians}`);
    console.log(`🔍 Company total revenue: ${companyTotals.totalRevenue}`);
    console.log(`🔍 Difference: ${totalRevenueByTechnicians - companyTotals.totalRevenue}`);

    // Build municipality filter for work orders
    let municipalityFilter = {};
    if (municipalities && municipalities.length > 0) {
      const municipalityList = typeof municipalities === 'string'
        ? municipalities.split(',')
        : municipalities;
      municipalityFilter = { municipality: { $in: municipalityList } };
    }

    // Use aggregation to get technician performance statistics
    const technicianStats = await WorkOrder.aggregate([
      {
        $match: {
          ...municipalityFilter,
          date: { $gte: startDate, $lte: now }
        }
      },
      {
        $facet: {
          primaryTechnician: [
            {
              $group: {
                _id: '$technicianId',
                totalWorkOrders: { $sum: 1 },
                completedWorkOrders: {
                  $sum: { $cond: [{ $eq: ['$status', 'zavrsen'] }, 1, 0] }
                },
                cancelledWorkOrders: {
                  $sum: { $cond: [{ $eq: ['$status', 'otkazan'] }, 1, 0] }
                },
                pendingWorkOrders: {
                  $sum: { $cond: [{ $eq: ['$status', 'nezavrsen'] }, 1, 0] }
                },
                verifiedWorkOrders: {
                  $sum: { $cond: ['$verified', 1, 0] }
                },
                avgResponseTime: {
                  $avg: {
                    $divide: [
                      { $subtract: ['$statusChangedAt', '$createdAt'] },
                      1000 * 60 * 60 // Convert to hours
                    ]
                  }
                },
                municipalities: { $addToSet: '$municipality' }
              }
            }
          ],
          secondaryTechnician: [
            {
              $match: { technician2Id: { $ne: null } }
            },
            {
              $group: {
                _id: '$technician2Id',
                totalWorkOrders: { $sum: 1 },
                completedWorkOrders: {
                  $sum: { $cond: [{ $eq: ['$status', 'zavrsen'] }, 1, 0] }
                },
                cancelledWorkOrders: {
                  $sum: { $cond: [{ $eq: ['$status', 'otkazan'] }, 1, 0] }
                },
                pendingWorkOrders: {
                  $sum: { $cond: [{ $eq: ['$status', 'nezavrsen'] }, 1, 0] }
                },
                verifiedWorkOrders: {
                  $sum: { $cond: ['$verified', 1, 0] }
                },
                municipalities: { $addToSet: '$municipality' }
              }
            }
          ]
        }
      }
    ]);

    // Combine primary and secondary technician stats
    const combinedStats = {};

    technicianStats[0].primaryTechnician.forEach(stat => {
      if (stat._id) {
        combinedStats[stat._id.toString()] = stat;
      }
    });

    technicianStats[0].secondaryTechnician.forEach(stat => {
      if (stat._id) {
        const techId = stat._id.toString();
        if (combinedStats[techId]) {
          // Combine stats for technicians who are both primary and secondary
          combinedStats[techId].totalWorkOrders += stat.totalWorkOrders;
          combinedStats[techId].completedWorkOrders += stat.completedWorkOrders;
          combinedStats[techId].cancelledWorkOrders += stat.cancelledWorkOrders;
          combinedStats[techId].pendingWorkOrders += stat.pendingWorkOrders;
          combinedStats[techId].verifiedWorkOrders += stat.verifiedWorkOrders;
          combinedStats[techId].municipalities = [...new Set([...combinedStats[techId].municipalities, ...stat.municipalities])];
        } else {
          combinedStats[techId] = stat;
        }
      }
    });

    // Process and format technician data
    const technicianComparison = technicians.map(tech => {
      const stats = combinedStats[tech._id.toString()] || {
        totalWorkOrders: 0,
        completedWorkOrders: 0,
        cancelledWorkOrders: 0,
        pendingWorkOrders: 0,
        verifiedWorkOrders: 0,
        avgResponseTime: 0,
        municipalities: []
      };

      const successRate = stats.totalWorkOrders > 0
        ? (stats.completedWorkOrders / stats.totalWorkOrders) * 100
        : 0;

      const verificationRate = stats.completedWorkOrders > 0
        ? (stats.verifiedWorkOrders / stats.completedWorkOrders) * 100
        : 0;

      // Get real financial data for this technician
      const financialData = financialMap[tech._id.toString()] || {
        totalEarnings: 0,
        totalRevenue: 0,
        totalTransactions: 0,
        avgTransactionValue: 0
      };

      // Calculate financial metrics using real data
      const totalRevenue = financialData.totalRevenue || 0;
      const technicianEarnings = financialData.totalEarnings || 0; // This is technician's actual earnings from FinancialTransaction
      const totalCost = totalRevenue * 0.4; // Estimate costs as 40% of revenue
      const technicianProfit = technicianEarnings; // Use actual technician earnings as their profit

      console.log(`👤 ${tech.name}: revenue=${totalRevenue}, earnings=${technicianEarnings}, profit=${technicianProfit}`);

      // Calculate work days (estimate based on work orders spread over time period)
      const timeRangeDays = Math.ceil((now - startDate) / (1000 * 60 * 60 * 24));
      const estimatedWorkDays = Math.min(timeRangeDays, stats.totalWorkOrders * 0.3);

      return {
        id: tech._id.toString(),
        name: tech.name,
        email: tech.gmail || '',
        role: tech.role || 'technician',
        totalWorkOrders: stats.totalWorkOrders,
        completedWorkOrders: stats.completedWorkOrders,
        cancelledWorkOrders: stats.cancelledWorkOrders,
        pendingWorkOrders: stats.pendingWorkOrders,
        verifiedWorkOrders: stats.verifiedWorkOrders,
        successRate: Math.round(successRate * 100) / 100,
        verificationRate: Math.round(verificationRate * 100) / 100,
        avgResponseTime: stats.avgResponseTime ? Math.round(stats.avgResponseTime * 100) / 100 : 0,
        avgResponseTimeInMinutes: stats.avgResponseTime ? Math.round(stats.avgResponseTime * 60 * 100) / 100 : 0, // Convert hours to minutes for display
        municipalitiesWorked: stats.municipalities.length,
        municipalities: stats.municipalities,
        isActive: stats.totalWorkOrders > 0,

        // Financial fields using real FinancialTransaction data - technician earnings as profit
        totalProfit: technicianProfit, // Technician's actual earnings (this is what they "profit")
        totalRevenue: totalRevenue, // Total revenue from completed transactions
        totalCost: totalCost, // Company costs (estimated)
        totalTransactions: financialData.totalTransactions, // Actual verified transactions

        // Also include the actual earnings for reference/debugging
        actualEarnings: technicianEarnings, // What technician actually earned

        // Activity fields
        activeDays: estimatedWorkDays,
        workDays: Array.from({ length: estimatedWorkDays }, (_, i) =>
          new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        ),

        // Service types (estimate based on municipalities)
        serviceTypes: stats.municipalities.reduce((acc, municipality) => {
          acc[municipality] = Math.floor(stats.totalWorkOrders / stats.municipalities.length);
          return acc;
        }, {}),

        // Performance score
        performanceScore: Math.round((successRate + verificationRate) / 2)
      };
    });

    // Filter by active status if requested
    let filteredTechnicians = technicianComparison;
    if (includeInactive !== 'true') {
      filteredTechnicians = technicianComparison.filter(tech => tech.isActive);
    }

    // Sort by requested criteria
    filteredTechnicians.sort((a, b) => {
      switch (sortBy) {
        case 'successRate':
          return b.successRate - a.successRate;
        case 'totalWorkOrders':
          return b.totalWorkOrders - a.totalWorkOrders;
        case 'verificationRate':
          return b.verificationRate - a.verificationRate;
        case 'avgResponseTime':
          return a.avgResponseTime - b.avgResponseTime; // Lower is better
        case 'name':
          return a.name.localeCompare(b.name);
        default:
          return b.successRate - a.successRate;
      }
    });

    const result = {
      data: filteredTechnicians,
      totalTechnicians: filteredTechnicians.length,
      activeTechnicians: filteredTechnicians.filter(t => t.isActive).length,
      timeRange,
      sortBy,
      dateRange: {
        startDate: startDate.toISOString(),
        endDate: now.toISOString()
      }
    };

    // Cache the result
    dashboardCache.technician = { key: cacheKey, data: result };
    dashboardCacheTime.technician = Date.now();

    console.log(`👥 Sample technician data:`, filteredTechnicians[0]);

    const endTime = Date.now();
    console.log(`👥 Technician comparison calculated in ${endTime - startTime}ms (cached for ${DASHBOARD_CACHE_TTL/1000}s)`);

    res.json(result);

  } catch (error) {
    console.error('Greška pri dohvatanju poređenja tehničara:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju poređenja tehničara' });
  }
};

// Export the functions
module.exports = {
  invalidateDashboardStats,
  getCancellationAnalysis,
  getHourlyActivityDistribution,
  getInteractiveMapData,
  getFinancialAnalysis,
  getTechnicianComparison
};