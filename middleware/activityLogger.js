const { AdminActivityLog, Technician } = require('../models');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Helper funkcija za zamenu tehnicar-{id} sa imenom tehničara
 */
const resolveTechnicianLocation = async (location) => {
  if (!location || !location.startsWith('tehnicar-')) {
    return location;
  }

  try {
    const technicianId = location.replace('tehnicar-', '');
    const technician = await Technician.findById(technicianId).select('name').lean();

    if (technician) {
      return `Tehničar: ${technician.name}`;
    }

    return location; // Vrati original ako tehničar nije pronađen
  } catch (error) {
    console.error('❌ Error resolving technician location:', error.message);
    return location;
  }
};

/**
 * Middleware za logovanje admin aktivnosti
 *
 * @param {string} category - Kategorija akcije (equipment, materials, technicians, etc.)
 * @param {string} action - Tip akcije (equipment_add, material_edit, etc.)
 * @param {object} options - Dodatne opcije za logovanje
 * @returns {function} Express middleware
 */
const logActivity = (category, action, options = {}) => {
  return async (req, res, next) => {
    console.log(`🔍 [ActivityLogger] Middleware called for ${req.method} ${req.originalUrl}`);
    console.log(`🔍 [ActivityLogger] Headers:`, req.headers);

    // Pokušaj da dobiješ user informacije iz req.user ili iz JWT tokena
    let user = req.user;

    if (!user) {
      console.log('🔍 [ActivityLogger] No req.user, trying to get from JWT token...');
      // Pokušaj da dobiješ iz JWT tokena
      const token = req.headers.authorization?.replace('Bearer ', '');
      console.log(`🔍 [ActivityLogger] Token from headers:`, token ? `${token.substring(0, 20)}...` : 'NONE');
      if (token) {
        try {
          const decoded = jwt.verify(token, JWT_SECRET);
          user = {
            _id: decoded._id || decoded.id,
            id: decoded._id || decoded.id,
            name: decoded.name,
            role: decoded.role
          };
          console.log(`✅ [ActivityLogger] Got user from token: ${user.name} (${user.role})`);
        } catch (error) {
          console.log(`❌ [ActivityLogger] Invalid token:`, error.message);
          // Token nije validan, nastavi bez logovanja
          return next();
        }
      } else {
        console.log('❌ [ActivityLogger] No token found in headers');
        // Nema ni req.user ni token, nastavi bez logovanja
        return next();
      }
    } else {
      console.log(`✅ [ActivityLogger] Got user from req.user: ${user.name} (${user.role})`);
    }

    // Samo loguj admin/superadmin/supervisor akcije
    if (!['admin', 'superadmin', 'supervisor'].includes(user.role)) {
      console.log(`⚠️ [ActivityLogger] User role ${user.role} not allowed for logging`);
      return next();
    }

    console.log(`✅ [ActivityLogger] Will log activity: ${category} - ${action}`);

    // Sačuvaj originalni res.json
    const originalJson = res.json.bind(res);
    const startTime = Date.now();

    // Funkcija za logovanje nakon uspešnog response-a
    const logActivityAsync = async (responseData) => {
      try {
        const duration = Date.now() - startTime;

        // Pripremi log objekat
        const logData = {
          userId: user._id || user.id,
          userName: user.name,
          userRole: user.role,
          action,
          category,
          timestamp: new Date(),
          metadata: {
            ipAddress: req.ip || req.connection.remoteAddress,
            userAgent: req.get('user-agent'),
            requestDuration: duration,
            requestMethod: req.method,
            requestUrl: req.originalUrl || req.url
          }
        };

        // Ekstraktuj entitet informacije ako postoje u response-u
        if (responseData) {
          // Za single item responses
          if (responseData._id) {
            logData.entityId = responseData._id;
            logData.entityType = category.slice(0, -1); // Ukloni 's' sa kraja (materials -> material)
            logData.entityName = responseData.name || responseData.type || responseData.tisJobId || responseData.serialNumber || 'Unknown';
          }

          // Za ID u request params (često kod edit/delete)
          if (req.params.id) {
            logData.entityId = req.params.id;
            logData.entityType = category.slice(0, -1);
          }

          // Custom entity name iz options
          if (options.getEntityName && typeof options.getEntityName === 'function') {
            logData.entityName = options.getEntityName(req, responseData) || logData.entityName;
          }
        }

        // Detalji promene - ako su prosleđeni kroz options
        if (options.getDetails && typeof options.getDetails === 'function') {
          logData.details = await options.getDetails(req, responseData);
          console.log('📊 [ActivityLogger] Details from getDetails:', {
            action: logData.details?.action,
            summaryKeys: Object.keys(logData.details?.summary || {}),
            assignedItemsLength: logData.details?.assignedItems?.length,
            fullDetails: JSON.stringify(logData.details, null, 2)
          });
        } else {
          // Default detalji - pametnije hvatanje podataka
          if (req.method === 'POST' && req.body) {
            // Dodavanje novog entiteta
            const afterData = { ...req.body };

            // Zameni tehničar ID sa imenom za equipment
            if (afterData.location) {
              afterData.location = await resolveTechnicianLocation(afterData.location);
            }

            logData.details = {
              after: afterData,
              action: 'created'
            };
          } else if (req.method === 'PUT' || req.method === 'PATCH') {
            // Izmena entiteta
            const afterData = { ...req.body };

            // Zameni tehničar ID sa imenom za equipment
            if (afterData.location) {
              afterData.location = await resolveTechnicianLocation(afterData.location);
            }

            logData.details = {
              after: afterData,
              action: 'updated'
            };
          } else if (req.method === 'DELETE' && responseData?.deletedData) {
            // Brisanje entiteta - sačuvaj podatke PRE brisanja
            const beforeData = { ...responseData.deletedData };

            // Zameni tehničar ID sa imenom za equipment
            if (beforeData.location) {
              beforeData.location = await resolveTechnicianLocation(beforeData.location);
            }

            logData.details = {
              before: beforeData,
              action: 'deleted'
            };
          }
        }

        // Asinkrono snimi log (non-blocking)
        setImmediate(async () => {
          try {
            console.log('💾 [ActivityLogger] Saving to database:', logData);
            const savedLog = await AdminActivityLog.create(logData);
            console.log('✅ [ActivityLogger] Activity log saved successfully:', savedLog._id);
          } catch (error) {
            console.error('❌ [ActivityLogger] Error creating activity log:', error.message);
            console.error('❌ [ActivityLogger] Log data was:', JSON.stringify(logData, null, 2));
          }
        });

      } catch (error) {
        console.error('❌ Error in logActivityAsync:', error.message);
      }
    };

    // Override res.json da uhvati response podatke
    res.json = function(data) {
      console.log(`📝 [ActivityLogger] Response sent with status ${res.statusCode}`);
      // Loguj samo ako je uspešan response (2xx status)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log(`✅ [ActivityLogger] Logging activity for successful response`);
        logActivityAsync(data).catch(err => {
          console.error('❌ Failed to log activity:', err.message);
        });
      } else {
        console.log(`⚠️ [ActivityLogger] Skipping log for status ${res.statusCode}`);
      }

      // Pozovi originalni res.json
      return originalJson(data);
    };

    next();
  };
};

/**
 * Helper funkcija za batch logovanje (kada se loguje više akcija odjednom)
 */
const logBatchActivity = async (activities) => {
  try {
    if (!Array.isArray(activities) || activities.length === 0) {
      return;
    }

    // Batch insert za bolje performanse
    await AdminActivityLog.insertMany(activities);
  } catch (error) {
    console.error('❌ Error in batch activity logging:', error.message);
  }
};

module.exports = {
  logActivity,
  logBatchActivity
};
