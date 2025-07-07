const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const WorkOrderEvidenceSchema = new Schema({
  // Referenca na originalni radni nalog
  workOrderId: {
    type: Schema.Types.ObjectId,
    ref: 'WorkOrder',
    required: true
  },
  
  // Osnovni podaci iz TIS sistema
  tisJobId: {
    type: String,
    required: true
  },
  
  tisId: {
    type: String,
    required: true
  },
  
  // Podaci o korisniku
  customerName: {
    type: String,
    required: true
  },
  
  customerStatus: {
    type: String,
    enum: ['Nov korisnik', 'Postojeći korisnik', 'Zamena uređaja', 'Prekid usluge'],
    required: true
  },
  
  // Podaci o lokaciji
  municipality: {
    type: String,
    required: true
  },
  
  address: {
    type: String,
    required: true
  },
  
  // Podaci o tehničarima
  technician1: {
    type: String,
    required: true
  },
  
  technician2: {
    type: String
  },
  
  // Status radnog naloga
  status: {
    type: String,
    enum: ['ZAVRŠENO', 'U TOKU', 'OTKAZANO', 'ODLOŽENO'],
    default: 'U TOKU'
  },
  
  // Datum izvršavanja
  executionDate: {
    type: Date,
    required: true
  },
  
  // Napomene
  notes: {
    type: String
  },
  
  // Vrsta naloga
  orderType: {
    type: String,
    required: true
  },
  
  // Paket/usluga
  servicePackage: {
    type: String
  },
  
  // Instalirani uređaji
  installedEquipment: [{
    equipmentType: {
      type: String,
      enum: ['ONT/HFC', 'Hybrid', 'STB/CAM', 'Kartica', 'Mini node'],
      required: true
    },
    serialNumber: {
      type: String,
      required: true
    },
    condition: {
      type: String,
      enum: ['N', 'R'], // N-ispravno, R-neispravno
      default: 'N'
    },
    installedAt: {
      type: Date,
      default: Date.now
    },
    notes: {
      type: String
    }
  }],
  
  // Uklonjeni uređaji (demontaža)
  removedEquipment: [{
    equipmentType: {
      type: String,
      enum: ['ONT/HFC', 'Hybrid', 'STB/CAM', 'Kartica', 'Mini node'],
      required: true
    },
    serialNumber: {
      type: String,
      required: true
    },
    condition: {
      type: String,
      enum: ['N', 'R'], // N-ispravno, R-neispravno
      required: true
    },
    removedAt: {
      type: Date,
      default: Date.now
    },
    reason: {
      type: String, // Razlog uklanjanja
      enum: ['Zamena', 'Kvar', 'Prekid usluge', 'Ostalo']
    },
    notes: {
      type: String
    }
  }],
  
  // Evidencija promena
  changeHistory: [{
    field: {
      type: String,
      required: true
    },
    oldValue: {
      type: Schema.Types.Mixed
    },
    newValue: {
      type: Schema.Types.Mixed
    },
    changedAt: {
      type: Date,
      default: Date.now
    },
    changedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  
  // Tehnologija
  technology: {
    type: String,
    enum: ['HFC', 'GPON', 'VDSL', 'other'],
    default: 'other'
  },
  
  // Status verifikacije
  verified: {
    type: Boolean,
    default: false
  },
  
  verifiedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  
  verifiedAt: {
    type: Date
  }
  
}, { 
  timestamps: true
});

// Dodavanje indeksa
WorkOrderEvidenceSchema.index({ tisJobId: 1 });
WorkOrderEvidenceSchema.index({ tisId: 1 });
WorkOrderEvidenceSchema.index({ workOrderId: 1 });
WorkOrderEvidenceSchema.index({ 'installedEquipment.serialNumber': 1 });
WorkOrderEvidenceSchema.index({ 'removedEquipment.serialNumber': 1 });

// Middleware za praćenje promena
WorkOrderEvidenceSchema.pre('save', function(next) {
  if (this.isModified() && !this.isNew) {
    const modifiedFields = this.modifiedPaths();
    modifiedFields.forEach(field => {
      if (field !== 'changeHistory' && field !== 'updatedAt' && field !== 'installedEquipment' && field !== 'removedEquipment') {
        this.changeHistory.push({
          field: field,
          oldValue: this._original ? this._original[field] : null,
          newValue: this[field],
          changedAt: new Date()
        });
      }
    });
  }
  next();
});

// Čuvanje originalne verzije za praćenje promena
WorkOrderEvidenceSchema.post('init', function() {
  try {
    this._original = this.toObject();
  } catch (error) {
    console.log('Warning: Could not create original object copy:', error.message);
  }
});

module.exports = mongoose.model('WorkOrderEvidence', WorkOrderEvidenceSchema);