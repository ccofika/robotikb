const redis = require('redis');

// Redis client setup
let redisClient;

const initializeRedis = async () => {
  try {
    redisClient = redis.createClient({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      db: process.env.REDIS_DB || 0,
      retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
          console.error('❌ Redis server refused connection');
          return new Error('Redis server refused connection');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
          return new Error('Redis retry time exhausted');
        }
        if (options.attempt > 10) {
          return undefined;
        }
        return Math.min(options.attempt * 100, 3000);
      }
    });

    redisClient.on('connect', () => {
      console.log('✅ Redis client connected');
    });

    redisClient.on('error', (err) => {
      console.error('❌ Redis client error:', err);
    });

    await redisClient.connect();
    console.log('🚀 Redis cache system initialized');
  } catch (error) {
    console.error('❌ Failed to initialize Redis:', error);
    // Fallback to memory cache if Redis is not available
    console.log('⚠️ Falling back to in-memory cache');
  }
};

// Memory cache fallback
const memoryCache = new Map();
const memoryCacheExpiry = new Map();

// Cache configuration for different dashboard endpoints
const cacheConfig = {
  // Dashboard endpoint cache durations (in seconds)
  'dashboard_kpi': {
    ttl: 5 * 60,        // 5 minutes
    enabled: true
  },
  'dashboard_charts': {
    ttl: 10 * 60,       // 10 minutes
    enabled: true
  },
  'dashboard_tables': {
    ttl: 8 * 60,        // 8 minutes
    enabled: true
  },
  'dashboard_filters': {
    ttl: 30 * 60,       // 30 minutes (static data)
    enabled: true
  },
  'dashboard_map_data': {
    ttl: 15 * 60,       // 15 minutes
    enabled: true
  },
  'dashboard_travel_analytics': {
    ttl: 20 * 60,       // 20 minutes
    enabled: true
  },
  'dashboard_interactive_map': {
    ttl: 15 * 60,       // 15 minutes
    enabled: true
  },
  'dashboard_cancellation_analysis': {
    ttl: 30 * 60,       // 30 minutes
    enabled: true
  },
  'dashboard_hourly_activity': {
    ttl: 10 * 60,       // 10 minutes
    enabled: true
  },
  'dashboard_financial_analysis': {
    ttl: 20 * 60,       // 20 minutes
    enabled: true
  },
  'dashboard_technician_comparison': {
    ttl: 15 * 60,       // 15 minutes
    enabled: true
  },
  'geocode_municipalities': {
    ttl: 60 * 60 * 24,  // 24 hours (geocoding results don't change)
    enabled: true
  }
};

