const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PerformanceLogSchema = new Schema({
  // Request detalji
  route: {
    type: String,
    required: true
  },

  method: {
    type: String,
    enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    required: true
  },

  // Performance metrike
  duration: {
    type: Number,
    required: true  // u milisekundama
  },

  statusCode: {
    type: Number,
    required: true
  },

  // Korisnik koji je izvršio request
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'Technician'
  },

  userName: {
    type: String
  },

  userRole: {
    type: String,
    enum: ['technician', 'admin', 'superadmin', 'supervisor']
  },

  // Database metrike
  queryCount: {
    type: Number,
    default: 0  // Broj database upita
  },

  cacheHit: {
    type: Boolean,
    default: false
  },

  // Response veličina
  responseSize: {
    type: Number,  // u bajtovima
    default: 0
  },

  // Memorija
  memoryUsage: {
    heapUsed: Number,
    heapTotal: Number,
    external: Number
  },

  // CPU
  cpuUsage: {
    user: Number,
    system: Number
  },

  // Flagovi za probleme
  isSlow: {
    type: Boolean,
    default: false  // true ako duration > threshold (default 2000ms)
  },

  hasError: {
    type: Boolean,
    default: false
  },

  // Metadata
  metadata: {
    ipAddress: String,
    userAgent: String,
    requestSize: Number  // u bajtovima
  },

  // Timestamp
  timestamp: {
    type: Date,
    default: Date.now,
    required: true
  }
}, {
  timestamps: true,
  // Auto-delete normalnih logova starijih od 7 dana, sporih 30 dana
  // TTL će se implementirati kroz custom cleanup job
});

// Indeksi za brže pretrage
PerformanceLogSchema.index({ timestamp: -1 });
PerformanceLogSchema.index({ duration: -1 });
PerformanceLogSchema.index({ isSlow: 1, timestamp: -1 });
PerformanceLogSchema.index({ route: 1, timestamp: -1 });
PerformanceLogSchema.index({ userId: 1, timestamp: -1 });

// Compound index za spore requeste
PerformanceLogSchema.index({
  isSlow: 1,
  route: 1,
  timestamp: -1
});

// Method za analizu performansi
PerformanceLogSchema.statics.getSlowEndpoints = async function(limit = 10) {
  return this.aggregate([
    { $match: { isSlow: true } },
    {
      $group: {
        _id: { route: '$route', method: '$method' },
        avgDuration: { $avg: '$duration' },
        maxDuration: { $max: '$duration' },
        count: { $sum: 1 },
        lastOccurrence: { $max: '$timestamp' }
      }
    },
    { $sort: { count: -1 } },
    { $limit: limit }
  ]);
};

// Method za average response time
PerformanceLogSchema.statics.getAverageResponseTime = async function(route, hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const result = await this.aggregate([
    {
      $match: {
        route: route,
        timestamp: { $gte: since }
      }
    },
    {
      $group: {
        _id: null,
        avgDuration: { $avg: '$duration' },
        minDuration: { $min: '$duration' },
        maxDuration: { $max: '$duration' },
        count: { $sum: 1 }
      }
    }
  ]);

  return result[0] || { avgDuration: 0, minDuration: 0, maxDuration: 0, count: 0 };
};

module.exports = mongoose.model('PerformanceLog', PerformanceLogSchema);
