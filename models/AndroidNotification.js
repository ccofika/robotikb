const mongoose = require('mongoose');

const AndroidNotificationSchema = new mongoose.Schema({
  // Osnovni podaci
  technicianId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Technician',
    required: true,
    index: true
  },

  type: {
    type: String,
    enum: ['work_order', 'equipment_add', 'equipment_remove'],
    required: true
  },

  title: {
    type: String,
    required: true
  },

  message: {
    type: String,
    required: true
  },

  // Za navigaciju u aplikaciji
  relatedId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false
  },

  relatedData: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // Status
  isRead: {
    type: Boolean,
    default: false,
    index: true
  },

  readAt: {
    type: Date,
    default: null
  },

  // Push notification tracking
  pushSent: {
    type: Boolean,
    default: false
  },

  pushSentAt: {
    type: Date,
    default: null
  },

  pushToken: {
    type: String,
    default: null
  },

  pushError: {
    type: String,
    default: null
  },

  // Timestamps
  createdAt: {
    type: Date,
    default: () => {
      // Serbian timezone (UTC+1/UTC+2)
      const now = new Date();
      const serbianTime = new Date(now.getTime() + (2 * 60 * 60 * 1000));
      return serbianTime;
    }
  },

  expiresAt: {
    type: Date,
    default: () => {
      // Auto-delete after 7 days
      const now = new Date();
      const serbianTime = new Date(now.getTime() + (2 * 60 * 60 * 1000));
      return new Date(serbianTime.getTime() + 7 * 24 * 60 * 60 * 1000);
    }
  }
});

// Indexes za efikasne upite
AndroidNotificationSchema.index({ technicianId: 1, createdAt: -1 });
AndroidNotificationSchema.index({ technicianId: 1, isRead: 1 });
AndroidNotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Instance metoda za označavanje kao pročitano
AndroidNotificationSchema.methods.markAsRead = function() {
  this.isRead = true;
  const now = new Date();
  this.readAt = new Date(now.getTime() + (2 * 60 * 60 * 1000));
  return this.save();
};

// Virtual za timeAgo prikaz
AndroidNotificationSchema.virtual('timeAgo').get(function() {
  const now = new Date();
  const diff = now - this.createdAt;
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return 'upravo sada';
  if (minutes < 60) return `${minutes} min`;
  if (hours < 24) return `${hours}h`;
  if (days === 0) return 'danas';
  if (days === 1) return 'juče';
  if (days < 7) return `${days} dana`;
  return this.createdAt.toLocaleDateString('sr-RS');
});

// Virtual za formatovan datum
AndroidNotificationSchema.virtual('formattedDate').get(function() {
  return this.createdAt.toLocaleDateString('sr-RS', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
});

// Static metoda - kreiranje notifikacije za radni nalog
AndroidNotificationSchema.statics.createWorkOrderNotification = async function(technicianId, workOrderData) {
  const { address, municipality, date, time, orderId } = workOrderData;

  // Format poruke
  const formattedDate = new Date(date).toLocaleDateString('sr-RS', { day: '2-digit', month: '2-digit' });
  const message = `${address}, ${municipality} - ${formattedDate} u ${time}`;

  return this.create({
    technicianId,
    type: 'work_order',
    title: 'Nov radni nalog',
    message,
    relatedId: orderId,
    relatedData: {
      address,
      municipality,
      date,
      time
    }
  });
};

// Static metoda - kreiranje notifikacije za dodavanje opreme
AndroidNotificationSchema.statics.createEquipmentAddNotification = async function(technicianId, equipmentList) {
  const count = equipmentList.length;

  // Kreiraj detaljan message
  let message = '';
  if (count === 1) {
    const eq = equipmentList[0];
    message = `${eq.name} (S/N: ${eq.serialNumber || eq.serial || 'N/A'})`;
  } else {
    message = `${count} ${count < 5 ? 'stavke' : 'stavki'} opreme`;
  }

  return this.create({
    technicianId,
    type: 'equipment_add',
    title: 'Zadužena oprema',
    message,
    relatedData: {
      count,
      equipment: equipmentList.map(eq => ({
        id: eq._id || eq.id,
        name: eq.name || eq.equipmentName || 'Nepoznato',
        serialNumber: eq.serialNumber || eq.serial || 'N/A',
        category: eq.category || eq.equipmentCategory || 'N/A'
      }))
    }
  });
};

// Static metoda - kreiranje notifikacije za uklanjanje opreme
AndroidNotificationSchema.statics.createEquipmentRemoveNotification = async function(technicianId, equipmentList) {
  const count = equipmentList.length;

  // Kreiraj detaljan message
  let message = '';
  if (count === 1) {
    const eq = equipmentList[0];
    message = `${eq.name} (S/N: ${eq.serialNumber || eq.serial || 'N/A'})`;
  } else {
    message = `${count} ${count < 5 ? 'stavke' : 'stavki'} opreme`;
  }

  return this.create({
    technicianId,
    type: 'equipment_remove',
    title: 'Razdužena oprema',
    message,
    relatedData: {
      count,
      equipment: equipmentList.map(eq => ({
        id: eq._id || eq.id,
        name: eq.name || eq.equipmentName || 'Nepoznato',
        serialNumber: eq.serialNumber || eq.serial || 'N/A',
        category: eq.category || eq.equipmentCategory || 'N/A'
      }))
    }
  });
};

// Ensure virtuals are included in JSON
AndroidNotificationSchema.set('toJSON', { virtuals: true });
AndroidNotificationSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('AndroidNotification', AndroidNotificationSchema);