// Generate cache key based on endpoint and parameters
const generateCacheKey = (endpoint, params = {}) => {
  const sortedParams = Object.keys(params)
    .sort()
    .reduce((result, key) => {
      if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
        result[key] = params[key];
      }
      return result;
    }, {});

  const paramString = Object.keys(sortedParams).length > 0
    ? ':' + JSON.stringify(sortedParams).replace(/[{}":\s]/g, '')
    : '';

  return `dashboard:${endpoint}${paramString}`;
};

// Set cache value
const setCache = async (key, value, ttl = 300) => {
  try {
    const serializedValue = JSON.stringify({
      data: value,
      timestamp: Date.now(),
      ttl: ttl
    });

    if (redisClient && redisClient.isReady) {
      await redisClient.setEx(key, ttl, serializedValue);
      console.log(`💾 Cached: ${key} (TTL: ${ttl}s)`);
    } else {
      // Fallback to memory cache
      memoryCache.set(key, serializedValue);
      memoryCacheExpiry.set(key, Date.now() + (ttl * 1000));
      console.log(`💾 Memory cached: ${key} (TTL: ${ttl}s)`);
    }
  } catch (error) {
    console.error('❌ Cache set error:', error);
  }
};

// Get cache value
const getCache = async (key) => {
  try {
    let cachedValue = null;

    if (redisClient && redisClient.isReady) {
      cachedValue = await redisClient.get(key);
    } else {
      // Fallback to memory cache
      const expiry = memoryCacheExpiry.get(key);
      if (expiry && Date.now() > expiry) {
        memoryCache.delete(key);
        memoryCacheExpiry.delete(key);
        return null;
      }
      cachedValue = memoryCache.get(key);
    }

    if (cachedValue) {
      const parsed = JSON.parse(cachedValue);
      console.log(`🎯 Cache hit: ${key} (age: ${((Date.now() - parsed.timestamp) / 1000).toFixed(1)}s)`);
      return parsed.data;
    }

    console.log(`🔍 Cache miss: ${key}`);
    return null;
  } catch (error) {
    console.error('❌ Cache get error:', error);
    return null;
  }
};

// Delete cache pattern
const deleteCache = async (pattern) => {
  try {
    if (redisClient && redisClient.isReady) {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(keys);
        console.log(`🗑️ Deleted ${keys.length} cache entries matching: ${pattern}`);
      }
    } else {
      // Fallback to memory cache pattern deletion
      const keysToDelete = [];
      for (const key of memoryCache.keys()) {
        if (key.includes(pattern.replace('*', ''))) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach(key => {
        memoryCache.delete(key);
        memoryCacheExpiry.delete(key);
      });
      console.log(`🗑️ Memory cache: Deleted ${keysToDelete.length} entries matching: ${pattern}`);
    }
  } catch (error) {
    console.error('❌ Cache delete error:', error);
  }
};

// Cache middleware factory
const cacheMiddleware = (endpointKey, customTTL = null) => {
  return async (req, res, next) => {
    // Check if caching is enabled for this endpoint
    const config = cacheConfig[endpointKey];
    if (!config || !config.enabled) {
      return next();
    }

    const ttl = customTTL || config.ttl;
    const cacheKey = generateCacheKey(endpointKey, req.query);

    try {
      // Try to get cached data
      const cachedData = await getCache(cacheKey);
      if (cachedData) {
        // Add cache headers
        res.set({
          'X-Cache': 'HIT',
          'X-Cache-Key': cacheKey,
          'Cache-Control': `public, max-age=${ttl}`
        });
        return res.json(cachedData);
      }

      // Store original res.json to intercept response
      const originalJson = res.json;
      res.json = function(data) {
        // Cache the response
        setCache(cacheKey, data, ttl).catch(err => {
          console.error('❌ Failed to cache response:', err);
        });

        // Add cache headers
        res.set({
          'X-Cache': 'MISS',
          'X-Cache-Key': cacheKey,
          'Cache-Control': `public, max-age=${ttl}`
        });

        // Call original res.json
        originalJson.call(this, data);
      };

      next();
    } catch (error) {
      console.error('❌ Cache middleware error:', error);
      next();
    }
  };
};

// Cache invalidation for data updates
const invalidateDashboardCache = async (action, technician = null, municipality = null) => {
  try {
    console.log(`🔄 Invalidating dashboard cache for action: ${action}`);

    const patterns = [
      'dashboard:dashboard_kpi*',
      'dashboard:dashboard_charts*',
      'dashboard:dashboard_tables*',
      'dashboard:dashboard_map_data*',
      'dashboard:dashboard_interactive_map*',
      'dashboard:dashboard_travel_analytics*',
      'dashboard:dashboard_hourly_activity*'
    ];

    // Add specific patterns for technician and municipality
    if (technician) {
      patterns.push(`*technician*${technician}*`);
    }
    if (municipality) {
      patterns.push(`*municipality*${municipality}*`);
    }

    // Specific invalidations based on action type
    switch (action) {
      case 'workorder_finished':
      case 'workorder_cancelled':
      case 'workorder_postponed':
        patterns.push('dashboard:dashboard_cancellation_analysis*');
        patterns.push('dashboard:dashboard_technician_comparison*');
        break;
      case 'material_added':
      case 'material_removed':
      case 'equipment_added':
      case 'equipment_removed':
        patterns.push('dashboard:dashboard_financial_analysis*');
        break;
    }

    // Delete cache patterns
    for (const pattern of patterns) {
      await deleteCache(pattern);
    }

    console.log(`✅ Cache invalidation completed for action: ${action}`);
  } catch (error) {
    console.error('❌ Cache invalidation error:', error);
  }
};

// Clear all dashboard cache
const clearAllDashboardCache = async () => {
  try {
    await deleteCache('dashboard:*');
    console.log('🗑️ All dashboard cache cleared');
  } catch (error) {
    console.error('❌ Failed to clear all cache:', error);
  }
};

// Get cache statistics
const getCacheStats = async () => {
  try {
    if (redisClient && redisClient.isReady) {
      const info = await redisClient.info('memory');
      const keys = await redisClient.keys('dashboard:*');

      return {
        type: 'Redis',
        totalKeys: keys.length,
        memoryUsage: info.match(/used_memory_human:(.+)/)?.[1] || 'Unknown',
        connected: true
      };
    } else {
      return {
        type: 'Memory',
        totalKeys: memoryCache.size,
        memoryUsage: 'N/A',
        connected: false
      };
    }
  } catch (error) {
    console.error('❌ Cache stats error:', error);
    return {
      type: 'Error',
      totalKeys: 0,
      memoryUsage: 'Error',
      connected: false
    };
  }
};

// Clean up expired memory cache entries
const cleanupMemoryCache = () => {
  const now = Date.now();
  for (const [key, expiry] of memoryCacheExpiry.entries()) {
    if (now > expiry) {
      memoryCache.delete(key);
      memoryCacheExpiry.delete(key);
    }
  }
};

// Run cleanup every 5 minutes
setInterval(cleanupMemoryCache, 5 * 60 * 1000);

module.exports = {
  initializeRedis,
  cacheMiddleware,
  invalidateDashboardCache,
  clearAllDashboardCache,
  getCacheStats,
  setCache,
  getCache,
  deleteCache,
  generateCacheKey
};