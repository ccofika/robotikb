const mongoose = require('mongoose');

// Performance monitoring middleware
class PerformanceMonitor {
  constructor() {
    this.slowQueries = [];
    this.queryStats = new Map();
    this.slowQueryThreshold = 1000; // 1 second
    this.maxSlowQueries = 100; // Keep last 100 slow queries
  }

  // Middleware for monitoring route performance
  routeMonitor(req, res, next) {
    const startTime = Date.now();
    const originalSend = res.send;

    // Override res.send to capture response time
    res.send = function(data) {
      const endTime = Date.now();
      const duration = endTime - startTime;
      const route = `${req.method} ${req.route?.path || req.path}`;

      // Log slow requests
      if (duration > this.slowQueryThreshold) {
        console.warn(`🐌 Slow route: ${route} took ${duration}ms`);

        this.slowQueries.push({
          route,
          duration,
          timestamp: new Date(),
          query: req.query,
          params: req.params
        });

        // Keep only recent slow queries
        if (this.slowQueries.length > this.maxSlowQueries) {
          this.slowQueries.shift();
        }
      }

      // Update route statistics
      const routeStats = this.queryStats.get(route) || {
        count: 0,
        totalTime: 0,
        avgTime: 0,
        minTime: Infinity,
        maxTime: 0
      };

      routeStats.count++;
      routeStats.totalTime += duration;
      routeStats.avgTime = routeStats.totalTime / routeStats.count;
      routeStats.minTime = Math.min(routeStats.minTime, duration);
      routeStats.maxTime = Math.max(routeStats.maxTime, duration);

      this.queryStats.set(route, routeStats);

      // Add performance headers
      res.set({
        'X-Response-Time': `${duration}ms`,
        'X-Route': route
      });

      originalSend.call(this, data);
    }.bind(this);

    next();
  }

  // Database query profiler
  enableDatabaseProfiling() {
    // Enable MongoDB profiler for slow operations
    mongoose.connection.db.admin().profiler('slow_only', { slowms: this.slowQueryThreshold }, (err, result) => {
      if (err) {
        console.error('❌ Failed to enable MongoDB profiler:', err);
      } else {
        console.log('✅ MongoDB profiler enabled for queries > 1000ms');
      }
    });

    // Monitor mongoose queries
    mongoose.set('debug', (collectionName, methodName, query, doc) => {
      const startTime = Date.now();

      // Log query details for debugging
      console.log(`🔍 Query: ${collectionName}.${methodName}`, {
        query: JSON.stringify(query),
        timestamp: new Date().toISOString()
      });
    });
  }

  // Get slow queries report
  getSlowQueriesReport() {
    return {
      slowQueries: this.slowQueries.slice().reverse(), // Most recent first
      totalSlowQueries: this.slowQueries.length,
      threshold: this.slowQueryThreshold
    };
  }

  // Get route statistics
  getRouteStats() {
    const stats = {};

    for (const [route, data] of this.queryStats.entries()) {
      stats[route] = {
        ...data,
        avgTime: Math.round(data.avgTime * 100) / 100 // Round to 2 decimal places
      };
    }

    return stats;
  }

  // Get database performance metrics
  async getDatabaseMetrics() {
    try {
      const db = mongoose.connection.db;

      // Get database stats
      const dbStats = await db.stats();

      // Get collection stats for main collections
      const [logStats, workOrderStats] = await Promise.all([
        db.collection('logs').stats(),
        db.collection('workorders').stats()
      ]);

      // Get current operations
      const currentOps = await db.admin().currentOp();

      // Get server status
      const serverStatus = await db.admin().serverStatus();

      return {
        database: {
          collections: dbStats.collections,
          dataSize: Math.round(dbStats.dataSize / 1024 / 1024), // MB
          indexSize: Math.round(dbStats.indexSize / 1024 / 1024), // MB
          avgObjSize: Math.round(dbStats.avgObjSize)
        },
        collections: {
          logs: {
            count: logStats.count,
            size: Math.round(logStats.size / 1024 / 1024), // MB
            avgObjSize: Math.round(logStats.avgObjSize),
            indexSizes: logStats.indexSizes
          },
          workorders: {
            count: workOrderStats.count,
            size: Math.round(workOrderStats.size / 1024 / 1024), // MB
            avgObjSize: Math.round(workOrderStats.avgObjSize),
            indexSizes: workOrderStats.indexSizes
          }
        },
        connections: {
          current: serverStatus.connections?.current || 0,
          available: serverStatus.connections?.available || 0
        },
        operations: {
          activeCount: currentOps.inprog?.length || 0,
          slowOps: currentOps.inprog?.filter(op => op.secs_running > 1) || []
        },
        memory: {
          resident: Math.round(serverStatus.mem?.resident || 0), // MB
          virtual: Math.round(serverStatus.mem?.virtual || 0), // MB
          mapped: Math.round(serverStatus.mem?.mapped || 0) // MB
        }
      };
    } catch (error) {
      console.error('❌ Error getting database metrics:', error);
      return { error: 'Failed to get database metrics' };
    }
  }

