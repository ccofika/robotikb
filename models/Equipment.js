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

module.exports = mongoose.model('Equipment', EquipmentSchema); 