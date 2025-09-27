const Log = require('../models/Log');
const WorkOrder = require('../models/WorkOrder');

// =============================================
// OPTIMIZED AGGREGATION PIPELINES
// =============================================

/**
 * Optimized dashboard KPI queries
 * Key optimizations:
 * - Early $match filtering
 * - Minimal projection
 * - Index hints where beneficial
 */
const getOptimizedKPIData = async (filter) => {
  // Use Promise.all to run queries in parallel
  const [
    totalActions,
    completedWorkOrders,
    activeTechnicians,
    responseTimeStats
  ] = await Promise.all([
    // Total actions count - optimized with index hint
    Log.countDocuments(filter).hint({ timestamp: -1, action: 1 }),

    // Completed work orders - optimized with specific action filter
    Log.countDocuments({
      ...filter,
      action: 'workorder_finished'
    }).hint({ action: 1, timestamp: -1 }),

    // Active technicians - optimized distinct query
    Log.distinct('performedByName', filter),

    // Response time calculation - optimized aggregation
    Log.aggregate([
      { $match: filter },
      {
        $match: {
          action: { $in: ['workorder_created', 'workorder_finished'] }
        }
      },
      {
        $project: {
          action: 1,
          workOrderId: 1,
          timestamp: 1
        }
      },
      {
        $group: {
          _id: '$workOrderId',
          events: {
            $push: {
              action: '$action',
              timestamp: '$timestamp'
            }
          }
        }
      },
      {
        $project: {
          responseTime: {
            $let: {
              vars: {
                created: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: '$events',
                        cond: { $eq: ['$$this.action', 'workorder_created'] }
                      }
                    },
                    0
                  ]
                },
                finished: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: '$events',
                        cond: { $eq: ['$$this.action', 'workorder_finished'] }
                      }
                    },
                    0
                  ]
                }
              },
              in: {
                $cond: {
                  if: { $and: ['$$created', '$$finished'] },
                  then: {
                    $divide: [
                      { $subtract: ['$$finished.timestamp', '$$created.timestamp'] },
                      3600000 // Convert to hours
                    ]
                  },
                  else: null
                }
              }
            }
          }
        }
      },
      {
        $match: {
          responseTime: { $ne: null, $gt: 0 }
        }
      },
      {
        $group: {
          _id: null,
          avgResponseTime: { $avg: '$responseTime' },
          count: { $sum: 1 }
        }
      }
    ]).hint({ action: 1, workOrderId: 1, timestamp: -1 })
  ]);

  return {
    totalActions,
    completedWorkOrders,
    activeTechniciansCount: activeTechnicians.length,
    avgResponseTime: responseTimeStats[0]?.avgResponseTime || 0
  };
};

/**
 * Optimized charts data aggregations
 * Key optimizations:
 * - Parallel execution
 * - Early filtering
 * - Projection of only needed fields
 */
const getOptimizedChartsData = async (filter) => {
  const [
    actionsDistribution,
    statusBreakdown,
    technicianProductivity,
    municipalityMaterials,
    activityTimeline
  ] = await Promise.all([
    // Actions distribution - optimized with early projection
    Log.aggregate([
      { $match: filter },
      { $project: { action: 1 } },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 }
    ]).hint({ timestamp: -1, action: 1 }),

    // Status breakdown - optimized with specific action filtering
    Log.aggregate([
      {
        $match: {
          ...filter,
          action: 'workorder_status_changed',
          'statusChange.newStatus': { $exists: true, $ne: null }
        }
      },
      { $project: { 'statusChange.newStatus': 1 } },
      { $group: { _id: '$statusChange.newStatus', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).hint({ action: 1, timestamp: -1 }),

    // Technician productivity - optimized with projection
    Log.aggregate([
      { $match: filter },
      { $project: { performedByName: 1, action: 1 } },
      {
        $group: {
          _id: '$performedByName',
          totalActions: { $sum: 1 },
          completedWO: {
            $sum: {
              $cond: [{ $eq: ['$action', 'workorder_finished'] }, 1, 0]
            }
          }
        }
      },
      { $sort: { totalActions: -1 } },
      { $limit: 10 }
    ]).hint({ performedByName: 1, timestamp: -1 }),

    // Municipality materials - optimized with specific action filtering
    Log.aggregate([
      {
        $match: {
          ...filter,
          action: { $in: ['material_added', 'material_removed'] },
          'workOrderInfo.municipality': { $exists: true, $ne: '' }
        }
      },
      {
        $project: {
          'workOrderInfo.municipality': 1,
          'materialDetails.quantity': 1,
          action: 1
        }
      },
      {
        $group: {
          _id: '$workOrderInfo.municipality',
          materialsUsed: {
            $sum: {
              $cond: [
                { $eq: ['$action', 'material_added'] },
                { $ifNull: ['$materialDetails.quantity', 1] },
                0
              ]
            }
          }
        }
      },
      { $sort: { materialsUsed: -1 } },
      { $limit: 10 }
    ]).hint({ action: 1, 'workOrderInfo.municipality': 1 }),

    // Activity timeline - optimized with time-based grouping
    Log.aggregate([
      { $match: filter },
      { $project: { timestamp: 1 } },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$timestamp'
            }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } },
      { $limit: 30 }
    ]).hint({ timestamp: -1 })
  ]);

  return {
    actionsDistribution,
    statusBreakdown,
    technicianProductivity,
    municipalityMaterials,
    activityTimeline
  };
};

