const { isDBConnected } = require('../config/db');

// Middleware za proveru DB konekcije pre procesiranja zahteva
const ensureDBConnection = (req, res, next) => {
  if (!isDBConnected()) {
    console.error(`🚫 Database connection unavailable for ${req.method} ${req.path}`);
    return res.status(503).json({
      error: 'Database connection is not available',
      message: 'Please try again in a few moments',
      timestamp: new Date().toISOString(),
      endpoint: `${req.method} ${req.path}`
    });
  }
  next();
};

// Middleware za logovanje sporih query-ja
const logSlowQueries = (threshold = 1000) => {
  return (req, res, next) => {
    const start = Date.now();

    // Override res.json to measure response time
    const originalJson = res.json;
    res.json = function(data) {
      try {
        const duration = Date.now() - start;

        if (duration > threshold) {
          console.warn(`⚠️  SLOW QUERY DETECTED:`);
          console.warn(`   📍 Method: ${req.method}`);
          console.warn(`   🛣️  Path: ${req.path || req.url || 'unknown'}`);
          console.warn(`   ⏱️  Duration: ${duration}ms`);

          // Safely handle query parameters
          try {
            const queryStr = JSON.stringify(req.query || {});
            console.warn(`   🔍 Query: ${queryStr}`);
          } catch (e) {
            console.warn(`   🔍 Query: [Unable to serialize]`);
          }

          // Safely handle request body
          try {
            const bodyStr = req.body ? JSON.stringify(req.body) : 'No body';
            const bodyPreview = bodyStr.length > 200 ? bodyStr.substring(0, 200) + '...' : bodyStr;
            console.warn(`   📦 Body: ${bodyPreview}`);
          } catch (e) {
            console.warn(`   📦 Body: [Unable to serialize request body]`);
          }

          console.warn(`   🕐 Timestamp: ${new Date().toISOString()}`);
          console.warn(`   ⚡ Performance tip: Consider adding caching or optimizing this query`);
          console.warn(`   ${'='.repeat(60)}`);
        }

        return originalJson.call(this, data);
      } catch (error) {
        console.error(`🚨 Error in slow query middleware:`, error.message);
        return originalJson.call(this, data);
      }
    };

    next();
  };
};

// Performance monitoring utility
const logPerformanceStats = () => {
  const stats = {
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  };

  console.log(`📊 Performance Stats:`);
  console.log(`   ⏰ Uptime: ${stats.uptime}s`);
  console.log(`   🧠 Memory - RSS: ${Math.round(stats.memory.rss / 1024 / 1024)}MB`);
  console.log(`   💼 Heap Used: ${Math.round(stats.memory.heapUsed / 1024 / 1024)}MB`);
  console.log(`   ${'='.repeat(60)}`);
};

module.exports = {
  ensureDBConnection,
  logSlowQueries,
  logPerformanceStats
};