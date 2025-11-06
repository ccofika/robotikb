const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const EquipmentSchema = new Schema({
  category: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  serialNumber: {
    type: String,
    required: true,
    unique: true
  },
  location: {
    type: String,
    default: 'magacin'
  },
  status: {
    type: String,
    enum: ['available', 'assigned', 'installed', 'defective', 'pending_confirmation'],
    default: 'available'
  },
  assignedTo: {
    type: Schema.Types.ObjectId,
    ref: 'Technician'
  },
  assignedToUser: {
    type: String,
    ref: 'User'
  },
  installedAt: {
    type: Date
  },
  removedAt: {
    type: Date
  },
  awaitingConfirmation: {
    type: Boolean,
    default: false
  },
  confirmationStatus: {
    type: String,
    enum: ['pending', 'confirmed', 'rejected'],
    default: 'pending'
  },
  rejectionReason: {
    type: String,
    default: ''
  },
  confirmationDate: {
    type: Date
  }
}, { timestamps: true });

// Dodavanje indeksa za optimizaciju performansi
EquipmentSchema.index({ serialNumber: 1 });
EquipmentSchema.index({ status: 1 });
EquipmentSchema.index({ location: 1 });
EquipmentSchema.index({ assignedTo: 1 });
EquipmentSchema.index({ status: 1, location: 1 }); // Kompozitni indeks za česte kombinovane upite

// Pre-save hook za normalizaciju serijskog broja u lowercase
EquipmentSchema.pre('save', function(next) {
  if (this.serialNumber) {
    this.serialNumber = this.serialNumber.toLowerCase();
  }
  next();
});

module.exports = mongoose.model('Equipment', EquipmentSchema); 