const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  // Basic notification info
  title: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: [
      'work_order_verification',       // Novi radni nalog za verifikaciju
      'material_anomaly',              // Nova anomalija za validaciju materijala
      'vehicle_registration_expiry',   // Isticanje registracije vozila
      'technician_employment_expiry',  // Isticanje ugovora tehničara
      'low_review_rating',             // Loša ocena korisnika
      'customer_not_contacted'         // Tehničar nije pozvao korisnika pred termin
    ],
    required: true,
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium',
  },
  isRead: {
    type: Boolean,
    default: false,
  },
  
  // User info
  recipientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  
  // Navigation and action data
  targetPage: {
    type: String,
    required: true, // e.g., '/work-orders-by-technician', '/logs', '/vehicle-fleet'
  },
  targetTab: {
    type: String, // e.g., 'verification', 'material-validation'
  },
  targetId: {
    type: String, // ID of the item to highlight/hover
  },
  
  // Type-specific data
  // Work Order Verification
  workOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WorkOrder',
  },
  technicianId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Technician',
  },
  technicianName: {
    type: String,
  },
  
  // Material Anomaly
  logId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Log',
  },
  materialName: {
    type: String,
  },
  anomalyType: {
    type: String,
  },
  
  // Vehicle Registration
  vehicleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vehicle',
  },
  vehicleName: {
    type: String,
  },
  licensePlate: {
    type: String,
  },
  expiryDate: {
    type: Date,
  },

  // Technician Employment
  employmentTechnicianId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Technician',
  },
  employmentTechnicianName: {
    type: String,
  },
  employmentExpiryDate: {
    type: Date,
  },

  // Review Rating
  reviewId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Review',
  },
  reviewRating: {
    type: Number,
  },
  customerName: {
    type: String,
  },

  // Metadata
  readAt: {
    type: Date,
  },
  createdAt: {
    type: Date,
    default: function() {
      // Create timestamp in Serbian timezone (UTC+1/UTC+2)
      const now = new Date();
      const serbianTime = new Date(now.getTime() + (2 * 60 * 60 * 1000)); // UTC+2 for CEST
      return serbianTime;
    },
  },
  expiresAt: {
    type: Date,
    default: function() {
      // Auto-delete notifications after 30 days, adjusted for Serbian timezone
      const now = new Date();
      const serbianTime = new Date(now.getTime() + (2 * 60 * 60 * 1000)); // UTC+2 for CEST
      return new Date(serbianTime.getTime() + 30 * 24 * 60 * 60 * 1000);
    }
  }
});

