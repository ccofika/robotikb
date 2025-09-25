const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TechnicianSchema = new Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  materials: [{
    materialId: {
      type: Schema.Types.ObjectId,
      ref: 'Material'
    },
    quantity: {
      type: Number,
      default: 0
    }
  }],
  basicEquipment: [{
    basicEquipmentId: {
      type: Schema.Types.ObjectId,
      ref: 'BasicEquipment'
    },
    quantity: {
      type: Number,
      default: 0
    }
  }],
  equipment: [{
    type: Schema.Types.ObjectId,
    ref: 'Equipment'
  }],
  role: {
    type: String,
    enum: ['technician', 'admin', 'superadmin'],
    default: 'technician'
  },
  isAdmin: {
    type: Boolean,
    default: false
  },
  gmail: {
    type: String,
    required: false,
    default: ''
  },
  profileImage: {
    type: String,
    required: false,
    default: ''
  }
}, { timestamps: true });

module.exports = mongoose.model('Technician', TechnicianSchema); 