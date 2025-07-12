const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const WorkOrderSchema = new Schema({
  date: {
    type: Date,
    required: true
  },
  time: {
    type: String,
    required: true
  },
  municipality: {
    type: String,
    required: true
  },
  address: {
    type: String,
    required: true
  },
  type: {
    type: String,
    required: true
  },
  technicianId: {
    type: Schema.Types.ObjectId,
    ref: 'Technician'
  },
  technician2Id: {
    type: Schema.Types.ObjectId,
    ref: 'Technician'
  },
  details: {
    type: String
  },
  comment: {
    type: String
  },
  status: {
    type: String,
    enum: ['zavrsen', 'nezavrsen', 'otkazan', 'odlozen'],
    default: 'nezavrsen'
  },
  statusChangedBy: {
    type: Schema.Types.ObjectId,
    ref: 'Technician'
  },
  statusChangedAt: {
    type: Date
  },
  postponedUntil: {
    type: Date
  },
  technology: {
    type: String,
    enum: ['HFC', 'GPON', 'VDSL', 'other'],
    default: 'other'
  },
  tisId: {
    type: String
  },
  userName: {
    type: String
  },
  userPhone: {
    type: String
  },
  tisJobId: {
    type: String
  },
  additionalJobs: {
    type: String
  },
  images: [{
    url: {
      type: String,
      required: true
    },
    originalName: {
      type: String,
      required: true
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Technician'
    }
  }],
  verified: {
    type: Boolean,
    default: false
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  equipment: [{
    type: Schema.Types.ObjectId,
    ref: 'Equipment'
  }],
  materials: [{
    material: {
      type: Schema.Types.ObjectId,
      ref: 'Material'
    },
    quantity: {
      type: Number,
      default: 1
    }
  }],
  installedEquipment: [{
    equipmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Equipment',
      required: true
    },
    installedAt: {
      type: Date,
      default: Date.now
    },
    technicianId: {
      type: Schema.Types.ObjectId,
      ref: 'Technician'
    },
    notes: {
      type: String
    }
  }]
}, { timestamps: true });

module.exports = mongoose.model('WorkOrder', WorkOrderSchema); 