/**
 * Optimized table data queries
 * Key optimizations:
 * - Lean queries
 * - Limited results
 * - Specific field projection
 */
const getOptimizedTablesData = async (filter) => {
  const [topTechnicians, recentActions, problematicWorkOrders] = await Promise.all([
    // Top technicians - optimized aggregation
    Log.aggregate([
      { $match: filter },
      { $project: { performedByName: 1, action: 1 } },
      {
        $group: {
          _id: '$performedByName',
          totalActions: { $sum: 1 },
          completedWorkOrders: {
            $sum: {
              $cond: [{ $eq: ['$action', 'workorder_finished'] }, 1, 0]
            }
          },
          efficiency: {
            $avg: {
              $cond: [{ $eq: ['$action', 'workorder_finished'] }, 1, 0]
            }
          }
        }
      },
      { $sort: { totalActions: -1 } },
      { $limit: 10 }
    ]).hint({ performedByName: 1, action: 1 }),

    // Recent actions - optimized with lean and limit
    Log.find(filter)
      .select('action description performedByName timestamp workOrderInfo.municipality workOrderInfo.address')
      .sort({ timestamp: -1 })
      .limit(20)
      .lean()
      .hint({ timestamp: -1 }),

    // Problematic work orders - optimized aggregation
    Log.aggregate([
      {
        $match: {
          ...filter,
          action: { $in: ['workorder_postponed', 'workorder_cancelled'] }
        }
      },
      { $project: { workOrderId: 1, action: 1, 'workOrderInfo.municipality': 1 } },
      {
        $group: {
          _id: '$workOrderId',
          issues: { $sum: 1 },
          lastIssue: { $max: '$action' },
          municipality: { $first: '$workOrderInfo.municipality' }
        }
      },
      { $sort: { issues: -1 } },
      { $limit: 15 }
    ]).hint({ action: 1, workOrderId: 1 })
  ]);

  return {
    topTechnicians,
    recentActions,
    problematicWorkOrders
  };
};

/**
 * Optimized interactive map data
 * Key optimizations:
 * - Parallel queries
 * - Geospatial considerations
 * - Efficient joins
 */
const getOptimizedInteractiveMapData = async (timeRange, technician, municipalities, activityType) => {
  // Build optimized filters
  const dateFilter = buildTimeFilter(timeRange);
  const workOrderFilter = { ...dateFilter };
  const logFilter = { ...dateFilter };

  // Add technician filter
  if (technician && technician !== 'all') {
    workOrderFilter.$or = [
      { technicianId: technician },
      { technician2Id: technician }
    ];
    logFilter.performedByName = technician;
  }

  // Add municipality filter
  if (municipalities && municipalities.length > 0) {
    const municipalityList = Array.isArray(municipalities) ? municipalities : municipalities.split(',');
    workOrderFilter.municipality = { $in: municipalityList };
    logFilter['workOrderInfo.municipality'] = { $in: municipalityList };
  }

  // Parallel execution of optimized queries
  const [workOrders, activityLogs] = await Promise.all([
    WorkOrder.find(workOrderFilter)
      .select('municipality address status date type technicianId technician2Id')
      .populate('technicianId', 'name', null, { lean: true })
      .populate('technician2Id', 'name', null, { lean: true })
      .lean()
      .hint({ date: -1, municipality: 1, status: 1 }),

    Log.find(logFilter)
      .select('action timestamp performedByName workOrderInfo workOrderId')
      .lean()
      .hint({ timestamp: -1, 'workOrderInfo.municipality': 1 })
  ]);

  // Process data efficiently
  const processedData = processMapData(workOrders, activityLogs, activityType);

  return processedData;
};

