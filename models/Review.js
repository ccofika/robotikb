const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ReviewSchema = new Schema({
  // Reference
  workOrderId: {
    type: Schema.Types.ObjectId,
    ref: 'WorkOrder',
    required: true
  },
  technicianId: {
    type: Schema.Types.ObjectId,
    ref: 'Technician',
    required: true
  },
  tisJobId: {
    type: String
  },
  customerName: {
    type: String
  },

  // Sekcija I: Prvi utisak i tačnost
  onTime: {
    type: String,
    enum: [
      'Da, tačno na vreme',
      'Sa malim zakašnjenjem',
      'Ne, termin je pomeren'
    ],
    required: true
  },
  professionalism: {
    type: Number,
    min: 1,
    max: 5,
    required: true
  },

  // Sekcija II: Tehnička realizacija
  cleanInstallation: {
    type: String,
    enum: ['Da', 'Ne'],
    required: true
  },
  cleanInstallationComment: {
    type: String
  },
  explanation: {
    type: String,
    enum: [
      'Da, sve je jasno',
      'Delimično',
      'Ne, nisu mi pružene informacije'
    ],
    required: true
  },
  serviceQuality: {
    type: Number,
    min: 1,
    max: 5,
    required: true
  },

  // Sekcija III: Preporuka i komentar
  npsScore: {
    type: Number,
    min: 0,
    max: 10,
    required: true
  },
  comment: {
    type: String
  }
}, {
  timestamps: true
});

// Indeksi
ReviewSchema.index({ technicianId: 1, createdAt: -1 });
ReviewSchema.index({ workOrderId: 1 }, { unique: true });

module.exports = mongoose.model('Review', ReviewSchema);
