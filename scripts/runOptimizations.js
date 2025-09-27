#!/usr/bin/env node

/**
 * MongoDB Dashboard Optimization Script
 *
 * This script runs all the database optimizations for the logs dashboard
 * in the correct order to ensure maximum performance improvements.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const createOptimizedIndexes = require('./createOptimizedIndexes');
const { initializeRedis } = require('../middleware/cacheMiddleware');
const { performanceMonitor } = require('../middleware/performanceMonitor');

async function runFullOptimization() {
  console.log('🚀 Starting MongoDB Dashboard Optimization Process...\n');

  const startTime = Date.now();

  try {
    // Step 1: Database Connection
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Step 2: Create Optimized Indexes
    console.log('🔧 Creating optimized database indexes...');
    await createOptimizedIndexes();
    console.log('✅ Database indexes optimization completed\n');

    // Step 3: Initialize Cache System
    console.log('💾 Initializing Redis cache system...');
    try {
      await initializeRedis();
      console.log('✅ Redis cache system initialized\n');
    } catch (error) {
      console.log('⚠️ Redis not available, will use memory cache fallback\n');
    }

    // Step 4: Enable Database Profiling
    console.log('📊 Enabling database performance monitoring...');
    performanceMonitor.enableDatabaseProfiling();
    console.log('✅ Performance monitoring enabled\n');

    // Step 5: Verify Optimizations
    console.log('🔍 Verifying optimizations...');
    await verifyOptimizations();
    console.log('✅ Optimization verification completed\n');

    // Step 6: Performance Baseline
    console.log('📈 Establishing performance baseline...');
    await establishPerformanceBaseline();
    console.log('✅ Performance baseline established\n');

    const endTime = Date.now();
    const totalTime = (endTime - startTime) / 1000;

    console.log('🎉 MongoDB Dashboard Optimization Completed Successfully!');
    console.log(`⏱️ Total optimization time: ${totalTime.toFixed(2)} seconds\n`);

    // Final recommendations
    console.log('💡 Next Steps:');
    console.log('   1. Restart your application server to apply all changes');
    console.log('   2. Monitor dashboard performance using /api/logs/performance/stats');
    console.log('   3. Run load tests to verify performance improvements');
    console.log('   4. Consider setting up Redis for production caching');
    console.log('   5. Review slow query logs after 24 hours of usage\n');

    console.log('🔗 Useful endpoints for monitoring:');
    console.log('   • Performance Stats: GET /api/logs/performance/stats');
    console.log('   • Cache Stats: GET /api/logs/cache/stats');
    console.log('   • Database Metrics: GET /api/logs/performance/database');
    console.log('   • Clear Cache: DELETE /api/logs/cache/clear\n');

  } catch (error) {
    console.error('❌ Optimization failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
  }
}

async function verifyOptimizations() {
  const db = mongoose.connection.db;

  // Verify indexes
  console.log('   🔍 Checking created indexes...');
  const logIndexes = await db.collection('logs').indexes();
  const workOrderIndexes = await db.collection('workorders').indexes();

  console.log(`   📊 Log collection indexes: ${logIndexes.length}`);
  console.log(`   📊 WorkOrder collection indexes: ${workOrderIndexes.length}`);

  // Check for key optimized indexes
  const keyIndexes = [
    'dashboard_main_filter',
    'dashboard_municipality_filter',
    'dashboard_combined_filter',
    'kpi_action_lookup'
  ];

  const missingIndexes = keyIndexes.filter(indexName =>
    !logIndexes.some(index => index.name === indexName)
  );

  if (missingIndexes.length > 0) {
    console.warn(`   ⚠️ Missing critical indexes: ${missingIndexes.join(', ')}`);
  } else {
    console.log('   ✅ All critical indexes are present');
  }

  // Test a sample query performance
  console.log('   🧪 Testing sample query performance...');
  const startTime = Date.now();

  await db.collection('logs').aggregate([
    { $match: { timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } },
    { $group: { _id: '$action', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 5 }
  ]).toArray();

  const queryTime = Date.now() - startTime;
  console.log(`   ⚡ Sample aggregation query completed in ${queryTime}ms`);

  if (queryTime > 1000) {
    console.warn('   ⚠️ Query performance may need further optimization');
  } else {
    console.log('   ✅ Query performance looks good');
  }
}

async function establishPerformanceBaseline() {
  const db = mongoose.connection.db;

  console.log('   📊 Collecting database statistics...');

  // Get collection stats
  const logStats = await db.collection('logs').stats();
  const workOrderStats = await db.collection('workorders').stats();

  // Get server status
  const serverStatus = await db.admin().serverStatus();

  const baseline = {
    timestamp: new Date(),
    collections: {
      logs: {
        count: logStats.count,
        avgObjSize: logStats.avgObjSize,
        totalIndexSize: logStats.totalIndexSize,
        indexCount: Object.keys(logStats.indexSizes || {}).length
      },
      workorders: {
        count: workOrderStats.count,
        avgObjSize: workOrderStats.avgObjSize,
        totalIndexSize: workOrderStats.totalIndexSize,
        indexCount: Object.keys(workOrderStats.indexSizes || {}).length
      }
    },
    server: {
      version: serverStatus.version,
      uptime: serverStatus.uptime,
      connections: serverStatus.connections
    }
  };

  console.log('   📈 Performance baseline:');
  console.log(`      • Log documents: ${baseline.collections.logs.count.toLocaleString()}`);
  console.log(`      • Log indexes: ${baseline.collections.logs.indexCount}`);
  console.log(`      • WorkOrder documents: ${baseline.collections.workorders.count.toLocaleString()}`);
  console.log(`      • WorkOrder indexes: ${baseline.collections.workorders.indexCount}`);
  console.log(`      • MongoDB version: ${baseline.server.version}`);

  // Save baseline to file for future reference
  const fs = require('fs');
  const path = require('path');

  const baselineFile = path.join(__dirname, '..', 'performance_baseline.json');
  fs.writeFileSync(baselineFile, JSON.stringify(baseline, null, 2));

  console.log(`   💾 Baseline saved to: ${baselineFile}`);
}

// Add performance monitoring endpoints
function addPerformanceEndpoints(app) {
  // Performance stats endpoint
  app.get('/api/logs/performance/stats', async (req, res) => {
    try {
      const analysis = await performanceMonitor.getPerformanceAnalysis();
      res.json(analysis);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get performance stats' });
    }
  });

  // Database metrics endpoint
  app.get('/api/logs/performance/database', async (req, res) => {
    try {
      const metrics = await performanceMonitor.getDatabaseMetrics();
      res.json(metrics);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get database metrics' });
    }
  });

  // Slow queries endpoint
  app.get('/api/logs/performance/slow-queries', (req, res) => {
    try {
      const slowQueries = performanceMonitor.getSlowQueriesReport();
      res.json(slowQueries);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get slow queries' });
    }
  });

  console.log('✅ Performance monitoring endpoints added');
}

// Run optimization if called directly
if (require.main === module) {
  runFullOptimization()
    .then(() => {
      console.log('✅ Optimization script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Optimization script failed:', error);
      process.exit(1);
    });
}

module.exports = {
  runFullOptimization,
  addPerformanceEndpoints,
  verifyOptimizations,
  establishPerformanceBaseline
};