const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const LogSchema = new Schema({
  // Osnovne informacije o akciji
  action: {
    type: String,
    required: true,
    enum: [
      'material_added',
      'material_removed', 
      'equipment_added',
      'equipment_removed',
      'comment_added',
      'workorder_finished',
      'workorder_postponed',
      'workorder_cancelled',
      'workorder_status_changed',
      'image_added',
      'image_removed',
      'workorder_created',
      'workorder_assigned',
      'workorder_updated'
    ]
  },
  
  // Opis akcije
  description: {
    type: String,
    required: true
  },
  
  // ID korisnika koji je izvršio akciju
  performedBy: {
    type: Schema.Types.ObjectId,
    ref: 'Technician',
    required: true
  },
  
  // Ime korisnika koji je izvršio akciju (za brže pretrage)
  performedByName: {
    type: String,
    required: true
  },
  
  // Radni nalog na koji se odnosi akcija
  workOrderId: {
    type: Schema.Types.ObjectId,
    ref: 'WorkOrder',
    required: true
  },
  
  // Osnovne informacije o radnom nalogu (za brže pretrage)
  workOrderInfo: {
    municipality: { type: String, default: '' },
    address: { type: String, default: '' },
    type: { type: String, default: '' },
    tisId: { type: String, default: '' },
    userName: { type: String, default: '' }
  },
  
  // Detalji o materijalima (kada se dodaju/uklanjaju)
  materialDetails: {
    materialId: {
      type: Schema.Types.ObjectId,
      ref: 'Material'
    },
    materialType: String,
    quantity: Number
  },
  
  // Detalji o opremi (kada se dodaje/uklanja)
  equipmentDetails: {
    equipmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Equipment'
    },
    equipmentType: String,
    serialNumber: String,
    description: String,
    isWorking: Boolean,
    removalReason: String
  },
  
  // Detalji o slici (kada se dodaje/uklanja)
  imageDetails: {
    imageName: String,
    imageUrl: String
  },
  
  // Stari i novi status (za promene statusa)
  statusChange: {
    oldStatus: String,
    newStatus: String
  },
  
  // Komentar (kada se dodaje komentar)
  commentText: String,
  
  // Datum i vreme akcije (automatski)
  timestamp: {
    type: Date,
    default: Date.now
  },
  
  // Dodatni kontekst
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true });

// Indeksi za bolje performanse
LogSchema.index({ performedBy: 1, timestamp: -1 });
LogSchema.index({ workOrderId: 1, timestamp: -1 });
LogSchema.index({ action: 1, timestamp: -1 });
LogSchema.index({ 'workOrderInfo.userName': 1, timestamp: -1 });
LogSchema.index({ 'workOrderInfo.tisId': 1, timestamp: -1 });
LogSchema.index({ timestamp: -1 }); // Za hourly activity distribution
LogSchema.index({ performedByName: 1, timestamp: -1 }); // Za filter po tehničaru
LogSchema.index({ 'workOrderInfo.municipality': 1, timestamp: -1 }); // Za filter po opštini

module.exports = mongoose.model('Log', LogSchema); 