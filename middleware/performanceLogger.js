const { PerformanceLog } = require('../models');

// Threshold za spore requeste (u milisekundama)
const SLOW_REQUEST_THRESHOLD = 2000; // 2 sekunde

// Sampling rate za normalne requeste (10% će biti logovano)
const SAMPLING_RATE = 0.1;

/**
 * Middleware za logovanje performansi
 */
const performanceLogger = (req, res, next) => {
  const startTime = Date.now();
  const startMemory = process.memoryUsage();
  const startCpu = process.cpuUsage();

  // Sačuvaj originalni res.json
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  let responseSize = 0;

  // Helper funkcija za logovanje performansi
  const logPerformance = async (responseBody) => {
    try {
      const duration = Date.now() - startTime;
      const isSlow = duration > SLOW_REQUEST_THRESHOLD;

      // Odluči da li da loguješ ovaj request
      const shouldLog = isSlow || Math.random() < SAMPLING_RATE;

      if (!shouldLog) {
        return;
      }

      // Izračunaj veličinu response-a
      if (responseBody) {
        responseSize = Buffer.byteLength(JSON.stringify(responseBody), 'utf8');
      }

      // Memorija i CPU metrike
      const endMemory = process.memoryUsage();
      const endCpu = process.cpuUsage(startCpu);

      // Pripremi log podatke
      const logData = {
        route: req.originalUrl || req.url,
        method: req.method,
        duration,
        statusCode: res.statusCode,
        userId: req.user?._id || req.user?.id,
        userName: req.user?.name,
        userRole: req.user?.role,
        responseSize,
        isSlow,
        hasError: res.statusCode >= 400,
        memoryUsage: {
          heapUsed: endMemory.heapUsed - startMemory.heapUsed,
          heapTotal: endMemory.heapTotal,
          external: endMemory.external
        },
        cpuUsage: {
          user: endCpu.user,
          system: endCpu.system
        },
        metadata: {
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('user-agent'),
          requestSize: req.get('content-length') || 0
        },
        timestamp: new Date()
      };

      // Asinkrono snimi log (non-blocking)
      setImmediate(async () => {
        try {
          await PerformanceLog.create(logData);

          // Log samo spore requeste u konzolu
          if (isSlow) {
            console.warn(`🐌 Slow request detected: ${req.method} ${req.originalUrl} - ${duration}ms`);
          }
        } catch (error) {
          console.error('❌ Failed to log performance:', error.message);
        }
      });

    } catch (error) {
      console.error('❌ Error in performance logging:', error.message);
    }
  };

  // Override res.json
  res.json = function(data) {
    logPerformance(data).catch(err => {
      console.error('❌ Failed to log performance (json):', err.message);
    });

    return originalJson(data);
  };

  // Override res.send (za slučajeve kada se koristi send umesto json)
  res.send = function(data) {
    logPerformance(data).catch(err => {
      console.error('❌ Failed to log performance (send):', err.message);
    });

    return originalSend(data);
  };

  next();
};

/**
 * Helper funkcija za ručno logovanje performansi
 */
const logPerformance = async (performanceData) => {
  try {
    await PerformanceLog.create({
      route: performanceData.route || 'Unknown',
      method: performanceData.method || 'Unknown',
      duration: performanceData.duration,
      statusCode: performanceData.statusCode || 200,
      isSlow: performanceData.duration > SLOW_REQUEST_THRESHOLD,
      timestamp: new Date(),
      ...performanceData
    });
  } catch (error) {
    console.error('❌ Failed to manually log performance:', error.message);
  }
};

/**
 * Cleanup funkcija za brisanje starih performance logova
 * Poziva se periodično iz server.js (npr. jednom dnevno)
 */
const cleanupOldPerformanceLogs = async () => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Obriši normalne logove starije od 7 dana
    const normalLogsDeleted = await PerformanceLog.deleteMany({
      isSlow: false,
      timestamp: { $lt: sevenDaysAgo }
    });

    // Obriši spore logove starije od 30 dana
    const slowLogsDeleted = await PerformanceLog.deleteMany({
      isSlow: true,
      timestamp: { $lt: thirtyDaysAgo }
    });

    console.log(`🧹 Performance logs cleanup: ${normalLogsDeleted.deletedCount} normal logs, ${slowLogsDeleted.deletedCount} slow logs deleted`);

  } catch (error) {
    console.error('❌ Failed to cleanup performance logs:', error.message);
  }
};

module.exports = {
  performanceLogger,
  logPerformance,
  cleanupOldPerformanceLogs,
  SLOW_REQUEST_THRESHOLD
};