/**
 * Optimized cancellation analysis
 * Key optimizations:
 * - Efficient date range queries
 * - Parallel execution
 * - Minimal data transfer
 */
const getOptimizedCancellationAnalysis = async (timeRange, technician, municipalities) => {
  const dateFilter = buildTimeFilter(timeRange);
  const filter = {
    statusChangedAt: dateFilter,
    status: { $in: ['otkazan', 'odlozen'] }
  };

  // Add filters
  if (technician && technician !== 'all') {
    filter.$or = [
      { technicianId: technician },
      { technician2Id: technician }
    ];
  }

  if (municipalities && municipalities.length > 0) {
    filter.municipality = { $in: Array.isArray(municipalities) ? municipalities : municipalities.split(',') };
  }

  const [cancelledWorkOrders, cancellationLogs] = await Promise.all([
    WorkOrder.find(filter)
      .select('status statusChangedAt municipality type technicianId technician2Id cancelHistory postponeHistory')
      .populate('technicianId', 'name', null, { lean: true })
      .populate('technician2Id', 'name', null, { lean: true })
      .lean()
      .hint({ status: 1, statusChangedAt: -1, municipality: 1 }),

    Log.find({
      timestamp: dateFilter,
      action: { $in: ['workorder_cancelled', 'workorder_postponed'] }
    })
      .select('action timestamp workOrderId description')
      .lean()
      .hint({ action: 1, timestamp: -1 })
  ]);

  return processCancellationData(cancelledWorkOrders, cancellationLogs);
};

// =============================================
// HELPER FUNCTIONS
// =============================================

const buildTimeFilter = (timeRange) => {
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
    default:
      startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
  }

  return { $gte: startDate, $lte: now };
};

const processMapData = (workOrders, activityLogs, activityType) => {
  // Efficient data processing logic
  const activityMap = new Map();

  // Process work orders
  workOrders.forEach(wo => {
    const key = `${wo.municipality}-${wo.address}`;
    if (!activityMap.has(key)) {
      activityMap.set(key, {
        municipality: wo.municipality,
        address: wo.address,
        activities: 0,
        lastActivity: null,
        activityType: 'work_order'
      });
    }
    activityMap.get(key).activities++;
  });

  // Process activity logs
  activityLogs.forEach(log => {
    if (activityType && log.action !== activityType) return;

    const key = `${log.workOrderInfo.municipality}-${log.workOrderInfo.address}`;
    const existing = activityMap.get(key);

    if (existing) {
      existing.activities++;
      if (!existing.lastActivity || log.timestamp > existing.lastActivity) {
        existing.lastActivity = log.timestamp;
      }
    } else {
      activityMap.set(key, {
        municipality: log.workOrderInfo.municipality,
        address: log.workOrderInfo.address,
        activities: 1,
        lastActivity: log.timestamp,
        activityType: log.action
      });
    }
  });

  return Array.from(activityMap.values());
};

const processCancellationData = (workOrders, logs) => {
  // Efficient cancellation data processing
  const cancellationStats = {
    totalCancelled: 0,
    totalPostponed: 0,
    reasonsBreakdown: {},
    timelineData: [],
    municipalityBreakdown: {}
  };

  workOrders.forEach(wo => {
    if (wo.status === 'otkazan') {
      cancellationStats.totalCancelled++;
    } else if (wo.status === 'odlozen') {
      cancellationStats.totalPostponed++;
    }

    // Process municipality breakdown
    if (!cancellationStats.municipalityBreakdown[wo.municipality]) {
      cancellationStats.municipalityBreakdown[wo.municipality] = {
        cancelled: 0,
        postponed: 0
      };
    }

    if (wo.status === 'otkazan') {
      cancellationStats.municipalityBreakdown[wo.municipality].cancelled++;
    } else if (wo.status === 'odlozen') {
      cancellationStats.municipalityBreakdown[wo.municipality].postponed++;
    }
  });

  return cancellationStats;
};

module.exports = {
  getOptimizedKPIData,
  getOptimizedChartsData,
  getOptimizedTablesData,
  getOptimizedInteractiveMapData,
  getOptimizedCancellationAnalysis,
  buildTimeFilter
};