// Index for efficient queries
NotificationSchema.index({ recipientId: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// ── Web push na websajtu ──────────────────────────────────────────────────
// Svaka NOVO kreirana notifikacija (bilo kog tipa, sadašnjeg ili budućeg)
// automatski šalje browser push primaocu — OSIM 'work_order_verification'
// (završeni nalozi stižu prečesto, po dogovoru samo u panel).
// markAsRead() takođe zove save() — zato se pamti da li je dokument nov.
const PUSH_EXCLUDED_TYPES = ['work_order_verification'];

NotificationSchema.pre('save', function(next) {
  this.$locals.wasNew = this.isNew;
  next();
});

NotificationSchema.post('save', function(doc) {
  if (!doc.$locals.wasNew) return;
  if (PUSH_EXCLUDED_TYPES.includes(doc.type)) return;
  try {
    // Lazy require — izbegava kružne zavisnosti pri učitavanju modela
    const webPushService = require('../services/webPushService');
    webPushService.sendToUser(doc.recipientId, {
      title: doc.title,
      body: doc.message,
      url: doc.targetPage || '/',
      tag: doc._id.toString(),
    }).catch(() => {});
  } catch (error) {
    // Push nikada ne sme da obori kreiranje notifikacije
    console.error('[WebPush] Hook greška:', error.message);
  }
});

// Static method to create work order verification notification
NotificationSchema.statics.createWorkOrderVerification = function(workOrderId, technicianId, technicianName, recipientId) {
  return this.create({
    title: 'Novi radni nalog za verifikaciju',
    message: `Tehničar ${technicianName} je završio radni nalog koji čeka verifikaciju.`,
    type: 'work_order_verification',
    priority: 'high',
    recipientId,
    targetPage: '/work-orders-by-technician',
    targetTab: 'verification',
    targetId: workOrderId.toString(),
    workOrderId,
    technicianId,
    technicianName,
    createdBy: technicianId
  });
};

// Static method to create material anomaly notification
NotificationSchema.statics.createMaterialAnomaly = function(logId, technicianId, technicianName, workOrderId, materialName, anomalyType, recipientId) {
  return this.create({
    title: 'Nova anomalija za validaciju materijala',
    message: `Tehničar ${technicianName} prijavio anomaliju materijala "${materialName}" u radnom nalogu.`,
    type: 'material_anomaly',
    priority: 'medium',
    recipientId,
    targetPage: '/logs',
    targetTab: 'material-validation',
    targetId: logId.toString(),
    logId,
    technicianId,
    technicianName,
    workOrderId,
    materialName,
    anomalyType,
    createdBy: technicianId
  });
};

// Static method to create vehicle registration expiry notification
NotificationSchema.statics.createVehicleRegistrationExpiry = function(vehicleId, vehicleName, licensePlate, expiryDate, recipientId) {
  return this.create({
    title: 'Isticanje registracije vozila',
    message: `Registracija vozila "${vehicleName}" (${licensePlate}) ističe ${new Date(expiryDate).toLocaleDateString('sr-RS')}.`,
    type: 'vehicle_registration_expiry',
    priority: 'high',
    recipientId,
    targetPage: '/vehicle-fleet',
    targetId: vehicleId.toString(),
    vehicleId,
    vehicleName,
    licensePlate,
    expiryDate
  });
};

// Static method: tehničar nije kontaktirao korisnika pred zakazani termin
NotificationSchema.statics.createCustomerNotContacted = function(workOrderId, technicianNames, userName, address, time, recipientId) {
  return this.create({
    title: 'Korisnik nije kontaktiran',
    message: `Tehničar ${technicianNames} nije pozvao korisnika ${userName || ''} (${address}) — termin u ${time}. Podsetnik je poslat pre više od 15 minuta.`,
    type: 'customer_not_contacted',
    priority: 'high',
    recipientId,
    targetPage: '/work-orders-by-technician',
    targetId: workOrderId.toString(),
    workOrderId
  });
};

// Static method to create technician employment expiry notification
NotificationSchema.statics.createTechnicianEmploymentExpiry = function(technicianId, technicianName, expiryDate, recipientId) {
  return this.create({
    title: 'Isticanje ugovora tehničara',
    message: `Ugovor tehničara "${technicianName}" ističe ${new Date(expiryDate).toLocaleDateString('sr-RS')}.`,
    type: 'technician_employment_expiry',
    priority: 'high',
    recipientId,
    targetPage: '/technicians',
    targetId: technicianId.toString(),
    employmentTechnicianId: technicianId,
    employmentTechnicianName: technicianName,
    employmentExpiryDate: expiryDate
  });
};

// Static method to create low review rating notification
NotificationSchema.statics.createLowReviewRating = function(reviewId, technicianId, technicianName, customerName, rating, recipientId) {
  return this.create({
    title: 'Loša ocena korisnika',
    message: `Korisnik "${customerName}" je dao ocenu ${rating}/5 tehničaru ${technicianName}.`,
    type: 'low_review_rating',
    priority: 'high',
    recipientId,
    targetPage: '/technicians',
    targetId: technicianId.toString(),
    reviewId,
    technicianId,
    technicianName,
    reviewRating: rating,
    customerName
  });
};

// Instance method to mark as read
NotificationSchema.methods.markAsRead = function() {
  this.isRead = true;
  // Set readAt timestamp in Serbian timezone (UTC+2 for CEST)
  const now = new Date();
  this.readAt = new Date(now.getTime() + (2 * 60 * 60 * 1000));
  return this.save();
};

// Virtual for time ago
NotificationSchema.virtual('timeAgo').get(function() {
  const now = new Date();
  const diff = now - this.createdAt;
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (minutes < 1) return 'upravo sada';
  if (minutes < 60) return `${minutes} min`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days} dan${days > 1 ? 'a' : ''}`;
  return this.createdAt.toLocaleDateString('sr-RS');
});

// Virtual for formatted timestamp  
NotificationSchema.virtual('formattedTimestamp').get(function() {
  return this.createdAt.toLocaleDateString('sr-RS', {
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit'
  });
});

module.exports = mongoose.model('Notification', NotificationSchema);