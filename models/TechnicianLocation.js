const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TechnicianLocationSchema = new Schema({
  technicianId: {
    type: Schema.Types.ObjectId,
    ref: 'Technician',
    required: true
  },
  latitude: {
    type: Number,
    required: true
  },
  longitude: {
    type: Number,
    required: true
  },
  accuracy: {
    type: Number,
    required: false
  },
  altitude: {
    type: Number,
    required: false
  },
  speed: {
    type: Number,
    required: false
  },
  heading: {
    type: Number,
    required: false
  },
  // Timestamp kada je lokacija zabeležena na uređaju
  deviceTimestamp: {
    type: Date,
    required: false
  },
  // Da li je ovo odgovor na zahtev admina ili automatska sinhronizacija
  requestType: {
    type: String,
    enum: ['admin_request', 'auto_sync', 'manual'],
    default: 'admin_request'
  },
  // ID zahteva ako je admin tražio lokaciju
  requestId: {
    type: String,
    required: false
  },
  // Dodatne informacije o uređaju
  deviceInfo: {
    batteryLevel: Number,
    isCharging: Boolean,
    networkType: String
  }
}, {
  timestamps: true
});

// Index za brzo pretraživanje po tehničaru i vremenu
TechnicianLocationSchema.index({ technicianId: 1, createdAt: -1 });
TechnicianLocationSchema.index({ requestId: 1 });

// Statička metoda za dobijanje poslednje lokacije svakog tehničara
TechnicianLocationSchema.statics.getLatestLocationsForAll = async function() {
  return this.aggregate([
    {
      $sort: { createdAt: -1 }
    },
    {
      $group: {
        _id: '$technicianId',
        latestLocation: { $first: '$$ROOT' }
      }
    },
    {
      $replaceRoot: { newRoot: '$latestLocation' }
    },
    {
      $lookup: {
        from: 'technicians',
        localField: 'technicianId',
        foreignField: '_id',
        as: 'technician'
      }
    },
    {
      $unwind: '$technician'
    },
    {
      $project: {
        _id: 1,
        technicianId: 1,
        latitude: 1,
        longitude: 1,
        accuracy: 1,
        createdAt: 1,
        deviceTimestamp: 1,
        requestType: 1,
        'technician.name': 1,
        'technician.phoneNumber': 1,
        'technician.profileImage': 1
      }
    }
  ]);
};

// Statička metoda za dobijanje poslednje lokacije jednog tehničara
TechnicianLocationSchema.statics.getLatestForTechnician = async function(technicianId) {
  return this.findOne({ technicianId })
    .sort({ createdAt: -1 })
    .populate('technicianId', 'name phoneNumber profileImage');
};

module.exports = mongoose.model('TechnicianLocation', TechnicianLocationSchema);