  // Performance analysis and recommendations
  async getPerformanceAnalysis() {
    const routeStats = this.getRouteStats();
    const slowQueries = this.getSlowQueriesReport();
    const dbMetrics = await this.getDatabaseMetrics();

    // Analyze performance issues
    const analysis = {
      summary: {
        totalRoutes: Object.keys(routeStats).length,
        slowQueriesCount: slowQueries.totalSlowQueries,
        avgResponseTime: this.calculateOverallAvgResponseTime(routeStats),
        dbSizeGB: Math.round((dbMetrics.database?.dataSize || 0) / 1024 * 100) / 100
      },
      recommendations: [],
      topSlowRoutes: this.getTopSlowRoutes(routeStats),
      indexRecommendations: this.analyzeIndexUsage(dbMetrics),
      resourceUsage: {
        memoryUsage: dbMetrics.memory,
        connectionUtilization: dbMetrics.connections ?
          Math.round((dbMetrics.connections.current / (dbMetrics.connections.current + dbMetrics.connections.available)) * 100) : 0
      }
    };

    // Generate recommendations
    if (analysis.summary.slowQueriesCount > 10) {
      analysis.recommendations.push({
        type: 'performance',
        priority: 'high',
        message: 'Multiple slow queries detected. Consider implementing caching or optimizing database queries.'
      });
    }

    if (analysis.summary.avgResponseTime > 2000) {
      analysis.recommendations.push({
        type: 'performance',
        priority: 'high',
        message: 'Average response time is high. Review slow routes and database optimization.'
      });
    }

    if (analysis.resourceUsage.connectionUtilization > 80) {
      analysis.recommendations.push({
        type: 'resource',
        priority: 'medium',
        message: 'High database connection utilization. Consider connection pooling optimization.'
      });
    }

    if (analysis.summary.dbSizeGB > 1) {
      analysis.recommendations.push({
        type: 'maintenance',
        priority: 'low',
        message: 'Database size is growing. Consider implementing data archival or cleanup strategies.'
      });
    }

    return analysis;
  }

  // Helper methods
  calculateOverallAvgResponseTime(routeStats) {
    const routes = Object.values(routeStats);
    if (routes.length === 0) return 0;

    const totalTime = routes.reduce((sum, route) => sum + route.totalTime, 0);
    const totalRequests = routes.reduce((sum, route) => sum + route.count, 0);

    return totalRequests > 0 ? Math.round(totalTime / totalRequests) : 0;
  }

  getTopSlowRoutes(routeStats, limit = 5) {
    return Object.entries(routeStats)
      .sort(([,a], [,b]) => b.avgTime - a.avgTime)
      .slice(0, limit)
      .map(([route, stats]) => ({
        route,
        avgTime: Math.round(stats.avgTime),
        maxTime: stats.maxTime,
        count: stats.count
      }));
  }

  analyzeIndexUsage(dbMetrics) {
    const recommendations = [];

    if (dbMetrics.collections?.logs?.indexSizes) {
      const logIndexSize = Object.values(dbMetrics.collections.logs.indexSizes)
        .reduce((sum, size) => sum + size, 0);

      if (logIndexSize < dbMetrics.collections.logs.size * 0.1) {
        recommendations.push({
          collection: 'logs',
          message: 'Consider adding more indexes for frequently queried fields'
        });
      }
    }

    return recommendations;
  }

  // Clear statistics
  clearStats() {
    this.slowQueries = [];
    this.queryStats.clear();
    console.log('📊 Performance statistics cleared');
  }

  // Generate daily performance report
  generateDailyReport() {
    const report = {
      date: new Date().toISOString().split('T')[0],
      routeStats: this.getRouteStats(),
      slowQueries: this.getSlowQueriesReport(),
      summary: {
        totalRequests: Array.from(this.queryStats.values()).reduce((sum, stats) => sum + stats.count, 0),
        avgResponseTime: this.calculateOverallAvgResponseTime(this.getRouteStats()),
        slowQueriesCount: this.slowQueries.length
      }
    };

    console.log('📊 Daily Performance Report:', JSON.stringify(report, null, 2));
    return report;
  }
}

// Create singleton instance
const performanceMonitor = new PerformanceMonitor();

// Export middleware function
const performanceMiddleware = (req, res, next) => {
  performanceMonitor.routeMonitor(req, res, next);
};

module.exports = {
  performanceMiddleware,
  performanceMonitor
};