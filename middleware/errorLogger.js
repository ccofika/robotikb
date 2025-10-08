const { ErrorLog } = require('../models');

/**
 * Middleware za logovanje grešaka
 * Ovo treba dodati kao error handling middleware u server.js
 */
const errorLogger = (err, req, res, next) => {
  // Određivanje tipa greške
  let errorType = 'Unknown';
  if (err.name === 'ValidationError') errorType = 'ValidationError';
  else if (err.name === 'CastError') errorType = 'CastError';
  else if (err.name === 'MongoError' || err.name === 'MongoServerError') errorType = 'MongoError';
  else if (err.name === 'UnauthorizedError') errorType = 'UnauthorizedError';
  else if (err.statusCode === 404) errorType = 'NotFoundError';
  else if (err.statusCode === 500) errorType = 'ServerError';

  // Određivanje severity-ja
  let severity = 'medium';
  if (err.statusCode >= 500) severity = 'high';
  else if (err.statusCode === 401 || err.statusCode === 403) severity = 'medium';
  else if (err.statusCode === 404) severity = 'low';
  else if (err.name === 'MongoError') severity = 'critical';

  // Pripremi log podatke
  const logData = {
    errorType,
    errorMessage: err.message || 'Unknown error',
    errorStack: err.stack,
    statusCode: err.statusCode || 500,
    route: req.originalUrl || req.url,
    method: req.method,
    userId: req.user?._id || req.user?.id,
    userName: req.user?.name,
    userRole: req.user?.role,
    requestData: {
      body: req.body,
      params: req.params,
      query: req.query
    },
    metadata: {
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    },
    severity,
    timestamp: new Date()
  };

  // Asinkrono snimi grešku u bazu (non-blocking)
  setImmediate(async () => {
    try {
      // Proveri da li već postoji ista greška u poslednjih 5 minuta
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const existingError = await ErrorLog.findOne({
        route: logData.route,
        errorMessage: logData.errorMessage,
        resolved: false,
        timestamp: { $gte: fiveMinutesAgo }
      });

      if (existingError) {
        // Ako postoji, samo inkrementuj occurrences
        existingError.occurrences += 1;
        existingError.timestamp = new Date(); // Ažuriraj timestamp
        await existingError.save();
        console.log(`⚠️  Repeated error logged (occurrences: ${existingError.occurrences}):`, err.message);
      } else {
        // Ako ne postoji, kreiraj novi log
        await ErrorLog.create(logData);
        console.error(`❌ Error logged:`, {
          type: errorType,
          message: err.message,
          route: logData.route
        });
      }
    } catch (logError) {
      console.error('❌ Failed to log error to database:', logError.message);
    }
  });

  // Prosleđivanje greške dalje (next error handler će je obraditi)
  next(err);
};

/**
 * Helper funkcija za ručno logovanje grešaka
 */
const logError = async (error, context = {}) => {
  try {
    const logData = {
      errorType: error.name || 'Unknown',
      errorMessage: error.message || 'Unknown error',
      errorStack: error.stack,
      statusCode: error.statusCode || 500,
      route: context.route || 'Unknown',
      method: context.method || 'Unknown',
      userId: context.userId,
      userName: context.userName,
      userRole: context.userRole,
      severity: context.severity || 'medium',
      timestamp: new Date()
    };

    await ErrorLog.create(logData);
  } catch (logError) {
    console.error('❌ Failed to manually log error:', logError.message);
  }
};

module.exports = {
  errorLogger,
  logError
};
