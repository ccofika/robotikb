const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ErrorLogSchema = new Schema({
  // Tip i detalji greške
  errorType: {
    type: String,
    required: true,
    enum: [
      'ValidationError',
      'CastError',
      'MongoError',
      'UnauthorizedError',
      'NotFoundError',
      'ServerError',
      'DatabaseError',
      'ExternalServiceError',
      'Unknown'
    ]
  },

  errorMessage: {
    type: String,
    required: true
  },

  errorStack: {
    type: String
  },

  statusCode: {
    type: Number,
    default: 500
  },

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

  // Korisnik koji je izazvao grešku
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

  // Request podaci
  requestData: {
    body: Schema.Types.Mixed,
    params: Schema.Types.Mixed,
    query: Schema.Types.Mixed
  },

  // Response podaci (ako postoje)
  responseData: Schema.Types.Mixed,

  // Metadata
  metadata: {
    ipAddress: String,
    userAgent: String,
    requestDuration: Number
  },

  // Status rešavanja
  resolved: {
    type: Boolean,
    default: false
  },

  resolvedBy: {
    type: Schema.Types.ObjectId,
    ref: 'Technician'
  },

  resolvedByName: {
    type: String
  },

  resolvedAt: {
    type: Date
  },

  notes: {
    type: String
  },

  // Severity level
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },

  // Broj ponavljanja iste greške
  occurrences: {
    type: Number,
    default: 1
  },

  // Timestamp
  timestamp: {
    type: Date,
    default: Date.now,
    required: true
  }
}, {
  timestamps: true,
  // Auto-delete razrešenih grešaka starijih od 30 dana
  expireAfterSeconds: 30 * 24 * 60 * 60  // 30 dana u sekundama
});

// Indeksi za brže pretrage
ErrorLogSchema.index({ timestamp: -1 });
ErrorLogSchema.index({ errorType: 1, timestamp: -1 });
ErrorLogSchema.index({ resolved: 1, timestamp: -1 });
ErrorLogSchema.index({ severity: 1, timestamp: -1 });
ErrorLogSchema.index({ route: 1, timestamp: -1 });
ErrorLogSchema.index({ userId: 1, timestamp: -1 });

// Compound index za nerazrešene kritične greške
ErrorLogSchema.index({
  resolved: 1,
  severity: 1,
  timestamp: -1
});

// Method za označavanje greške kao rešene
ErrorLogSchema.methods.markAsResolved = async function(resolvedBy, resolvedByName, notes) {
  this.resolved = true;
  this.resolvedBy = resolvedBy;
  this.resolvedByName = resolvedByName;
  this.resolvedAt = new Date();
  this.notes = notes || '';
  await this.save();
};

module.exports = mongoose.model('ErrorLog', ErrorLogSchema);
